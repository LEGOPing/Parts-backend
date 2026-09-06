#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pythonista 可运行的 Bricklink 增量价格同步脚本（纯标准库，无需 Playwright/浏览器）。

职责：
    定期对比 Gitee parts-rb 仓库中的"最新零件清单"和"价格库 BL-price.json"，
    只对"新增零件"(part_num,color_id) 增量抓取价格，合并回 BL-price.json 并推送，
    前端继续读取 Gitee 上的 BL-price.json 作为价格参考。

数据流：
    1. 从 Gitee 拉取最新的 inventory_parts 分片（PWA 新增零件会同步进来）
    2. 下载当前 BL-price.json，计算其中缺失的组合（增量）
    3. 用 urllib 直连 Bricklink 价格页（catalogPG.asp）抓增量价格（住宅 IP 通常可绕过 WAF）
    4. 合并写回 BL-price.json，推送到 Gitee

关键增量化：
    - 已存在的 key 永不重新抓取，天然断点续跑
    - 单次最多抓 --max-fetch 条，下次跑继续（适配 iOS 后台/短会话）

Pythonista 里定期运行：
    * 方案 A（推荐）：安装 pythonista-shell 后用 launchd cron
        pythonista-shell schedule-cron --name bl_price_sync --schedule "0 3 * * *" \
            "$(pythonista-shell script-path)/py_part_price_sync.py"
    * 方案 B：脚本自带常驻循环： python3 py_part_price_sync.py --loop 1440

用法：
    python3 py_part_price_sync.py                 # 跑一轮增量，抓完自动推送
    python3 py_part_price_sync.py --dry-run       # 只算增量并打印，不抓不推
    python3 py_part_price_sync.py --max-fetch 100 # 本轮最多抓 100 条
    python3 py_part_price_sync.py --loop 60       # 每 60 分钟循环一轮
    python3 py_part_price_sync.py --no-push       # 抓完不推送，仅更新本地
