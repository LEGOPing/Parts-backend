# coding: utf-8
"""
pythonista_proto.py — 端到端增量价格闭环（v6，独立 B 跑在 iPhone 上）

数据流（增量，非全量）：
    1. 直连 Supabase 系统库 parts 表 -> 去重的 (part_num, RB_color_id) 组合集合
    2. RB 颜色名 -> BL 颜色 id（colors.csv + bl_colors.json，可从 Gitee parts-rb 拉取）
    3. 拉取 Gitee 上现有 BL-price.json，得到已有价格 key
    4. 系统零件集合 - 已有 key = 新增待抓组合（已存在永不重抓，天然断点续跑）
    5. 用 WKWebView（真实 WebKit，绕 Bricklink WAF）逐页打开剩余组合抓价格
    6. 合并进 BL-price.json，回写 Gitee，前端继续读它做价格参考

    每轮只跑 max_len 条，多的下次继续，适合 iOS 短会话。
    * 界面为 full_modal：挡屏时到文件 App 看 progress.log / result.json 实时进度。

运行：Pythonista 打开本文件 -> 运行三角 -> 自动跑完并自动关界面。
可调：MAX_FETCH_PER_RUN 限制本轮条数；MANUAL_PARTS 非空则进入“手动直抓”自测模式（不走 Supabase/不推送）。
"""

import ui
import json
import time
import os
import re
import base64
import urllib.request
import urllib.error
import urllib.parse
import traceback
from datetime import datetime
from objc_util import on_main_thread

# ---------------------------------------------------------------------------
# 0) 可调参数
# ---------------------------------------------------------------------------
# ---- 抓取参数 ----
MAX_FETCH_PER_RUN = 30    # 本轮最多抓多少条（其余下次继续）
MAX_WAIT  = 90            # 单页最长等待价格段出现（秒）
POLL_STEP = 3             # 每次轮询间隔（秒）
JS_TO     = 8             # 单次 JS 调用超时（秒）

# ---- 手动自测模式：非空则只抓这些 (BLpart, BLcolor) 并写 result.json，不走 Supabase/不推送 ----
MANUAL_PARTS = []         # 例：[('3001','86'), ('3002','86')]

# ---- Gitee parts-rb（价格库 / 颜色表托管）----
GITEE_OWNER   = "legoping"
GITEE_REPO    = "parts-rb"
GITEE_BRANCH  = "main"
GITEE_TOKEN   = os.environ.get("GITEE_TOKEN", "5e8fe75044a023e2c992c1b5d11c95f0")
GITEE_RAW     = f"https://gitee.com/{GITEE_OWNER}/{GITEE_REPO}/raw/{GITEE_BRANCH}"
GITEE_API     = f"https://gitee.com/api/v5/repos/{GITEE_OWNER}/{GITEE_REPO}/contents"
PRICE_JSON    = "BL-price.json"   # 价格库文件名（回写 Gitee 的实体）
COLORS_CSV    = "colors.csv"      # RB 颜色表 id,name
BL_COLORS_JSON= "bl_colors.json"  # BL 颜色表 id,name

# ---- Supabase（系统数据库）----
SUPABASE_ANON = os.environ.get(
    "SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmeHlkbGtweGtkcHh5b3Fya2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMTA2NzQsImV4cCI6MjEwMDc4NjY3NH0.kNMlT3YXyXVV5Y_JHmDd-0vj1o_xFUFpV_uuWTVh-JI")

OUT_JSON = "result.json"   # 本地结果副本（边抓边落盘）
LOG_FILE = "progress.log"  # 实时日志

_TIMEOUT_S = 30


