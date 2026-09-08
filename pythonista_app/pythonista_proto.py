# coding: utf-8
"""
pythonista_proto.py — 「外壳 + 内嵌浏览器」原型（批量版 v4 · 边跑边落盘）

目标：在 iPhone 上用 Pythonista 外壳 + WKWebView（真实 WebKit 内核）绕开 BL 的
WAF，像正常浏览器一样逐页打开价格页、抓回价格，写成本地 BL-price.json。

v4 关键改动（解决「界面挡住 console，看不到进度/报错」）：
    运行时的每一步都【追加写】到 progress.log，每抓完一条立刻写 BL-price.json。
    这样即使 full_modal 全屏盖住 console，你也随时能在文件 App 里翻看
    progress.log / BL-price.json 看到实时进展，不用退界面。
    - 单次 JS 调用带 8s 超时（_eval_js_timed），避免 WKWebView 回调不返回而永久卡死。
    - 后台线程轮询驱动，不依赖加载回调，正常/超时都继续下一个，最终自动关界面。

v5 关键改动（颜色ID 映射方式与抓取超时）：
    - 颜色映射改为采用 RB_BL_colors.csv，直接用系统的颜色ID（表中 RB_color_ID / ID 列，
      即 Rebrickable 系统颜色ID）→ 匹配 BL 的颜色ID（表中 BL_color_ID 列），不再写死 BL 颜色ID。
    - PARTS 里的颜色改为填【系统的 RB 颜色ID】（同前端 rb_bl_map 直接映射逻辑）。
    - 单页抓价超时由 90s 缩短为 20s：超过 20 秒未抓到价格段即跳过，处理下一个。

v7 关键改动（修复 iPhone 启动挂起）：
    - 去掉启动时的 Gitee 联网下载：RB_BL_colors.csv 只读脚本同目录本地文件。
      映射加载移到后台线程，先弹界面再加载，缺失时明确报错并干净退出，
      彻底避免 iOS 下联网卡死 / 死循环挂起。

v10 关键改动（正式实施爬价）：
    - 输出改名为 BL-price.json，顶层与每条字段对齐仓库 BL-price.json
      （generated_at/updated_at/count/source/records；color_id 为 BL 颜色ID）。
    - 若同目录存在 parts_to_crawl.json，则覆盖 PARTS 作为正式待抓清单
      （条目 {"part","color"}，color 为 RB 颜色ID），否则用内置样例。

v11 关键改动（增量爬价）：
    - 读取上次生成的本地 BL-price.json 建索引：命中且 saved_at 未超过 REFRESH_DAYS(15) 天
      则直接沿用旧价（不重抓），否则重新爬取；整批结束自动上传最新 BL-price.json 到 Gitee。

v12 关键改动（正式建清单+爬价流程）：
    1. 从 Supabase 系统数据库 parts 表拉取最新零件（part_num + color_id)，
       保证清单只含系统里有的零件；按 (型号, 颜色) 去重、忽略状态等其它字段，形成 LP。
    2. 检查 BL-price.json（NP）：不存在则直接新建；存在则改名覆盖 BL-price.old（OP），再新建 NP。
    3. 若不存在 OP -> LP 全量爬价；若存在 OP -> 按 LP 顺序逐个判断：
       OP 有该零件记录 且 时间在 REUSE_DAYS(10) 天内 -> 沿用 OP 价格；否则重新 BL 爬价。
    4. 结果写入 NP，每 SAVE_EVERY(10) 条落盘一次，整批结束再落盘并自动上传 Gitee。

运行：
    Pythonista 打开本文件 -> 点运行三角 -> 等自动抓完。
    过程看 progress.log，结果看 BL-price.json。待抓清单看 parts_to_crawl.json。
"""

import ui
import json
import time
import csv
import io
import base64
import threading
import traceback
import os
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from objc_util import on_main_thread