"""

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

# ---------------------------------------------------------------------------
# 配置（与现有 push_bl_price_to_gitee.py / push_inventory_parts_to_gitee.py 对齐）
# ---------------------------------------------------------------------------
GITEE_OWNER   = "legoping"
GITEE_REPO    = "parts-rb"
GITEE_BRANCH  = "main"
GITEE_TOKEN   = os.environ.get("GITEE_TOKEN", "5e8fe75044a023e2c992c1b5d11c95f0")

GITEE_RAW      = f"https://gitee.com/{GITEE_OWNER}/{GITEE_REPO}/raw/{GITEE_BRANCH}"
GITEE_API      = f"https://gitee.com/api/v5/repos/{GITEE_OWNER}/{GITEE_REPO}/contents"

PRICE_JSON     = "BL-price.json"           # 价格库（本地工作副本 + 推送到 Gitee）
COLORS_CSV     = "colors.csv"              # RB 颜色表 id,name
BL_COLORS_JSON = "bl_colors.json"          # BL 颜色表 id,name

# ---- Supabase（直连系统数据库的 parts 表）----
SUPABASE_ANON  = os.environ.get("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmeHlkbGtweGtkcHh5b3Fya2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMTA2NzQsImV4cCI6MjEwMDc4NjY3NH0.kNMlT3YXyXVV5Y_JHmDd-0vj1o_xFUFpV_uuWTVh-JI")


def _supabase_ref_from_jwt(token):
    """从 anon key(JWT) 中解码出 project ref，避免手抄出错。"""
    part = token.split('.')
    if len(part) < 2:
        return None
    b = part[1] + '=' * (-len(part[1]) % 4)
    try:
        import base64 as _b64
        data = json.loads(_b64.urlsafe_b64decode(b.encode("ascii")).decode("utf-8"))
        return data.get("ref")
    except Exception:
        return None


SUPABASE_URL = os.environ.get("SUPABASE_URL") or (
    "https://%s.supabase.co" % (_supabase_ref_from_jwt(SUPABASE_ANON) or "missing-ref"))

FETCH_TIMEOUT  = 30                        # 抓价格的单页超时（秒）
REQUEST_DELAY  = 4.0                       # 抓取间隔（秒），避免触发 BL 429
UA           = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def norm(s):
    return re.sub(r'[^a-z0-9]', '', str(s or '').strip().lower())


# ---------------------------------------------------------------------------
# Gitee 读写
# ---------------------------------------------------------------------------
def _http_read(url, retries=5):
    """GET 拉取文本，遇网络错误短退避重试。"""
    delay = 1.0
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": "Pythonista/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
                return True, resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries:
                time.sleep(delay); delay = min(delay * 2, 60.0)
                continue
            return False, e
        except Exception as e:
            if attempt >= retries:
                return False, e
            time.sleep(delay); delay = min(delay * 2, 40.0)
    return False, None


def gitee_raw(path):
    ok, out = _http_read(f"{GITEE_RAW}/{path}")
    if not ok:
        raise SystemExit(f"拉取 {path} 失败: {out}")
    return out


def get_file_sha(path):
    url = f"{GITEE_API}/{path}?access_token={GITEE_TOKEN}"
    ok, out = _http_read(url)
    if not ok:
        e = out
        if isinstance(e, urllib.error.HTTPError) and e.code == 404:
            return None
        log(f"获取 {path} SHA 失败: {e}")
        return None
    try:
        return json.loads(out.decode("utf-8")).get("sha")
    except Exception:
        return None


def gitee_push_file(path, payload_b64):
    """推送(建/改)单个文件，429 指数退避重试。返回 HTTP 状态码或错误对象。"""
    body = {
        "access_token": GITEE_TOKEN,
        "content": payload_b64,
        "message": "feat: 增量更新 Bricklink 价格库 [skip ci]",
        "branch": GITEE_BRANCH,
    }
    sha = get_file_sha(path)
    if sha:
        body["sha"] = sha
    method = "PUT" if sha else "POST"
    data = json.dumps(body).encode("utf-8")
    delay = 1.0
    for attempt in range(6):
        req = urllib.request.Request(f"{GITEE_API}/{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", "Pythonista/1.0")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 5:
                time.sleep(delay); delay = min(delay * 2, 60.0)
                continue
            return e.code
        except Exception as e:
            if attempt >= 5:
                return e
            time.sleep(delay); delay = min(delay * 2, 40.0)
    return 0


# ---------------------------------------------------------------------------
# 数据加载
# ---------------------------------------------------------------------------
def load_bl_colors():
    """bl_colors.json -> {归一化BL颜色名: BL颜色ID}"""
    try:
        data = json.loads(gitee_raw(BL_COLORS_JSON).decode("utf-8"))
    except Exception as e:
        raise SystemExit(f"加载 {BL_COLORS_JSON} 失败: {e}")
    m = {}
    for rec in data if isinstance(data, list) else []:
        if rec.get("name") is not None:
            m[norm(rec["name"])] = rec.get("id")
    return m


def load_rb_color_names():
    """colors.csv -> {RB颜色ID: RB颜色名}"""
    m = {}
    try:
        text = gitee_raw(COLORS_CSV).decode("utf-8")
    except Exception as e:
        raise SystemExit(f"加载 {COLORS_CSV} 失败: {e}")
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


def supabase_query(table, columns="*", filters=None):
    """调用 Supabase PostgREST，返回 JSON 列表。filters 形如 [("k","v"), ...] 作为查询参数。"""
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={columns or '*'}"
    if filters:
        for k, v in filters:
            url += f"&{k}={v}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Supabase 查询 {table} 失败: HTTP {e.code} {e.read().decode('utf-8', errors='ignore')[:200]}")
    except Exception as e:
        raise SystemExit(f"Supabase 查询 {table} 失败: {e}")


def load_system_parts():
    """直连 Supabase 读取系统数据库 parts 表，返回去重后的 (part_num, RB_color_id) 集合。"""
    rows = supabase_query("parts", columns="part_num,color_id")
    keys = set()
    for r in rows:
        pn = str(r.get("part_num") or "").strip()
        cid = str(r.get("color_id") or "").strip()
        if pn and cid:
            keys.add((pn, cid))
    return keys


def load_existing_price():
    """当前 BL-price.json -> (records:list, keys:set, by_key:dict)"""
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
# 价格抓取与解析（移植自 app/bricklink_price.py，纯正则）
# ---------------------------------------------------------------------------
def extract_price_guide(html):
    idx = html.find("Last 6 Months Sales")
    if idx < 0:
        return None
    section = html[idx:idx + 20000]
    pat = re.compile(
        r"<td>(Min Price|Qty Avg Price|Avg Price|Max Price):</td>\s*"
        r"<td><b>([A-Z]{2,3})?(?:\s|&nbsp;|\u00a0)*([\d,]+\.\d+)</b></td>",
        re.I,
    )
    cells = {"min": [], "avg": [], "qty_avg": [], "max": []}
    gmap = {"min price": "min", "avg price": "avg",
            "qty avg price": "qty_avg", "max price": "max"}
    for m in pat.finditer(section):
        key = gmap.get(m.group(1).lower())
        if not key:
            continue
        try:
            val = float(m.group(3).replace(",", ""))
        except ValueError:
            continue
        cells[key].append((m.group(2) or "").upper(), val)

    def block(col):
        def get(k):
            return cells[k][col][1] if col < len(cells[k]) else None
        def cur(k):
            return cells[k][col][0] if col < len(cells[k]) else ""
        vals = [get(k) for k in ("min", "avg", "qty_avg", "max")]
        if all(v is None for v in vals):
            return None
        return {"currency": cur("min") or cur("avg") or cur("qty_avg") or cur("max"),
                "min": get("min"), "avg": get("avg"),
                "qty_avg": get("qty_avg"), "max": get("max")}

    return {"last_6_months": block(0), "current_for_sale": block(2)}


def fetch_bl_price(part, color_id):
    """直连 Bricklink 价格页，返回解析结果；被 WAF 拦截或解析失败返回 None。"""
    clean = re.sub(r'[^a-zA-Z0-9]', '', part)
    url = f"https://www.bricklink.com/catalogPG.asp?P={clean}&colorID={color_id}"
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept-Language": "en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            if resp.status == 202:
                return None
            raw = resp.read()
    except Exception as e:
        log(f"  抓取 {clean}/{color_id} 连接失败: {e}")
        return None
    try:
        html = raw.decode("utf-8")
    except Exception:
        try:
            html = raw.decode("latin-1")
        except Exception:
            return None
    if "aws-waf-token" in html or ("challenge" in html and len(html) < 5000):
        return None
    return extract_price_guide(html)


def build_record(part, color_id, data):
    l6 = data.get("last_6_months") or {}
    cs = data.get("current_for_sale") or {}
    currency = l6.get("currency") or cs.get("currency") or ""
    return {
        "key": f"{re.sub(r'[^a-zA-Z0-9]', '', part)}:{color_id}",
        "part_num": re.sub(r'[^a-zA-Z0-9]', '', part),
        "color_id": color_id,
        "currency": currency,
        "last_6_months": l6,
        "current_for_sale": cs,
        "source": "pythonista",
        "saved_at": datetime.now().replace(microsecond=0).isoformat(),
    }


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def run_once(args):
    log("=== 开始增量同步 ===")
    bl_cid_map = load_bl_colors()
    rb_cname_map = load_rb_color_names()
    inv_keys = load_system_parts()   # 直连 Supabase 读系统数据库的零件
    log(f"系统数据库去重零件组合: {len(inv_keys)}")

    # RB color_id -> BL color_id
    rb2bl = {}
    for rb_id, rb_name in rb_cname_map.items():
        bl_id = bl_cid_map.get(norm(rb_name))
        if bl_id is not None:
            rb2bl[rb_id] = bl_id

    records, existing_keys, by_key = load_existing_price()
    log(f"现有价格 key: {len(existing_keys)}")

    # 计算增量
    from collections import OrderedDict
    todo = []
    seen = set()
    for rb_part, rb_color in inv_keys:
        bl_part = re.sub(r'[^a-zA-Z0-9]', '', rb_part or '')
        if not bl_part:
            continue
        bl_cid = rb2bl.get(rb_color)
        if bl_cid is None:
            continue
        key = f"{bl_part}:{bl_cid}"
        if key in existing_keys or key in seen:
            continue
        seen.add(key)
        todo.append((bl_part, bl_cid, key))
    log(f"新增待抓组合: {len(todo)}")

    if args.dry_run:
        for bl_part, bl_cid, key in todo[:20]:
            log(f"  [dry] {key}")
        log("dry-run 退出，未抓取未推送")
        return

    if not todo:
        log("无新增零件，完成。")
        return

    # 增量抓取（限制本轮数量，预留下次）
    if args.max_fetch and len(todo) > args.max_fetch:
        todo = todo[:args.max_fetch]
        log(f"本轮仅处理前 {len(todo)} 条（其余下次继续）")

    ok = fail = 0
    for i, (bl_part, bl_cid, key) in enumerate(todo, 1):
        data = fetch_bl_price(bl_part, bl_cid)
        if data and (data.get("last_6_months") or data.get("current_for_sale")):
            records.append(build_record(bl_part, bl_cid, data))
            existing_keys.add(key)
            ok += 1
            l6 = data.get("last_6_months") or {}
            log(f"  [{i}/{len(todo)}] {key} avg={l6.get('avg')}")
        else:
            fail += 1
            log(f"  [{i}/{len(todo)}] {key} 无数据(跳过，下次重试)")
        if i % 10 == 0:
            _save_local(records)
        time.sleep(REQUEST_DELAY)

    _save_local(records)
    log(f"本轮：成功 {ok} / 跳过 {fail}，共 {len(records)} 条")

    if args.no_push:
        log("--no-push 已设，未推送。")
        return

    # 推送
    payload = {
        "generated_at": datetime.now().replace(microsecond=0).isoformat(),
        "updated_at": datetime.now().replace(microsecond=0).isoformat(),
        "count": len(records),
        "source": "pythonista",
        "records": records,
    }
    content_b64 = base64.b64encode(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    status = gitee_push_file(PRICE_JSON, content_b64)
    if isinstance(status, int) and status in (200, 201):
        log(f"✓ 已推送 {PRICE_JSON}（HTTP {status}）")
    else:
        log(f"✗ 推送失败: {status}")


def _save_local(records):
    payload = {
        "generated_at": datetime.now().replace(microsecond=0).isoformat(),
        "updated_at": datetime.now().replace(microsecond=0).isoformat(),
        "count": len(records),
        "source": "pythonista",
        "records": records,
    }
    with open(os.path.join(BASE_DIR, PRICE_JSON), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def main():
    parser = argparse.ArgumentParser(description="Bricklink 增量价格同步（Pythonista 可用）")
    parser.add_argument("--dry-run", action="store_true", help="只算增量，不抓不推")
    parser.add_argument("--max-fetch", type=int, default=0, help="本轮最多抓 N 条")
    parser.add_argument("--loop", type=int, default=0, help="每 N 分钟循环一轮(0=单次)")
    parser.add_argument("--no-push", action="store_true", help="抓完不推送")
    args = parser.parse_args()

    while True:
        try:
            run_once(args)
        except Exception as e:
            log(f"本轮出错: {e}")
        if not args.loop:
            break
        log(f"等待 {args.loop} 分钟后下一轮...")
        time.sleep(args.loop * 60)


if __name__ == "__main__":
    main()