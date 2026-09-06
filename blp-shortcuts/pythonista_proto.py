# coding: utf-8
"""
pythonista_proto.py — 「外壳 + 内嵌浏览器」最小原型（形态 3：单页验证）

目标：验证「Pythonista 外壳 + WKWebView」这条路，能否在 iPhone 上绕开 BL 的
WAF，像正常浏览器一样打开价格页并抓回价格。

数据流（最小链路）：
    1. 外壳(WKWebView) load_url 打开 BL 价格页 -> 由真实 WebKit 引擎完成 WAF 挑战
    2. 等待页面加载完成（WKWebView delegate: webview_did_finish_load）
    3. eval_js 在页面 DOM 上运行 extractPriceGuide（与 extract-price-on-safari.js 一致）
    4. 解析 JSON -> 打印 / 存为同目录 result.json

前置依赖（一次性）：
    WKWebView 封装需要 mikaelho/pythonista-webview 的 wkwebview.py：
    - 方式A：Stash 里执行  pip install pythonista-wkwebview
    - 方式B：把 wkwebview.py 放到 site-packages（或本脚本同目录）

运行：
    Pythonista 打开本文件 -> 点运行三角 -> 等几秒（页面加载+过WAF）-> 看 console 输出的 JSON，
    或看同目录 result.json。改下方单测零件 PART_MONO / COLOR_BL 即可。

并发模型（关键，避免闪退）：
    - WKWebView 的对象必须被全局强引用，嫩以不随 main() 返回而被回收。
    - eval_js 全程必须在后台线程调用（阻塞式），主线程用 ui.wait_for_exit() 保界面。
"""

# ---------------------------------------------------------------------------
# 0) 可调参数（单页验证）
# ---------------------------------------------------------------------------
PART_MONO = '3001'   # 零件型号
COLOR_BL  = '86'     # BL 颜色 ID（是 BL 的 id，不是系统库 RB 的 color_id）
URL_TMPL  = 'https://www.bricklink.com/catalogPG.asp?P={part}&colorID={color}'
OUT_JSON  = 'result.json'
PAGE_LOAD_TIMEOUT = 60   # 秒，等 BL 加载/过 WAF 的最长等待

# ---------------------------------------------------------------------------
# 1) 依赖 WKWebView 封装
# ---------------------------------------------------------------------------
try:
    from wkwebview import WKWebView
except ImportError as e:
    raise SystemExit(
        '缺少 wkwebview 模块。请先用 Stash 执行: pip install pythonista-wkwebview\n'
        '（或把 wkwebview.py 放到 site-packages / 本脚本同目录）\n原始错误: %s' % e)

import ui
import json
import time
import traceback
import threading
from datetime import datetime
from objc_util import on_main_thread  # 仅在后台线程向主线程投递 UI 时用

# 全局引用：绝不让 WKWebView 被 GC（闪退根因）
_webview = None
_done_event = threading.Event()

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
    return {
      currency: cur('min') || cur('avg') || cur('qty_avg') || cur('max'),
      min: get('min'), avg: get('avg'),
      qty_avg: get('qty_avg'), max: get('max')
    };
  }
  return { last_6_months: block(0), current_for_sale: block(2) };
}

(function () {
  try {
    var h = document.documentElement.outerHTML;
    var r = extractPriceGuide(h);
    if (!r) return 'NO_PRICE';
    return JSON.stringify(r);
  } catch (e) {
    return 'ERR:' + e;
  }
})();
"""

# ---------------------------------------------------------------------------
# 3) 加载完成回调：WKWebView delegate imposes 本对象
# ---------------------------------------------------------------------------
class Loader:
    """作为 WKWebView 的 delegate，在页面加载完成后被回调。"""
    def webview_did_finish_load(self, webview):
        print('[info] 页面加载完成，开始提取...', flush=True)
        # 真正的抽取在后台线程做，避免阻塞主线程
        threading.Thread(target=start_extract, daemon=True).start()

    def webview_did_fail_load(self, webview, message, error_code, host):
        print('[warn] 加载失败(%s): %s' % (host, message), flush=True)
        _done_event.set()
        # 失败也尝试提取一次（BL 可能部分渲染）
        threading.Thread(target=start_extract, daemon=True).start()


# ---------------------------------------------------------------------------
# 4) 抽取流程（后台线程，全程 eval_js）
# ---------------------------------------------------------------------------
def start_extract():
    global _webview
    wv = _webview
    if wv is None:
        print('错误: webview 未初始化', flush=True)
        _done_event.set()
        return
    data = fetch_one(wv, PART_MONO, COLOR_BL)
    if data:
        rec = build_record(PART_MONO, COLOR_BL, data)
        print('=== 抓取成功 ===', flush=True)
        print(json.dumps(rec, ensure_ascii=False, indent=2), flush=True)
        try:
            with open(OUT_JSON, 'w', encoding='utf-8') as f:
                json.dump(rec, f, ensure_ascii=False, indent=2)
            print('已保存:', OUT_JSON, flush=True)
        except Exception as e:
            print('保存失败:', e, flush=True)
    else:
        print('未抓到价格。可能：WAF 未过 / 网络 / 该组合无价格数据。', flush=True)
    _done_event.set()
    # 抓完主动关闭界面（主线程）
    @on_main_thread
    def close_ui():
        try:
            _webview.close()
        except Exception:
            pass
    close_ui()


def fetch_one(webview, part, color_bl, timeout=PAGE_LOAD_TIMEOUT):
    """在后台线程轮询 eval_js，直到 BL 价格段出现或超时。"""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = webview.eval_js(EXTRACT_JS)
        except Exception as e:
            print('  eval_js 异常(稍后重试):', e, flush=True)
            time.sleep(2)
            continue
        last = '' if isinstance(last, (type(None), bool)) else str(last)
        if last.startswith('ERR:'):
            print('  JS 错误:', last, flush=True)
            return None
        if last == 'NO_PRICE':
            time.sleep(2)   # 仍在过 WAF / 加载
            continue
        try:
            return json.loads(last)
        except Exception as e:
            print('  解析 JSON 失败:', e, '| raw=', last[:200], flush=True)
            time.sleep(2)
            continue
    print('  超时未等到价格段（最后返回: %r）' % (last,), flush=True)
    return None


def build_record(part, color_bl, data):
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


# ---------------------------------------------------------------------------
# 5) 主流程
# ---------------------------------------------------------------------------
def main():
    global _webview
    url = URL_TMPL.format(part=PART_MONO, color=COLOR_BL)
    print('打开:', url, flush=True)

    _webview = WKWebView(delegate=Loader())
    _webview.present('full_modal')
    _webview.load_url(url)

    # 主线程保持界面并等待后台抓取完成
    _done_event.wait(timeout=PAGE_LOAD_TIMEOUT + 20)
    print('脚本结束（可关闭）。', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()