# ---------------------------------------------------------------------------
# 0) 可调参数
# ---------------------------------------------------------------------------
# 待抓列表：(零件型号, 系统颜色ID=RB 颜色ID)。RB 颜色ID 会通过 RB_BL_colors.csv 映射成 BL 颜色ID。
# 例：Dark Bluish Gray 的 RB 颜色ID 是 72 → 映射为 BL 颜色ID 85。
PARTS = [
    ('3001', '72'),   # 1x1 Brick, Dark Bluish Gray (RB 72 → BL 85)
    ('3002', '72'),   # 1x2 Brick, Dark Bluish Gray (RB 72 → BL 85)
]
URL_TMPL  = 'https://www.bricklink.com/catalogPG.asp?P={part}&colorID={color}'
OUT_JSON  = 'BL-price.json'      # 现价文件（NP）：当前爬价/沿用后的结果
OP_JSON   = 'BL-price.old'       # 上一版价格文件（OP）：由 NP 改名而来，用于增量沿用判断
LOG_FILE  = 'progress.log'
# 颜色映射表 RB_BL_colors.csv：只读脚本同目录本地文件（离线、绝不联网，避免 iOS 下卡死）。
CSV_FILE   = 'RB_BL_colors.csv'
PARTS_FILE = 'parts_to_crawl.json'  # 兜底待抓清单（仅在 Supabase 不可用且此文件存在时读取）
MAX_WAIT  = 20      # 单页最长等待价格段出现（秒）；超过则跳过，处理下一个
POLL_STEP = 3       # 每次轮询间隔（秒）
JS_TO     = 8       # 单次 JS 调用的超时（秒）
REUSE_DAYS = 10     # 增量沿用窗口：OP 记录 saved_at 距今 ≤ 该天数则沿用，否则重新爬
SAVE_EVERY = 10     # 每攒够 N 条落盘一次 BL-price.json（降低频繁写盘/防网络抖动丢数据）

# --- Supabase 系统数据库：建清单源（步骤1），取系统里实际存在的零件 ---
SUPABASE_URL    = 'https://tfxydlkpxkdpxyoqrkez.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_EPZpWFRObklmwpfXerINvQ_S-OeeIM_'
SUPABASE_TABLE  = 'parts'           # 零件库存表（系统有的零件）
SUPABASE_FIELDS = 'part_num,color_id'  # 只取型号 + 颜色ID（RB 颜色ID）

# --- Gitee 自动上传配置（整批抓完或手动停止后，把 BL-price.json 推送到仓库根目录） ---
GITEE_BRANCH   = 'main'
GITEE_OWNER    = 'legoping'
GITEE_REPO     = 'parts-rb'
GITEE_TOKEN    = '5e8fe75044a023e2c992c1b5d11c95f0'
GITEE_TARGET   = 'BL-price.json'   # 上传到仓库根目录的此文件名
GITEE_API_BASE = 'https://gitee.com/api/v5/repos/%s/%s/contents' % (GITEE_OWNER, GITEE_REPO)

if not PARTS:
    PARTS = [('3001', '72')]

# ---------------------------------------------------------------------------
# 1) 依赖 WKWebView 封装
# ---------------------------------------------------------------------------
try:
    from wkwebview import WKWebView
except ImportError as e:
    raise SystemExit(
        '缺少 wkwebview 模块。请用 Stash: pip install pythonista-wkwebview\n'
        '（或把 wkwebview.py 放到 site-packages / 本脚本同目录）\n原始错误: %s' % e)


_webview = None   # 全局引用：绝不让 WKWebView 被 GC（闪退根因）
_results = []
_N       = len(PARTS)
_BASE    = os.path.dirname(os.path.abspath(__file__))
_RB_BL_MAP = {}  # { RB 颜色ID(int): BL 颜色ID(int) }，由 RB_BL_colors.csv 构建
STOP = threading.Event()  # 手动停止信号：点顶栏【停止】后置位
DONE = threading.Event()  # 整批结束信号：用于让主线程安全退出进程
_status_label = None      # 顶栏状态标签（best-effort 更新）


