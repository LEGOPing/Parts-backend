#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BLP.py — 本地用 Playwright 无头浏览器直连 Bricklink 网页爬取零件价格的命令行工具。

特点：
    - 直接访问 Bricklink 价格指南页 https://www.bricklink.com/catalogPG.asp?P=<型号>&colorID=<颜色ID>
    - 用 Playwright + Chromium 无头浏览器执行 AWS-WAF 挑战，拿到真实价格页后解析
      （BL 价格页在 AWS-WAF 之后，纯 urllib/reqeusts 只能收到 202 挑战页，无法执行 JS，
       因此必须用真浏览器过挑战。住宅 IP 更易通过，但前提是执行挑战脚本。）
    - 每个批次复用同一个浏览器，不重复启停，速度更快
    - 价格解析算法与前端 ui.js 的 extractBLPriceGuide 及 app/bricklink_price.py 一致

环境准备（一次性）：
    python3 -m pip install playwright
    python3 -m playwright install chromium

三种用法：
    1. 查单个零件价格：
        python3 BLP.py 3001 85                 # 型号 3001，BL 颜色 ID 85 (Dark Bluish Gray)
        python3 BLP.py 3001 white               # 也可用颜色名，会自动归一化匹配
        python3 BLP.py -c CNY 3001 85           # 期望币种（可留空自动取页面首个）

    2. 增量同步最新零件（读 Supabase 系统数据库 + 现有 BL-price.json，只补新增）：
        python3 BLP.py --dry-run                # 只列新增组合，不抓
        python3 BLP.py --max-fetch 200          # 本轮最多抓 200 条，抓完合并推 Gitee
        python3 BLP.py --max-fetch 200 --no-push   # 抓完只存本地，不推送

    3. 定时循环：
        python3 BLP.py --loop 120               # 每 120 分钟跑一轮

数据流（增量，非全量）：
    1. 直连 Supabase parts 表读系统零件(约 500 种) -> (part_num, RB_color_id) 去重集合
    2. 颜色 RB id -> 名称 -> BL id 映射
    3. 拉取现有 BL-price.json -> 已有 key 集合
    4. 系统零件减去已有 key -> 只新增待抓组合（已存在永不重抓，断点续跑）
    5. 逐个直连 BL 价格页抓价 -> 合并写回 BL-price.json -> 推送到 Gitee
    6. 前端继续读 Gitee 上的 BL-price.json 作价格参考
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

# ---------------------------------------------------------------------------
# 配置（与现有脚本对齐；Supabase 连接 / Gitee 推送均同源）
# ---------------------------------------------------------------------------
GITEE_OWNER   = "legoping"
GITEE_REPO    = "parts-rb"
GITEE_BRANCH  = "main"
GITEE_TOKEN   = os.environ.get("GITEE_TOKEN", "5e8fe75044a023e2c992c1b5d11c95f0")

GITEE_RAW      = f"https://gitee.com/{GITEE_OWNER}/{GITEE_REPO}/raw/{GITEE_BRANCH}"
GITEE_API      = f"https://gitee.com/api/v5/repos/{GITEE_OWNER}/{GITEE_REPO}/contents"

PRICE_JSON     = "BL-price.json"
COLORS_CSV     = "colors.csv"          # RB 颜色表 id,name
BL_COLORS_JSON = "bl_colors.json"      # BL 颜色表 id,name

SUPABASE_ANON  = os.environ.get("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmeHlkbGtweGtkcHh5b3Fya2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMTA2NzQsImV4cCI6MjEwMDc4NjY3NH0.kNMlT3YXyXVV5Y_JHmDd-0vj1o_xFUFpV_uuWTVh-JI")


def _supabase_ref_from_jwt(token):
    part = token.split('.')
    if len(part) < 2:
        return None
    b = part[1] + '=' * (-len(part[1]) % 4)
    try:
        import base64
        data = json.loads(base64.urlsafe_b64decode(b.encode("ascii")).decode("utf-8"))
        return data.get("ref")
    except Exception:
        return None