def _supabase_ref():
    p = SUPABASE_ANON.split('.')
    if len(p) < 2:
        return None
    b = p[1] + '=' * (-len(p[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(b.encode('ascii')).decode('utf-8')).get('ref')
    except Exception:
        return None


SUPABASE_URL = "https://%s.supabase.co" % (_supabase_ref() or "missing-ref")

_BASE    = os.path.dirname(os.path.abspath(__file__))
_webview = None   # 全局引用：绝不让 WKWebView 被 GC（闪退根因）
_results = []     # 本轮合并后的完整价格库 records（含既有 + 新抓）

# ---------------------------------------------------------------------------
# 1) 通用小函数
# ---------------------------------------------------------------------------
def _ts():
    return datetime.now().strftime('%H:%M:%S')


def log(msg):
    line = '[%s] %s' % (_ts(), msg)
    print(line, flush=True)
    try:
        with open(os.path.join(_BASE, LOG_FILE), 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def norm(s):
    return re.sub(r'[^a-z0-9]', '', str(s or '').strip().lower())


def _http_read(url, timeout=_TIMEOUT_S):
    """GET 拉取字节，遇 429/网络错误短退避重试。返回 (ok, bytes|err)。"""
    delay = 1.0
    for attempt in range(5):
        req = urllib.request.Request(url, headers={"User-Agent": "BLP-Pythonista/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return True, resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                time.sleep(delay); delay = min(delay * 2, 40.0); continue
            return False, e
        except Exception as e:
            if attempt >= 4:
                return False, e
            time.sleep(delay); delay = min(delay * 2, 30.0)
    return False, None


def gitee_raw(path):
    ok, out = _http_read(f"{GITEE_RAW}/{path}")
    if not ok:
        raise RuntimeError(f"拉取 {path} 失败: {getattr(out, 'code', None) or out}")
    return out


# ---------------------------------------------------------------------------
# 2) 数据加载：颜色映射 / Supabase / 现有价格库
# ---------------------------------------------------------------------------
def load_bl_colors():
    """bl_colors.json -> {归一化BL颜色名: BL颜色ID}"""
    data = json.loads(gitee_raw(BL_COLORS_JSON).decode('utf-8'))
    m = {}
    for rec in (data if isinstance(data, list) else []):
        if rec.get('name') is not None:
            m[norm(rec['name'])] = rec.get('id')
    return m


def load_rb_color_names():
    """colors.csv -> {RB颜色ID: RB颜色名}"""
    lines = gitee_raw(COLORS_CSV).decode('utf-8').splitlines()
    m = {}
    if not lines:
        return m
    header = lines[0].split(',')
    id_c = next((i for i, h in enumerate(header) if h.strip() == 'id'), None)
    nm_c = next((i for i, h in enumerate(header) if h.strip() == 'name'), None)
    if id_c is None or nm_c is None:
        return m
    for line in lines[1:]:
        cell = line.split(',')
        if len(cell) > max(id_c, nm_c):
            m[cell[id_c].strip()] = cell[nm_c].strip()
    return m


def supabase_query(table, columns='*', filters=None):
    """调用 Supabase PostgREST，返回 JSON 列表。"""
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={columns or '*'}"
    for k, v in (filters or []):
        url += f"&{k}={urllib.parse.quote(str(v))}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Supabase 查询 {table} 失败: HTTP {e.code} "
                           f"{e.read().decode('utf-8', errors='ignore')[:200]}")
    except Exception as e:
        raise RuntimeError(f"Supabase 查询 {table} 失败: {e}")


def load_system_parts():
    """读系统库 parts 表 -> 去重 (part_num, RB_color_id) 集合。"""
    rows = supabase_query('parts', columns='part_num,color_id')
    keys = set()
    for r in rows:
        pn = str(r.get('part_num') or '').strip()
        cid = str(r.get('color_id') or '').strip()
        if pn and cid:
            keys.add((pn, cid))
    return keys


def load_existing_price():
    """当前 BL-price.json -> (records:list, by_key:dict)"""
    try:
        data = json.loads(gitee_raw(PRICE_JSON).decode('utf-8'))
    except Exception as e:
        log('远端 BL-price.json 读取失败(%s)，按空库开始' % e)
        return [], {}
    records = data.get('records', []) if isinstance(data, dict) else []
    by_key = {}
    for r in records:
        if r.get('key'):
            by_key[r['key']] = r
    return records, by_key


# ---------------------------------------------------------------------------
# 3) Gitee 回写
# ---------------------------------------------------------------------------
def gitee_push_file(path, payload_b64):
    """推送(建/改)单个文件，429 退避重试。返回真/假。"""
    url = f"{GITEE_API}/{path}?access_token={GITEE_TOKEN}"
    got_sha = None
    ok, out = _http_read(url)
    if ok:
        try:
            d = json.loads(out.decode('utf-8'))
            got_sha = d.get('sha') if isinstance(d, dict) else None
        except Exception:
            got_sha = None
    body = {
        "access_token": GITEE_TOKEN,
        "content": payload_b64,
        "message": "feat: 增量更新 Bricklink 价格库 [skip ci]",
        "branch": GITEE_BRANCH,
    }
    if got_sha:
        body['sha'] = got_sha
    method = 'PUT' if got_sha else 'POST'
    data = json.dumps(body).encode('utf-8')
    delay = 1.0
    for attempt in range(6):
        req = urllib.request.Request(f"{GITEE_API}/{path}", data=data, method=method)
        req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
                return resp.status in (200, 201)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 5:
                time.sleep(delay); delay = min(delay * 2, 60.0); continue
            log(f'  推送 {path} 失败: HTTP {e.code} {e.read().decode("utf-8", errors="ignore")[:160]}')
            return False
        except Exception as e:
            if attempt >= 5:
                log(f'  推送 {path} 异常: {e}')
                return False
            time.sleep(delay); delay = min(delay * 2, 40.0)
    return False


def save_local(records):
    payload = full_payload(records)
    try:
        with open(os.path.join(_BASE, OUT_JSON), 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        log('  已写 result.json（当前 %d 条）' % len(records))
    except Exception as e:
        log('  写 result.json 失败: %s' % e)


def full_payload(records):
    now = datetime.now().replace(microsecond=0).isoformat()
    return {
        'generated_at': now,
        'updated_at': now,
        'count': len(records),
        'source': 'bl-webview',
        'records': records,
    }


# ---------------------------------------------------------------------------
# 4) 抽取函数（与 extract-price-on-safari.js 一致，字段兼容 BL-price.json）
# ---------------------------------------------------------------------------
EXTRACT_JS = r"""
function extractPriceGuide(page) {
  var idx = page.indexOf('Last 6 Months Sales');
  if (idx < 0) return null;
  var section = page.substring(idx, idx + 20000);
  var cells = { min: [], avg: [], qty_avg: [], max: [] };
  var gmap = { 'min price': 'min', 'avg price': 'avg',
               'qty avg price': 'qty_avg', 'max price': 'max' };
  var re = /<td[^>]*>\s*(Min Price|Qty Avg Price|Avg Price|Max Price):\s*<\/td>\s*<td[^>]*>\s*<b>\s*([A-Z]{2,3})?\s*(?:&nbsp;|\s|\u00a0)*([\d,]+\.\d+)\s*<\/b>/gi;
  var m;
  while ((m = re.exec(section)) !== null) {
    var key = gmap[String(m[1]).toLowerCase()];
    if (!key) continue;
    var val = parseFloat(String(m[3]).replace(/,/g, ''));
    if (isNaN(val)) continue;
    cells[key].push({ c: (m[2] || '').toUpperCase(), v: val });
  }
  function block(col) {
    function get(k) { return cells[k][col] ? cells[k][col].v : null; }
    function cur(k) { return cells[k][col] ? cells[k][col].c : ''; }
    var vals = [get('min'), get('avg'), get('qty_avg'), get('max')];
    if (vals.every(function (v) { return v === null; })) return null;
    return { currency: cur('min') || cur('avg') || cur('qty_avg') || cur('max'),
             min: get('min'), avg: get('avg'),
             qty_avg: get('qty_avg'), max: get('max') };
  }
  return { last_6_months: block(0), current_for_sale: block(2) };
}
(function () {
  try {
    var h = document.documentElement.outerHTML;
    var r = extractPriceGuide(h);
    if (!r) return 'NO_PRICE';
    return JSON.stringify(r);
  } catch (e) { return 'ERR:' + e; }
})();
"""


def _eval_js_timed(webview, js, timeout=JS_TO):
    box = {}
    def cb(value):
        box['set'] = True
        box['val'] = value
    try:
        webview.eval_js_async(js, cb)
    except Exception as e:
        box['set'] = True
        box['val'] = str(e)
    deadline = time.time() + timeout
    while time.time() < deadline and not box.get('set'):
        time.sleep(0.2)
    if box.get('set'):
        return box.get('val')
    return None


def _poll_price(webview, timeout=MAX_WAIT):
    deadline = time.time() + timeout
    while time.time() < deadline:
        last = _eval_js_timed(webview, EXTRACT_JS, timeout=JS_TO)
        if last is None:
            log('    JS 调用超时未返回（可能 WAF/页面挂起），继续等待...')
            time.sleep(POLL_STEP)
            continue
        last = '' if isinstance(last, (type(None), bool)) else str(last).strip()
        if last.startswith('ERR:'):
            log('    JS 错误: %s' % last)
            return None
        if last.startswith('NO_PRICE'):
            time.sleep(POLL_STEP)
            continue
        try:
            return json.loads(last)
        except Exception as e:
            log('    JSON 解析失败: %s | raw=%s' % (e, last[:200]))
            time.sleep(POLL_STEP)
            continue
    log('    超时未等到价格段')
    return None


def _start_load(webview, url):
    @on_main_thread
    def do():
        try:
            webview.load_url(url)
        except Exception as e:
            log('    load_url 失败: %s' % e)
    do()


NAV_JS = ("(function(){try{return (document.readyState||'')+'|'"
          "+(window.location.href||'');}catch(e){return 'ERR:'+e;}})();")


def _wait_nav(webview, part, bl_cid, timeout=MAX_WAIT):
    """触发 load 后等新页面真正就绪（readyState=complete 且 URL 指向该零件），
    避免加载未完成就从上一页残留 DOM 提取到错误价格。返回是否确认导航。"""
    want_part = 'P=' + part.upper()
    want_cid = 'colorID=' + str(bl_cid)
    deadline = time.time() + timeout
    while time.time() < deadline:
        val = _eval_js_timed(webview, NAV_JS, timeout=JS_TO)
        if val:
            s = str(val)
            if s.startswith('ERR:'):
                time.sleep(POLL_STEP)
                continue
            state, _, url = s.partition('|')
            if state == 'complete' and url:
                if want_part in url.upper() and want_cid in url:
                    return True
        time.sleep(POLL_STEP)
    return False


def _fetch_one(webview, part, bl_cid, idx, total):
    url = f"https://www.bricklink.com/catalogPG.asp?P={urllib.parse.quote(part)}&colorID={bl_cid}"
    log('=== [%d/%d] 打开 %s:%s -> %s' % (idx, total, part, bl_cid, url))
    _start_load(webview, url)
    if not _wait_nav(webview, part, bl_cid):
        log('    [%d/%d] 导航未确认（仍尝试），%s:%s' % (idx, total, part, bl_cid))
    data = _poll_price(webview)
    if not data:
        return None
    l6 = data.get('last_6_months') or {}
    key = '%s:%s' % (re.sub(r'[^a-zA-Z0-9]', '', part), bl_cid)
    rec = {
        'key': key,
        'part_num': re.sub(r'[^a-zA-Z0-9]', '', part),
        'color_id': str(bl_cid),
        'currency': l6.get('currency') or (data.get('current_for_sale') or {}).get('currency') or '',
        'last_6_months': data.get('last_6_months'),
        'current_for_sale': data.get('current_for_sale'),
        'source': 'bl-webview',
        'saved_at': datetime.now().replace(microsecond=0).isoformat(),
    }
    log('    [%d/%d] 成功 %s:%s avg=%s %s' % (
        idx, total, part, bl_cid, l6.get('avg'), l6.get('currency', '')))
    return rec


# ---------------------------------------------------------------------------
# 5) 后台工作线程：数据准备 + 逐页抓取 + 合并 + 回写
# ---------------------------------------------------------------------------
def _build_todo():
    """计算增量待抓列表。返回 [(part, bl_cid, key), ...]"""
    log('=== 数据准备 ===')
    bl_map = load_bl_colors()
    rb_names = load_rb_color_names()
    rb2bl = {}
    for rb_id, rb_name in rb_names.items():
        bl_id = bl_map.get(norm(rb_name))
        if bl_id is not None:
            rb2bl[rb_id] = str(bl_id)
    log('RB颜色->BL颜色 映射 %d 条' % len(rb2bl))

    inv = load_system_parts()
    log('系统库去重零件组合 %d 条' % len(inv))

    records, by_key = load_existing_price()
    global _results
    _results = records
    log('现有价格 key %d 条' % len(by_key))

    todo = []
    seen = set()
    for rb_part, rb_color in inv:
        bl_part = re.sub(r'[^a-zA-Z0-9]', '', rb_part or '')
        if not bl_part:
            continue
        bl_cid = rb2bl.get(rb_color)
        if bl_cid is None:
            continue
        key = f'{bl_part}:{bl_cid}'
        if key in by_key or key in seen:
            continue
        seen.add(key)
        todo.append((bl_part, bl_cid, key))
    log('新增待抓组合 %d 条' % len(todo))

    if MAX_FETCH_PER_RUN and len(todo) > MAX_FETCH_PER_RUN:
        todo = todo[:MAX_FETCH_PER_RUN]
        log('本轮仅处理前 %d 条，其余下次继续' % len(todo))
    return todo


def _run_closed_loop():
    global _results
    todo = _build_todo()
    if not todo:
        log('=== 无新增零件，最多只写一份本地副本 ===')
        save_local(_results)
        return

    ok = fail = 0
    for idx, (part, bl_cid, key) in enumerate(todo, start=1):
        rec = _fetch_one(_webview, part, bl_cid, idx, len(todo))
        if rec:
            _results.append(rec)
            ok += 1
        else:
            fail += 1
            log('    [%d/%d] 跳过 %s:%s（未抓到，下次重试）' % (idx, len(todo), part, bl_cid))
        if (idx % 5) == 0:
            save_local(_results)

    save_local(_results)
    log('=== 本轮：成功 %d / 跳过 %d，共 %d 条 ===' % (ok, fail, len(_results)))

    # 回写 Gitee
    content_b64 = base64.b64encode(
        json.dumps(full_payload(_results), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    ).decode('ascii')
    if gitee_push_file(PRICE_JSON, content_b64):
        log('✓ 已回写 gitee%s/%s（%d 条）' % (GITEE_REPO, PRICE_JSON, len(_results)))
    else:
        log('✗ 回写 gitee 失败，本地副本已保留在 result.json')


@ui.in_background
def _worker():
    try:
        if MANUAL_PARTS:
            _run_manual()
        else:
            _run_closed_loop()
    except Exception:
        log('=== 后台线程异常 ===')
        log(traceback.format_exc())
        try:
            with open(os.path.join(_BASE, LOG_FILE), 'a', encoding='utf-8') as f:
                f.write('\nBACKTRACE:\n%s\n' % traceback.format_exc())
        except Exception:
            pass
    finally:
        # 无论成功还是异常，都关掉最后一个视图，让脚本自然结束，避免必须强关。
        _close_ui()


def _run_manual():
    """手工自测模式：直接抓 MANUAL_PARTS，写 result.json，不推送。"""
    global _results
    todo = []
    for p, c in MANUAL_PARTS:
        key = '%s:%s' % (re.sub(r'[^a-zA-Z0-9]', '', p), c)
        todo.append((p, c, key))
    _results = []
    log('手动自测模式，待抓 %d 组' % len(todo))
    ok = fail = 0
    for idx, (part, bl_cid, key) in enumerate(todo, start=1):
        rec = _fetch_one(_webview, part, bl_cid, idx, len(todo))
        if rec:
            _results.append(rec); ok += 1
        else:
            fail += 1
    save_local(_results)
    log('=== 手动模式完成：成功 %d / 跳过 %d ===' % (ok, fail))


def _close_ui():
    @on_main_thread
    def close():
        try:
            _webview.close()
        except Exception:
            pass
    close()


# ---------------------------------------------------------------------------
# 6) 主流程
# ---------------------------------------------------------------------------
def main():
    global _webview
    try:
        with open(os.path.join(_BASE, LOG_FILE), 'w', encoding='utf-8') as f:
            f.write('[%s] 启动闭环\n' % _ts())
    except Exception:
        pass
    log('=== 启动：增量价格闭环（独立 B / iPhone）===')
    log('提示：full_modal 挡屏时到文件 App 看 progress.log / result.json 实时进度。')
    _webview = WKWebView(name='BLP')
    _webview.present('full_modal')
    _worker()


from wkwebview import WKWebView  # noqa: E402 依赖导入放最后，主流程前注入

if __name__ == '__main__':
    try:
        main()
        # main() 返回后主线程交给 Pythonista 主 run loop 空转；full_modal 视图 +
        # 后台 _worker() 维持脚本存活且 run loop 正常泵动，on_main_thread 投递能执行。
        # worker 跑完会 _close_ui() 关闭最后一个视图，脚本随之自然结束。
    except Exception:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   LOG_FILE), 'a', encoding='utf-8') as f:
                f.write('\n[%s] FATAL:\n%s\n' % (_ts(), traceback.format_exc()))
        except Exception:
            pass
        traceback.print_exc()