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
from datetime import datetime
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
OUT_JSON  = 'BL-price.json'      # 正式输出文件（顶层与字段格式对齐仓库 BL-price.json）
LOG_FILE  = 'progress.log'
# 颜色映射表 RB_BL_colors.csv：只读脚本同目录本地文件（离线、绝不联网，避免 iOS 下卡死）。
CSV_FILE   = 'RB_BL_colors.csv'
PARTS_FILE = 'parts_to_crawl.json'  # 正式待抓清单（可选）：[{"part":"98138","color":39}]，color 为 RB 颜色ID
MAX_WAIT  = 20      # 单页最长等待价格段出现（秒）；超过则跳过，处理下一个
POLL_STEP = 3       # 每次轮询间隔（秒）
JS_TO     = 8       # 单次 JS 调用的超时（秒）

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


def _load_parts_from_file():
    """若同目录存在 parts_to_crawl.json，用它覆盖 PARTS 作为正式待抓清单。
    条目：[{"part": "98138", "color": 39}]，其中 color 为 RB 颜色ID。"""
    global _N, PARTS
    path = os.path.join(_BASE, PARTS_FILE)
    if not os.path.exists(path):
        log('未找到 %s，使用内置样例 PARTS' % PARTS_FILE)
        return
    try:
        with open(path, encoding='utf-8') as f:
            lst = json.load(f)
        items = [(str(x['part']).strip(), str(x['color']).strip())
                 for x in lst if x.get('part') and x.get('color') is not None]
    except Exception as e:
        log('读取 %s 失败，使用内置样例 PARTS: %s' % (PARTS_FILE, e))
        return
    if not items:
        log('%s 为空，使用内置样例 PARTS' % PARTS_FILE)
        return
    # 去重并保持原顺序
    PARTS = list(dict.fromkeys(items))
    _N = len(PARTS)
    log('已从 %s 载入正式待抓清单 %d 条' % (PARTS_FILE, _N))


_load_parts_from_file()


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


def _poll_price(webview, timeout=MAX_WAIT):
    """反复带超时取价格 JSON。返回 dict 或 None。"""
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
        url = URL_TMPL.format(part=part, color=bl_color)
        log('=== [%d/%d] 打开 %s (RB色%s→BL色%s) -> %s' % (
            idx, _N, part, rb_color, bl_color, url))
        _start_load(_webview, url)
        data = _poll_price(_webview)
        if data:
            rec = _build_record(part, rb_color, bl_color, data)
            _results.append(rec)
            l6 = data.get('last_6_months') or {}
            log('    [%d/%d] 成功 %s:RB%s→BL%s avg=%s %s' % (
                idx, _N, part, rb_color, bl_color, l6.get('avg'), l6.get('currency', '')))
            save_results()
        else:
            log('    [%d/%d] 跳过 %s:%s（>%ds 未抓到，下次重试）' % (
                idx, _N, part, rb_color, MAX_WAIT))
            save_results()

    if STOP.is_set():
        log('=== 已手动停止，已抓 %d 条 ===' % len(_results))
    else:
        log('=== 全部处理完成，共 %d 条，成功 %d 条 ===' % (_N, len(_results)))

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
    # 每次启动清空旧 log，方便从 0 看
    try:
        with open(os.path.join(_BASE, LOG_FILE), 'w', encoding='utf-8') as f:
            f.write('[%s] 启动，待抓 %d 组 %s\n' % (
                _ts(), _N, [(p, c) for p, c in PARTS]))
    except Exception:
        pass
    log('共 %d 组待抓：%s（颜色为 RB 颜色ID，将映射为 BL 颜色ID）' % (
        _N, [(p, c) for p, c in PARTS]))
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