SUPABASE_URL = os.environ.get("SUPABASE_URL") or (
    "https://%s.supabase.co" % (_supabase_ref_from_jwt(SUPABASE_ANON) or "missing-ref"))

FETCH_TIMEOUT = 30
REQUEST_DELAY = 2.0                       # 直连 BL 网页的请求间隔，避免触发反爬/限速
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def norm(s):
    return re.sub(r'[^a-z0-9]', '', str(s or '').strip().lower())


# ---------------------------------------------------------------------------
# Gitee 读写
# ---------------------------------------------------------------------------
def gitee_raw(path):
    url = f"{GITEE_RAW}/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        return resp.read()


def get_file_sha(path):
    url = f"{GITEE_API}/{path}?access_token={GITEE_TOKEN}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8")).get("sha")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        log(f"获取 {path} SHA 失败: HTTP {e.code}")
        return None


def gitee_push(path, payload_b64):
    body = {"access_token": GITEE_TOKEN,
            "content": payload_b64,
            "message": "feat(BLP): 增量更新 Bricklink 价格库 [skip ci]",
            "branch": GITEE_BRANCH}
    sha = get_file_sha(path)
    if sha:
        body["sha"] = sha
    method = "PUT" if sha else "POST"
    req = urllib.request.Request(f"{GITEE_API}/{path}",
                                 data=json.dumps(body).encode("utf-8"), method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:
        return e


# ---------------------------------------------------------------------------
# 数据加载（Supabase 零件 + 颜色映射 + 现有价格）
# ---------------------------------------------------------------------------
def supabase_query(table, columns="*"):
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={columns or '*'}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_system_parts():
    rows = supabase_query("parts", columns="part_num,color_id")
    keys = set()
    for r in rows:
        pn = str(r.get("part_num") or "").strip()
        cid = str(r.get("color_id") or "").strip()
        if pn and cid:
            keys.add((pn, cid))
    return keys


def load_bl_colors():
    data = json.loads(gitee_raw(BL_COLORS_JSON).decode("utf-8"))
    m = {}
    for rec in data if isinstance(data, list) else []:
        if rec.get("name") is not None:
            m[norm(rec["name"])] = rec.get("id")
    return m


def load_rb_color_names():
    text = gitee_raw(COLORS_CSV).decode("utf-8")
    m = {}
    lines = text.splitlines()
    if not lines:
        return m
    header = lines[0].split(",")
    id_col = next((i for i, h in enumerate(header) if h.strip() == "id"), None)
    name_col = next((i for i, h in enumerate(header) if h.strip() == "name"), None)
    if id_col is None or name_col is None:
        return m
    for line in lines[1:]:
        cells = line.split(",")
        if len(cells) <= max(id_col, name_col):
            continue
        m[cells[id_col].strip()] = cells[name_col].strip()
    return m


def load_existing_price():
    try:
        data = json.loads(gitee_raw(PRICE_JSON).decode("utf-8"))
    except Exception as e:
        raise SystemExit(f"加载远端 {PRICE_JSON} 失败: {e}")
    records = data.get("records", []) if isinstance(data, dict) else []
    by_key = {}
    for r in records:
        k = r.get("key")
        if k:
            by_key[k] = r
    return records, set(by_key.keys()), by_key


# ---------------------------------------------------------------------------
# Bricklink 价格网页抓取与解析（纯 urllib，无浏览器）
# ---------------------------------------------------------------------------
def extract_price_guide(html):
    """解析价格指南页 HTML，返回 last_6_months / current_for_sale（与新件列）。"""
    if not html:
        return None
    idx = html.find('Last 6 Months Sales')
    if idx < 0:
        return None
    section = html[idx:idx + 20000]
    pat = re.compile(
        r'<td>(Min Price|Qty Avg Price|Avg Price|Max Price):</td>\s*'
        r'<td><b>([A-Z]{2,3})?(?:\s|&nbsp;|\u00a0)*([\d,]+\.\d+)</b></td>',
        re.I)
    cells = {'min': [], 'avg': [], 'qty_avg': [], 'max': []}
    gmap = {'min price': 'min', 'avg price': 'avg',
            'qty avg price': 'qty_avg', 'max price': 'max'}
    for m in pat.finditer(section):
        key = gmap.get(m.group(1).lower())
        if not key:
            continue
        try:
            val = float(m.group(3).replace(',', ''))
        except ValueError:
            continue
        cells[key].append((m.group(2) or '').upper(), val)

    def block(col):
        def get(k):
            return cells[k][col][1] if col < len(cells[k]) else None
        def cur(k):
            return cells[k][col][0] if col < len(cells[k]) else ''
        vals = [get(k) for k in ('min', 'avg', 'qty_avg', 'max')]
        if all(v is None for v in vals):
            return None
        return {'currency': cur('min') or cur('avg') or cur('qty_avg') or cur('max'),
                'min': get('min'), 'avg': get('avg'),
                'qty_avg': get('qty_avg'), 'max': get('max')}

    return {'last_6_months': block(0), 'current_for_sale': block(2)}


def open_browser():
    """启动 Playwright 浏览器，返回 (page, context, browser, p)。

    引擎选择：
      - 默认 WebKit（Safari 内核），对 AWS-WAF 指纹伪装较好（你 Safari 能正常看价格页）。
      - 设 BLP_ENGINE=chromium|firefox 可切换（常用于排查）。
    默认无头；设 BLP_HEADED=1 弹真实窗口（最不易被识别）。
    """
    from playwright.sync_api import sync_playwright
    engine = os.getenv("BLP_ENGINE", "webkit")
    headed = os.getenv("BLP_HEADED") == "1"
    args = ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    if engine == "chromium":
        args.append("--disable-dev-shm-usage")
    p = sync_playwright().start()
    browser_cls = {"chromium": p.chromium, "firefox": p.firefox, "webkit": p.webkit}[engine]
    browser = browser_cls.launch(headless=not headed, args=args if engine == "chromium" else None)
    context = browser.new_context(
        user_agent=UA,
        viewport={'width': 1366, 'height': 850},
        locale='en-US',
        timezone_id='America/New_York')
    # 反自动化特征清理
    try:
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = window.chrome || { runtime: {} };
        """)
    except Exception:
        pass
    page = context.new_page()
    return page, context, browser, p


def fetch_bl_price(page, part, color_id):
    """在已打开的页面里抓取单个 Bricklink 价格指南页并解析。

    背景：BL 价格页在 AWS-WAF 之后，纯 urllib 只会收到 202 挑战页（无法执行 JS）。
    页面需由 Playwright 触发 WAF 挑战、渲染出价格后再调用本函数取 HTML。
    """
    clean = re.sub(r'[^a-zA-Z0-9]', '', part or '')
    if not clean:
        return None
    url = f"https://www.bricklink.com/catalogPG.asp?P={clean}&colorID={color_id}"
    try:
        resp = page.goto(url, wait_until='domcontentloaded', timeout=60000)
    except Exception as e:
        log(f"  {clean}/{color_id}: 跳转失败 {e}")
        return None
    # 轮询等待：出现价格锚点即停；出现明确拦截标记则提前退出（避免空等 60s）
    blocked_markers = ("aws-waf-token", "Access Denied", "Sorry, you have been blocked",
                       "Just a moment...", "Attention Required", "CAPTCHA")
    html, title, status = "", "", (resp.status if resp else "?")
    for _ in range(40):               # 40 * 1.5s = 60s 上限
        try:
            html = page.content()
        except Exception:
            html = ""
        if "Last 6 Months Sales" in html:
            break
        if any(mk in html for mk in blocked_markers):
            break
        try:
            page.wait_for_timeout(1500)
        except Exception:
            break
    try:
        title = page.title()
    except Exception:
        pass

    # ---- 诊断输出（供排障）----
    blob = None
    for probe in ("aws-waf-token", "Last 6 Months Sales", "Just Arrived",
                  "Access Denied", "challenge", "CAPTCHA", "Sorry, you have been blocked"):
        if probe in html:
            blob = probe
            break
    log(f"  诊断: HTTP={status} 标题=\"{title}\" 命中标记={blob or '无'} 页面长度={len(html)}")
    dbg_path = os.getenv("BLP_DEBUG_HTML")
    if dbg_path:
        try:
            with open(dbg_path, "w", encoding="utf-8") as f:
                f.write(f"# status={status} title={title}\n{html}")
            log(f"  已保存调试HTML: {dbg_path}")
        except Exception as e:
            log(f"  保存调试HTML失败: {e}")

    if "aws-waf-token" in html:
        log(f"  {clean}/{color_id}: 页面仍含 WAF token 未通过")
        return None
    return extract_price_guide(html)


def build_record(part, bl_cid, data):
    l6 = (data or {}).get('last_6_months') or {}
    cs = (data or {}).get('current_for_sale') or {}
    currency = l6.get('currency') or cs.get('currency') or ''
    return {
        "key": f"{re.sub(r'[^a-zA-Z0-9]', '', part)}:{bl_cid}",
        "part_num": re.sub(r'[^a-zA-Z0-9]', '', part),
        "color_id": str(bl_cid),
        "currency": currency,
        "last_6_months": (data or {}).get("last_6_months"),
        "current_for_sale": (data or {}).get("current_for_sale"),
        "source": "blp_direct",
        "saved_at": datetime.now().replace(microsecond=0).isoformat(),
    }


# ---------------------------------------------------------------------------
# 单件查询
# ---------------------------------------------------------------------------
def resolve_color_to_bl(color_arg, bl_cid_map):
    """颜色参数 -> BL 颜色 ID；支持数字或颜色名。"""
    if str(color_arg).isdigit():
        return str(color_arg)
    cid = bl_cid_map.get(norm(color_arg))
    if cid is not None:
        return str(cid)
    # 模糊匹配：找到含该词的第一个颜色
    for k, v in bl_cid_map.items():
        if norm(color_arg) in k:
            return str(v)
    return None


def query_single(args, bl_cid_map):
    part, color_arg = args.part, args.color
    cid = resolve_color_to_bl(color_arg, bl_cid_map)
    if cid is None:
        log(f"无法解析颜色: {color_arg}")
        return
    log(f"抓取 {part} / color {cid} ...")
    page, context, browser, p = open_browser()
    try:
        data = fetch_bl_price(page, part, cid)
    finally:
        p.stop()
    if not data:
        log("未获取到价格（被 WAF 拦截或解析失败）。")
        return
    l6 = data.get('last_6_months')
    cs = data.get('current_for_sale')
    print(f"\n=== {part} 颜色 {cid} ({color_arg}) ===")
    for label, block in (("Last6个月新件", l6), ("当前在售新件", cs)):
        if not block:
            print(f"  {label}: 无数据")
            continue
        cur = block.get('currency') or ''
        print(f"  {label}: min={cur}{block.get('min')} avg={cur}{block.get('avg')} "
              f"qty_avg={cur}{block.get('qty_avg')} max={cur}{block.get('max')}")


# ---------------------------------------------------------------------------
# 增量同步
# ---------------------------------------------------------------------------
def run_once(args):
    log("=== 开始增量同步(BLP 直连 BL 网页) ===")
    bl_cid_map = load_bl_colors()
    rb_cname_map = load_rb_color_names()
    inv_keys = load_system_parts()
    log(f"系统数据库去重零件组合: {len(inv_keys)}")

    rb2bl = {}
    for rb_id, rb_name in rb_cname_map.items():
        bl_id = bl_cid_map.get(norm(rb_name))
        if bl_id is not None:
            rb2bl[rb_id] = bl_id

    records, existing_keys, by_key = load_existing_price()
    log(f"现有价格 key: {len(existing_keys)}")

    todo = []
    seen = set()
    for rb_part, rb_color in inv_keys:
        bl_part = re.sub(r'[^a-zA-Z0-9]', '', rb_part or '')
        if not bl_part:
            continue
        bl_cid = rb2bl.get(rb_color)
        if bl_cid is None:
            continue
        bl_cid = str(bl_cid)
        key = f"{bl_part}:{bl_cid}"
        if key in existing_keys or key in seen:
            continue
        seen.add(key)
        todo.append((bl_part, bl_cid, key))
    log(f"新增待抓组合: {len(todo)}")

    if args.dry_run:
        for bl_part, bl_cid, key in todo[:30]:
            log(f"  [dry] {key}")
        log(f"dry-run：共 {len(todo)} 条待抓，退出未抓取未推送")
        return

    if not todo:
        log("无新增零件，完成。")
        return
    if args.max_fetch and len(todo) > args.max_fetch:
        todo = todo[:args.max_fetch]
        log(f"本轮仅处理前 {len(todo)} 条（其余下次继续）")

    ok = fail = 0
    log("启动 Chromium 浏览器...")
    page, context, browser, p = open_browser()
    try:
        for i, (bl_part, bl_cid, key) in enumerate(todo, 1):
            data = fetch_bl_price(page, bl_part, bl_cid)
            if data and (data.get('last_6_months') or data.get('current_for_sale')):
                records.append(build_record(bl_part, bl_cid, data))
                existing_keys.add(key)
                ok += 1
                l6 = data.get('last_6_months') or {}
                log(f"  [{i}/{len(todo)}] {key} avg={l6.get('avg')}")
            else:
                fail += 1
                log(f"  [{i}/{len(todo)}] {key} 无数据(跳过，下次重试)")
            if i % 10 == 0:
                _save_local(records)
            time.sleep(REQUEST_DELAY)
    finally:
        p.stop()

    _save_local(records)
    log(f"本轮：成功 {ok} / 跳过 {fail}，共 {len(records)} 条")

    if args.no_push:
        log("--no-push：未推送")
        return
    payload = {
        "generated_at": datetime.now().replace(microsecond=0).isoformat(),
        "updated_at": datetime.now().replace(microsecond=0).isoformat(),
        "count": len(records),
        "source": "blp_direct",
        "records": records,
    }
    content_b64 = base64.b64encode(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    status = gitee_push(PRICE_JSON, content_b64)
    if isinstance(status, int) and status in (200, 201):
        log(f"已推送 {PRICE_JSON}（HTTP {status}）")
    else:
        log(f"推送失败: {status}")


def _save_local(records):
    payload = {
        "generated_at": datetime.now().replace(microsecond=0).isoformat(),
        "updated_at": datetime.now().replace(microsecond=0).isoformat(),
        "count": len(records),
        "source": "blp_direct",
        "records": records,
    }
    with open(os.path.join(BASE_DIR, PRICE_JSON), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="BLP — 本地直连 Bricklink 网页爬价格")
    parser.add_argument("part", nargs="?", help="BL 部件型号（单个查询用）")
    parser.add_argument("color", nargs="?", help="BL 颜色ID或颜色名（单个查询用）")
    parser.add_argument("--dry-run", action="store_true", help="只列增量，不抓不推")
    parser.add_argument("--max-fetch", type=int, default=0, help="本轮最多抓 N 条")
    parser.add_argument("--loop", type=int, default=0, help="每 N 分钟循环一轮")
    parser.add_argument("--no-push", action="store_true", help="抓完不推送")
    args = parser.parse_args()

    try:
        bl_cid_map = load_bl_colors()
    except Exception as e:
        log(f"加载 BL 颜色表失败: {e}")
        return 1

    if args.part and args.color:
        query_single(args, bl_cid_map)
        return 0

    while True:
        try:
            run_once(args)
        except Exception as e:
            log(f"本轮出错: {e}")
        if not args.loop:
            break
        log(f"等待 {args.loop} 分钟后下一轮...")
        time.sleep(args.loop * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())