# ---------------------------------------------------------------------------
# 1.1) RB 颜色ID → BL 颜色ID 直接映射（采用 RB_BL_colors.csv）
# ---------------------------------------------------------------------------
def _read_csv_text():
    """读取脚本同目录的 RB_BL_colors.csv；文件缺失则返回 ''（绝不联网，避免 iOS 下卡死）。"""
    local = os.path.join(_BASE, CSV_FILE)
    if os.path.exists(local):
        try:
            with open(local, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            log('读取本地 RB_BL_colors.csv 失败: %s' % e)
            return ''
    log('未找到本地 RB_BL_colors.csv（请与脚本放在同一文件夹）。')
    return ''


def build_rb_bl_map(text):
    """解析 RB_BL_colors.csv，构建 {RB 颜色ID: BL 颜色ID}。"""
    mapping = {}
    reader = csv.DictReader(io.StringIO(text))
    for r in reader:
        # RB 颜色ID：兼容新表头 RB_color_ID / 旧表头 ID
        rb_raw = r.get('RB_color_ID') or r.get('ID')
        bl_raw = r.get('BL_color_ID')
        if rb_raw is None or bl_raw is None:
            continue
        rb_raw = str(rb_raw).strip()
        bl_raw = str(bl_raw).strip()
        if not rb_raw or not bl_raw:
            continue  # 无 Bricklink 对应（BL_color_ID 为空）或空行，跳过
        try:
            rb_id = int(float(rb_raw))
            bl_id = int(float(bl_raw))
        except (ValueError, TypeError):
            continue
        mapping[rb_id] = bl_id
    return mapping


def _ts():
    return datetime.now().strftime('%H:%M:%S')


def log(msg):
    global _status_label
    line = '[%s] %s' % (_ts(), msg)
    print(line, flush=True)
    try:
        with open(os.path.join(_BASE, LOG_FILE), 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass
    if _status_label is not None:
        @on_main_thread
        def _upd():
            try:
                _status_label.text = msg[:44]
            except Exception:
                pass
        _upd()


def _norm_part_color(v, is_color=False):
    """归一化：去除首尾空白；颜色统一成整数字符串（72 / 72.0 / ' 72' 都归为 '72'）。
    只保留 型号(v)、颜色(当 is_color)，忽略其它字段（如状态），避免价格条数虚高。"""
    s = str(v).strip()
    if is_color:
        try:
            return str(int(float(s)))
        except (ValueError, TypeError):
            return s
    return s


def _fetch_supabase_lp():
    """（步骤1）从 Supabase parts 表拉取系统里实际存在的零件 (part, RB颜色ID)。
    分页取全（limit+offset），返回归一化后的 (型号, 颜色) list；失败返回 None。"""
    items = []
    try:
        offset = 0
        while True:
            url = '%s/rest/v1/%s?select=%s&limit=1000&offset=%d' % (
                SUPABASE_URL, SUPABASE_TABLE, SUPABASE_FIELDS, offset)
            req = urllib.request.Request(url, headers={
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': 'Bearer %s' % SUPABASE_ANON_KEY,
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                rows = json.loads(resp.read().decode('utf-8'))
            if not rows:
                break
            for r in rows:
                p = r.get('part_num')
                c = r.get('color_id')
                if p is None or c is None:
                    continue
                items.append((_norm_part_color(p), _norm_part_color(c, True)))
            offset += len(rows)
            if len(rows) < 1000:
                break
        return items
    except Exception as e:
        log('  读取 Supabase %s.%s 失败: %s' % (SUPABASE_TABLE, SUPABASE_FIELDS, e))
        return None


def _load_parts_from_file():
    """兜底：Supabase 不可用且同目录存在 parts_to_crawl.json 时读取。
    条目：[{"part": "98138", "color": 39}]，color 为 RB 颜色ID。"""
    global _N, PARTS
    path = os.path.join(_BASE, PARTS_FILE)
    if not os.path.exists(path):
        log('未找到 %s，使用内置样例 PARTS' % PARTS_FILE)
        return
    try:
        with open(path, encoding='utf-8') as f:
            lst = json.load(f)
        items = []
        for x in lst:
            if not isinstance(x, dict):
                continue
            part = x.get('part')
            color = x.get('color')
            if part is None or color is None:
                continue
            items.append((_norm_part_color(part), _norm_part_color(color, True)))
    except Exception as e:
        log('读取 %s 失败，使用内置样例 PARTS: %s' % (PARTS_FILE, e))
        return
    _apply_lp(items, 'parts_to_crawl.json 兜底')


def _apply_lp(items, src):
    """（步骤2）按 (型号, 颜色) 去重、忽略状态等字段，形成 LP 并赋给 PARTS。"""
    global _N, PARTS
    if not items:
        log('  %s 无有效条目，使用内置样例 PARTS' % src)
        return
    before = len(items)
    PARTS = list(dict.fromkeys(items))
    _N = len(PARTS)
    if _N != before:
        log('  %s 载入 %d 条（去重掉 %d 条重复，按 型号+颜色 忽略状态）' % (
            src, _N, before - _N))
    else:
        log('  %s 载入 %d 条（型号+颜色唯一）' % (src, _N))


def _ensure_lp():
    """建清单入口：优先 Supabase（系统有的零件）；失败回退本地文件；再无则内置样例。"""
    items = _fetch_supabase_lp()
    if items is not None and items:
        _apply_lp(items, 'Supabase parts 表')
        return
    log('  Supabase 未取到数据，尝试 %s 兜底' % PARTS_FILE)
    _load_parts_from_file()
    if not PARTS:
        _apply_lp([('3001', '72'), ('3002', '72')], '内置样例')


def _rotate_np():
    """（步骤3）若 BL-price.json(NP) 存在，改名覆盖 BL-price.old(OP)；然后重置本地结果。
    返回是否有 OP（决定全量/增量模式）。"""
    np_path = os.path.join(_BASE, OUT_JSON)
    op_path = os.path.join(_BASE, OP_JSON)
    had_op = os.path.exists(op_path)
    if os.path.exists(np_path):
        try:
            os.replace(np_path, op_path)   # 覆盖同名 OP
            log('已把 %s 改名覆盖为 %s（上一版价格，用于增量沿用）' % (OUT_JSON, OP_JSON))
            had_op = True
        except Exception as e:
            log('改名 %s -> %s 失败: %s' % (OUT_JSON, OP_JSON, e))
    elif not had_op:
        log('无 %s 亦无 %s（首次或已删），本批将全量爬价' % (OUT_JSON, OP_JSON))
    else:
        log('无 %s，保留既有 %s 作为增量沿用源' % (OUT_JSON, OP_JSON))
    return had_op


def _load_existing_index(path=OP_JSON):
    """（步骤4）读取 OP(BL-price.old) 建立索引 {key: record}，用于增量沿用。
    key = '{part_num}:{BL color_id}'。文件不存在/解析失败 -> 空索引（全量爬价）。"""
    idx = {}
    full = os.path.join(_BASE, path)
    if not os.path.exists(full):
        log('未找到 %s，本批全量爬价（无上次价格可沿用）' % path)
        return idx
    try:
        with open(full, encoding='utf-8') as f:
            data = json.load(f)
        for rec in data.get('records', []):
            k = '%s:%s' % (rec.get('part_num'), rec.get('color_id'))
            if rec.get('part_num') is not None and rec.get('color_id') is not None:
                idx[k] = rec
        log('已读取 %s 共 %d 条（用于增量沿用判断）' % (path, len(idx)))
    except Exception as e:
        log('读取 %s 失败，本批全量爬价: %s' % (path, e))
    return idx


def _need_refresh(record):
    """记录是否需重新爬：saved_at 距今超过 REUSE_DAYS 天则为 True。"""
    if not record or 'saved_at' not in record:
        return True
    try:
        t = datetime.strptime(record['saved_at'], '%Y-%m-%dT%H:%M:%S')
    except Exception:
        return True
    return (datetime.now() - t).total_seconds() > REUSE_DAYS * 86400


def save_results():
    """把当前 _results 写盘。每次抓完一条调用，实现边跑边落盘。"""
    now = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    payload = {
        'generated_at': now,
        'updated_at': now,
        'count': len(_results),
        'source': 'bl-webview',
        'records': _results,
    }
    try:
        with open(os.path.join(_BASE, OUT_JSON), 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        log('  已写 %s（当前 %d 条）' % (OUT_JSON, len(_results)))
    except Exception as e:
        log('  写 %s 失败: %s' % (OUT_JSON, e))


def _upload_price_json():
    """把本地 BL-price.json 推送到 Gitee parts-rb 根目录。返回 True/False。

    失败只记录日志、不影响已完成的抓取结果。用 urllib 直连 Gitee API，
    不存在则 POST（创建），已存在则 PUT（更新，携带 sha）。"""
    if not GITEE_TOKEN:
        log('未配置 GITEE_TOKEN，跳过自动上传')
        return False
    try:
        with open(os.path.join(_BASE, OUT_JSON), 'rb') as f:
            raw = f.read()
    except Exception as e:
        log('  上传：读取 %s 失败: %s' % (OUT_JSON, e))
        return False
    if not raw:
        log('  上传：本地 %s 为空，跳过' % OUT_JSON)
        return False
    url = '%s/%s' % (GITEE_API_BASE, GITEE_TARGET)
    # 1) 查询仓库是否已有该文件（决定 POST 创建 或 PUT 更新）
    sha = None
    try:
        req = urllib.request.Request(
            url + '?ref=%s&access_token=%s' % (GITEE_BRANCH, GITEE_TOKEN), method='GET')
        with urllib.request.urlopen(req, timeout=20) as resp:
            d = json.loads(resp.read().decode('utf-8'))
            if isinstance(d, dict):
                sha = d.get('sha')
    except urllib.error.HTTPError as e:
        if e.code != 404:
            log('  上传：查询 Gitee 文件失败 HTTP %s' % e.code)
    except Exception as e:
        log('  上传：查询 Gitee 文件异常: %s' % e)
    # 2) 上传
    try:
        import json as _json
        n = len(_results)
        payload = {
            'access_token': GITEE_TOKEN,
            'content': base64.b64encode(raw).decode('ascii'),
            'message': 'feat: 更新 Bricklink 离线价格库（%d 条，pythonista 自动上传）[skip ci]' % n,
            'branch': GITEE_BRANCH,
        }
        if sha:
            payload['sha'] = sha
        method = 'PUT' if sha else 'POST'
        req = urllib.request.Request(
            url, data=_json.dumps(payload).encode('utf-8'), method=method)
        req.add_header('Content-Type', 'application/json;charset=utf-8')
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
        log('  ✓ 已上传 %s 到 Gitee（%d 条，%d 字节，%s）' % (
            GITEE_TARGET, len(_results), len(raw), method))
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'ignore')[:200]
        log('  ✗ 上传失败 HTTP %s: %s' % (e.code, body))
    except Exception as e:
        log('  ✗ 上传异常: %s' % e)
    return False


# ---------------------------------------------------------------------------
# 2) 抽取函数（从 extract-price-on-safari.js 原样移植，字段与 BL-price.json 兼容）
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
    """eval_js 带超时版：避免同步版在回调不返回时永久阻塞。"""
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
    return None   # 超时未返回


# 页面跳转校验：返回当前 document 的 URL 与加载状态，用于确认已真正跳到目标零件页。
NAVCHECK_JS = r"""
(function () {
  return JSON.stringify({ url: document.URL, ready: document.readyState });
})();
"""


def _is_target_page(payload, part, bl_color):
    """用 document.URL 校验是否已真正跳到目标零件页。
    关键：只有 URL 里同时含 P=<part> 与 colorID=<bl>、且页面不再处于 loading，
    才认为新页已就位。否则拿到的 outerHTML 仍是上一页/首屏的旧价格（根因）。"""
    try:
        d = json.loads(payload)
    except Exception:
        return False
    url = d.get('url', '') or ''
    ready = str(d.get('ready', ''))
    if ready == 'loading':
        return False
    # BRICKLINK catalogPG 页 URL 与请求保持一致（可能带额外参数），用 P= 与 colorID= 判定归属
    if ('P=%s' % str(part)) not in url:
        return False
    if ('colorID=%s' % str(bl_color)) not in url:
        return False
    return True


def _poll_price(webview, part, bl_color, timeout=MAX_WAIT):
    """阶段1：先等页面真正跳转到目标零件页；阶段2：再反复提取价格 JSON。
    返回 dict 或 None（超时未跳到目标页 / 未抓到价格段时返回 None，绝不返回旧页价格）。"""
    # ---- 阶段1：导航就绪校验（杜绝读到上一页/首屏价格）----
    deadline_nav = time.time() + timeout
    navigated = False
    while time.time() < deadline_nav:
        if STOP.is_set():
            return None
        check = _eval_js_timed(webview, NAVCHECK_JS, timeout=JS_TO)
        if check and _is_target_page(check, part, bl_color):
            navigated = True
            log('    已跳转到目标页 %s:%s 准备提取' % (part, bl_color))
            break
        if STOP.is_set():
            return None
        time.sleep(POLL_STEP)
    if not navigated:
        log('    页面未在 %ds 内跳转到 %s:%s（仍停在旧页/被 WAF 拦），跳过本零件' % (
            timeout, part, bl_color))
        return None
    # ---- 阶段2：页面已就位，再轮询取价格段 ----
    deadline = time.time() + timeout
    while time.time() < deadline:
        if STOP.is_set():
            return None
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


def _build_record(part, rb_color, bl_color, data):
    l6 = data.get('last_6_months') or {}
    cs = data.get('current_for_sale') or {}
    return {
        'key': '%s:%s' % (part, bl_color),
        'part_num': part,
        'color_id': bl_color,  # BL 颜色ID（与仓库 BL-price.json 的 color_id 字段一致）
        'currency': l6.get('currency') or cs.get('currency') or '',
        'last_6_months': data.get('last_6_months'),
        'current_for_sale': data.get('current_for_sale'),
        'source': 'bl-webview',
        'saved_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
    }


def _start_load(webview, url):
    """把 load_url 投递到主线程执行。"""
    @on_main_thread
    def do():
        try:
            webview.load_url(url)
        except Exception as e:
            log('    load_url 失败: %s' % e)
    do()


# ---------------------------------------------------------------------------
# 3) 后台工作线程：轮询驱动整批循环，边抓边落盘
#    用 threading.Thread 启动（不信赖 ui.in_background 的调度，避免后台不跑）
# ---------------------------------------------------------------------------
def _worker():
    global _results
    try:
        _batch()
    except Exception:
        log('=== 后台线程异常 ===')
        tb = traceback.format_exc()
        log(tb)
        try:
            with open(os.path.join(_BASE, LOG_FILE), 'a', encoding='utf-8') as f:
                f.write('\nBACKTRACE:\n%s\n' % tb)
        except Exception:
            pass
        # 即使后台崩了也尝试关界面，避免一直挡着
        @on_main_thread
        def close_ui():
            try:
                _webview.close()
            except Exception:
                pass
        close_ui()


def _batch():
    global _RB_BL_MAP
    # 在后台线程加载颜色映射（不再阻塞启动主线程）；失败则关界面退出，避免死循环
    _RB_BL_MAP = build_rb_bl_map(_read_csv_text())
    if not _RB_BL_MAP:
        log('错误：未能加载 RB_BL_colors.csv 颜色映射，程序退出。'
            '请把 RB_BL_colors.csv 放到脚本同目录后重试。')
        @on_main_thread
        def close_ui():
            try:
                _webview.close()
            except Exception as e:
                log('close 失败: %s' % e)
        close_ui()
        DONE.set()
        return
    log('已加载 RB→BL 颜色映射 %d 条（系统颜色ID=RB_color_ID，BL=BL_color_ID）' % len(_RB_BL_MAP))

    # ===== 步骤1-2：建抓取清单 LP（Supabase 系统数据库 → 型号+颜色去重忽略状态）=====
    _ensure_lp()
    log('共 %d 组待抓（LP）；颜色为 RB 颜色ID，将映射为 BL 颜色ID' % _N)

    # ===== 步骤3：NP/BLP 旋转：NP 存在则改名覆盖 BL-price.old，再新建 NP =====
    _rotate_np()

    # ===== 步骤4：用 OP(BL-price.old) 建索引做增量沿用；无 OP -> 全量 =====
    existing = _load_existing_index()
    _reused = 0

    for idx, (part, rb_color) in enumerate(PARTS, start=1):
        if STOP.is_set():
            log('用户已手动停止，中断剩余批次')
            break
        # 系统颜色ID（RB 颜色ID）→ BL 颜色ID：直接查 RB_BL_colors.csv 映射
        try:
            rb_color = str(rb_color).strip()
            rb_int = int(rb_color)
        except (ValueError, TypeError) as e:
            log('    [%d/%d] 跳过 %s:%s（RB 颜色ID非法: %s）' % (idx, _N, part, rb_color, e))
            continue
        bl_color = _RB_BL_MAP.get(rb_int)
        if bl_color is None:
            log('    [%d/%d] 跳过 %s:%s（RB 颜色ID在 RB_BL_colors.csv 无对应 BL 颜色ID）' % (
                idx, _N, part, rb_color))
            continue
        # --- 增量：OP 有记录且 saved_at ≤ REUSE_DAYS 天 -> 沿用 OP 价格，不爬 ---
        key = '%s:%s' % (part, bl_color)
        old = existing.get(key)
        if old is not None and not _need_refresh(old):
            _results.append(old)
            _reused += 1
            log('    [%d/%d] 沿用 OP 旧价 %s:%s（BL色%s，%s，未超过 %d 天）' % (
                idx, _N, part, rb_color, bl_color, old.get('saved_at'), REUSE_DAYS))
        else:
            if old is not None:
                log('    [%d/%d] 超 %d 天需刷新 %s:%s（BL色%s，上次 %s）' % (
                    idx, _N, REUSE_DAYS, part, rb_color, bl_color, old.get('saved_at')))
            url = URL_TMPL.format(part=part, color=bl_color)
            log('=== [%d/%d] 打开 %s (RB色%s→BL色%s) -> %s' % (
                idx, _N, part, rb_color, bl_color, url))
            _start_load(_webview, url)
            data = _poll_price(_webview, part, bl_color)
            if data:
                rec = _build_record(part, rb_color, bl_color, data)
                _results.append(rec)
                l6 = data.get('last_6_months') or {}
                log('    [%d/%d] 成功 %s:RB%s→BL%s avg=%s %s' % (
                    idx, _N, part, rb_color, bl_color,
                    l6.get('avg'), l6.get('currency', '')))
            else:
                log('    [%d/%d] 跳过 %s:%s（>%ds 未抓到，下次重试）' % (
                    idx, _N, part, rb_color, MAX_WAIT))
        # ===== 步骤5：每攒够 SAVE_EVERY 条落盘一次 NP =====
        if _results and len(_results) % SAVE_EVERY == 0:
            save_results()

    # 整批结束：无论是否攒够，统一落盘一次，确保全部沿用+新抓都写入 BL-price.json
    save_results()

    if STOP.is_set():
        log('=== 已手动停止，共用 %d 条（新抓 %d，沿用 %d）===' % (
            len(_results), len(_results) - _reused, _reused))
    else:
        log('=== 全部处理完成，共用 %d 条（新抓 %d，沿用旧价 %d）===' % (
            len(_results), len(_results) - _reused, _reused))

    # 整批结束后，把本地 BL-price.json 自动上传到 Gitee（失败不影响抓取结果）
    _upload_price_json()

    @on_main_thread
    def close_ui():
        try:
            _webview.close()
        except Exception as e:
            log('close 失败: %s' % e)
    close_ui()
    DONE.set()


# ---------------------------------------------------------------------------
# 4) 主流程
# ---------------------------------------------------------------------------
def _request_stop():
    """点顶栏【停止】：置位停止信号，后台循环会尽快退出并对询轮询中断。"""
    STOP.set()
    log('=== 用户手动停止 ===')


def _build_ui():
    """带顶栏的容器：顶栏放【停止】按钮 + 进度标签，下方内嵌 WKWebView。"""
    global _webview, _status_label
    bar_h = 50
    container = ui.View(name='BLP', background_color='#1c1c1e')
    bar = ui.View(background_color='#2c2c2e')
    btn = ui.Button(title='停止', font=('system', 16), tint_color='#ff453a')
    btn.action = lambda sender: _request_stop()
    label = ui.Label(text_color='white', font=('system', 13),
                     line_break_mode=ui.LB_TRUNCATE_TAIL)
    label.text = '准备中…'
    # 先 present 到全屏，再按容器实际尺寸排版（适配横竖屏/机型）
    container.present('full_modal')
    w, h = container.width, container.height
    bar.frame = (0, 0, w, bar_h)
    btn.frame = (12, (bar_h - 34) / 2, 64, 34)
    label.frame = (96, 0, w - 104, bar_h)
    bar.add_subview(btn)
    bar.add_subview(label)
    _webview = WKWebView(name='BLP', frame=(0, bar_h, w, h - bar_h))
    _status_label = label
    container.add_subview(bar)
    container.add_subview(_webview)


def main():
    global _webview
    # 每次启动清空旧 log，方便从 0 看（LP 在后台线程构建后打印具体条数）
    try:
        with open(os.path.join(_BASE, LOG_FILE), 'w', encoding='utf-8') as f:
            f.write('[%s] 启动，进入建清单+爬价流程\n' % _ts())
    except Exception:
        pass
    log('初始化完成，后台线程将：Supabase 建清单 -> NP/OP 旋转 -> 增量爬价 -> 每10条落盘')
    # 先弹带顶栏的界面，颜色映射在后台线程加载，避免启动挂起
    _build_ui()
    # 用守护线程跑后台循环：立即启动、不依赖 Pythonista 的 in_background 调度
    threading.Thread(target=_worker, daemon=True).start()

if __name__ == '__main__':
    try:
        main()
        # 直到处理完成或被手动停止再退出，避免进程常驻导致「无法停止」
        while not (STOP.is_set() or DONE.is_set()):
            time.sleep(1)
    except Exception:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   LOG_FILE), 'a', encoding='utf-8') as f:
                f.write('\n[%s] FATAL:\n%s\n' % (_ts(), traceback.format_exc()))
        except Exception:
            pass
        traceback.print_exc()