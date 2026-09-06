# coding: utf-8
"""
pythonista_proto.py — 「外壳 + 内嵌浏览器」原型（批量版 v2 · 轮询驱动）

目标：在 iPhone 上用 Pythonista 外壳 + WKWebView（真实 WebKit 内核）绕开 BL 的
WAF，像正常浏览器一样逐页打开价格页、抓回价格，写成本地 result.json。

v2 关键改动（修复 v1「卡在打开、回调不触发」）：
    v1 用「webview_did_finish_load 回调 → 下一步」驱动循环，在批量导航时不稳，
    碰到回调没触发就永远停在路上。
    v2 改为【单后台线程轮询驱动】：先 present 界面，另起一个后台线程，在
    那个线程里自己循环每个零件——每次 load_url 开页，随后反复 eval_js 轮询
    直到出现价格段。完全不依赖加载回调，轮询逻辑和单页版一致（已验证能拿价）。

数据流（每条）：
    1. 后台线程：load_url 打开 BL 价格页 -> 真实 WebKit 过 WAF
    2. 后台线程：重复 eval_js(EXTRACT_JS) 轮询，拿到价格 JSON 或超时
    3. 记录进 _results，继续下一个
    4. 全部处理完 -> 写 result.json + 自动关闭界面（投递到主线程）

运行：
    Pythonista 打开本文件 -> 点运行三角 -> 等全部抓完自动关。
    结果在 result.json（records 数组，与 BL-price.json 同构）。
    要抓的连接改 PARTS，每项是 (part_num, BL颜色ID)。
"""

# ---------------------------------------------------------------------------
# 0) 可调参数
# ---------------------------------------------------------------------------
# 待抓列表：(零件型号, BL 颜色 ID)。BL 颜色 ID 是 BL 的 id，需先做 RB->BL 映射。
PARTS = [
    ('3001', '86'),   # 1x1 Brick, Dark Bluish Gray
    ('3002', '86'),   # 1x2 Brick, Dark Bluish Gray
    # 追加更多 ('3001', '7'), ...
]

URL_TMPL  = 'https://www.bricklink.com/catalogPG.asp?P={part}&colorID={color}'
OUT_JSON  = 'result.json'
MAX_WAIT  = 60   # 单页最长等待价格段出现（秒），超时则标记跳过并继续下一个
POLL_STEP = 3    # 每次轮询间隔（秒）

if not PARTS:
    PARTS = [('3001', '86')]

# ---------------------------------------------------------------------------
# 1) 依赖 WKWebView 封装
# ---------------------------------------------------------------------------
try:
    from wkwebview import WKWebView
except ImportError as e:
    raise SystemExit(
        '缺少 wkwebview 模块。请用 Stash: pip install pythonista-wkwebview\n'
        '（或把 wkwebview.py 放到 site-packages / 本脚本同目录）\n原始错误: %s' % e)

import ui
import json
import time
import traceback
from datetime import datetime
from objc_util import on_main_thread

_webview  = None   # 全局引用：绝不让 WKWebView 被 GC（闪退根因）
_results  = []
_N        = len(PARTS)

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


def _poll_price(webview, timeout=MAX_WAIT):
    """反复 eval_js，直到拿到价格 JSON 或超时。返回 dict 或 None。"""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = _eval_js_timed(webview, EXTRACT_JS, timeout=8)
        if last is None:
            # 单次 JS 调用超时未返回（WAF/页面挂起迹象），打印后继续等
            print('    JS 调用超时未返回（可能 WAF/页面挂起），继续等待...', flush=True)
            time.sleep(POLL_STEP)
            continue
        last = '' if isinstance(last, (type(None), bool)) else str(last)
        if last.startswith('ERR:'):
            print('    JS 错误:', last, flush=True)
            return None
        if last == 'NO_PRICE':
            time.sleep(POLL_STEP)   # 仍在过 WAF / 加载
            continue
        try:
            return json.loads(last)
        except Exception as e:
            print('    JSON 解析失败:', e, '| raw=', last[:200], flush=True)
            time.sleep(POLL_STEP)
            continue
    print('    超时未等到价格段（最后返回: %r）' % (last,), flush=True)
    return None


def _eval_js_timed(webview, js, timeout=8):
    """eval_js 的带超时版本：避免同步版永久阻塞（WKWebView 回调不返回时会卡死线程）。"""
    box = {}
    def cb(value):
        box['set'] = True
        box['val'] = value
    try:
        webview.eval_js_async(js, cb)
    except Exception as e:
        box['set'] = True
        box['val'] = ('', None)
    deadline = time.time() + timeout
    while time.time() < deadline and not box.get('set'):
        time.sleep(0.2)
    if box.get('set'):
        return box.get('val')
    return None    # 超时未返回


def _build_record(part, color_bl, data):
    now = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    l6 = data.get('last_6_months') or {}
    cs = data.get('current_for_sale') or {}
    return {
        'key': '%s:%s' % (part, color_bl),
        'part_num': part,
        'color_id': str(color_bl),
        'currency': l6.get('currency') or cs.get('currency') or '',
        'last_6_months': data.get('last_6_months'),
        'current_for_sale': data.get('current_for_sale'),
        'source': 'pythonista-proto',
        'saved_at': now,
    }


def _start_load(webview, url):
    """把 load_url 投递到主线程执行（不回主线程的 WKWebView 调用不保险）。"""
    @on_main_thread
    def do():
        try:
            webview.load_url(url)
        except Exception as e:
            print('    load_url 失败:', e, flush=True)
    do()


# ---------------------------------------------------------------------------
# 3) 后台工作线程：轮询驱动整批循环
# ---------------------------------------------------------------------------
@ui.in_background
def _worker():
    global _results
    for idx, (part, color_bl) in enumerate(PARTS, start=1):
        url = URL_TMPL.format(part=part, color=color_bl)
        print('[%d/%d] 打开 %s:%s -> %s' % (idx, _N, part, color_bl, url), flush=True)
        _start_load(_webview, url)
        data = _poll_price(_webview)
        if data:
            rec = _build_record(part, color_bl, data)
            _results.append(rec)
            l6 = data.get('last_6_months') or {}
            print('  [%d/%d] 成功 %s:%s  avg=%s %s' % (
                idx, _N, part, color_bl, l6.get('avg'), l6.get('currency', '')),
                flush=True)
        else:
            print('  [%d/%d] 跳过 %s:%s（未抓到，下次重试）' % (
                idx, _N, part, color_bl), flush=True)

    print('=== 全部处理完成，共 %d 条，成功 %d 条 ===' % (_N, len(_results)), flush=True)
    payload = {
        'generated_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
        'count': len(_results),
        'records': _results,
    }
    try:
        with open(OUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print('已保存:', OUT_JSON, flush=True)
    except Exception as e:
        print('保存失败:', e, flush=True)

    @on_main_thread
    def close_ui():
        try:
            _webview.close()
        except Exception:
            pass
    close_ui()


# ---------------------------------------------------------------------------
# 4) 主流程：只在主线程 present（WKWebView 必须在主线程创建/展示）
# ---------------------------------------------------------------------------
def main():
    global _webview
    print('共 %d 组待抓：%s' % (_N, [(p, c) for p, c in PARTS]), flush=True)
    _webview = WKWebView(name='BLP')
    _webview.present('full_modal')
    _worker()   # @ui.in_background：自动切到后台线程跑，主线程继续空转

if __name__ == '__main__':
    try:
        main()
        while True:      # 保持进程存活，交还主线程事件循环供 eval_js 回调
            time.sleep(60)
    except Exception:
        traceback.print_exc()