# coding: utf-8
"""
pythonista_proto.py — 「外壳 + 内嵌浏览器」最小原型（形态 3：单页验证）

目标：验证「Pythonista 外壳 + WKWebView」这条路，能否在 iPhone 上绕开 BL 的
WAF，像正常浏览器一样打开价格页并抓回价格。

数据流（最小链路）：
    1. 外壳(WKWebView) load_url 打开 BL 价格页 -> 由真实 WebKit 引擎完成 WAF 挑战
    2. 等 webview_did_finish_load 回调（页面加载完成）
    3. 在 @ui.in_background 后台回调里 eval_js 运行 extractPriceGuide
    4. 解析 JSON -> 打印 / 存为同目录 result.json

重要（沿用 wkwebview.py 官方 __main__ 样例的并发模型）：
    - WKWebView 必须被全局强引用，绝不能随函数返回被回收（闪退根因之一）。
    - webview_did_finish_load 用 @ui.in_background 装饰，让 eval_js 在后台线程跑；
      因为 eval_js 内部是 eval_js_queue.get() 阻塞，且回调是 @on_main_thread，
      必须在后台线程调用，主线程保持空闲以喂养回调。
    - 主线程不要长期阻塞（不要 wait()/sleep），脚本末尾保持存活即可。

运行：
    Pythonista 打开本文件 -> 点运行三角 -> 等几秒（加载+过WAF）-> 看 console 输出，
    或看同目录 result.json。改 PART_MONO / COLOR_BL 即可。
"""

# ---------------------------------------------------------------------------
# 0) 可调参数（单页验证）
# ---------------------------------------------------------------------------
PART_MONO = '3001'   # 零件型号
COLOR_BL  = '86'     # BL 颜色 ID（是 BL 的 id，不是系统库 RB 的 color_id）
URL_TMPL  = 'https://www.bricklink.com/catalogPG.asp?P={part}&colorID={color}'
OUT_JSON  = 'result.json'
MAX_WAIT  = 60   # 秒，最长等待价格段出现

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

# 全局引用：绝不让 WKWebView 被 GC（闪退根因）
_webview = None

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
# 3) 抽取流程（放在 @ui.in_background 里，让 eval_js 在后台线程跑）
# ---------------------------------------------------------------------------
def _fetch_and_extract(webview, part, color_bl, timeout=MAX_WAIT):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = webview.eval_js(EXTRACT_JS)
        except Exception as e:
            print('  eval_js 异常(稍后重试):', e, flush=True)
            time.sleep(3)
            continue
        last = '' if isinstance(last, (type(None), bool)) else str(last)
        if last.startswith('ERR:'):
            print('  JS 错误:', last, flush=True)
            return None
        if last == 'NO_PRICE':
            # 仍在过 WAF / 加载
            time.sleep(3)
            continue
        try:
            return json.loads(last)
        except Exception as e:
            print('  解析 JSON 失败:', e, '| raw=', last[:200], flush=True)
            time.sleep(3)
            continue
    print('  超时未等到价格段（最后返回: %r）' % (last,), flush=True)
    return None


def _on_done(webview, data):
    if data:
        now = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
        l6 = data.get('last_6_months') or {}
        cs = data.get('current_for_sale') or {}
        rec = {
            'key': '%s:%s' % (PART_MONO, COLOR_BL),
            'part_num': PART_MONO,
            'color_id': str(COLOR_BL),
            'currency': l6.get('currency') or cs.get('currency') or '',
            'last_6_months': data.get('last_6_months'),
            'current_for_sale': data.get('current_for_sale'),
            'source': 'pythonista-proto',
            'saved_at': now,
        }
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
    # 抓完主动关闭界面（投递到主线程）
    @on_main_thread
    def close_ui():
        try:
            webview.close()
        except Exception:
            pass
    close_ui()


# ---------------------------------------------------------------------------
# 4) delegate 类：通过 delegate=... kwargs 传给 WKWebView（官方样例模式）
#    @ui.in_background 让 eval_js 在后台线程跑（eval_js 内部阻塞等主线程回调）
# ---------------------------------------------------------------------------
class LoaderDelegate:
    """实现 WKWebView 的加载回调。用 @ui.in_background 包装让 eval_js 在后台线程跑。"""

    @ui.in_background
    def webview_did_finish_load(self, webview):
        print('[info] 页面加载完成，开始提取...', flush=True)
        data = _fetch_and_extract(webview, PART_MONO, COLOR_BL)
        _on_done(webview, data)

    @ui.in_background
    def webview_did_fail_load(self, webview, error_code, error_msg):
        print('[warn] 加载失败(%s): %s' % (error_code, error_msg), flush=True)
        # 失败也尝试提取一次（BL 可能已部分渲染 / 挑战已完成）
        data = _fetch_and_extract(webview, PART_MONO, COLOR_BL)
        _on_done(webview, data)


# ---------------------------------------------------------------------------
# 5) 主流程
# ---------------------------------------------------------------------------
def main():
    global _webview
    url = URL_TMPL.format(part=PART_MONO, color=COLOR_BL)
    print('打开:', url, flush=True)

    # 官方样例：delegate 作为 kwargs 传入（会经 super().__init__(**kwargs) 赋成 self.delegate）
    _webview = WKWebView(name='BLP', delegate=LoaderDelegate())
    _webview.present('full_modal')
    _webview.load_url(url)

    # 到此不 return：脚本保持存活（@ui.in_background 非 daemon 线程）让抽取完成。

if __name__ == '__main__':
    try:
        main()
        # 保持进程存活，同时把控制权交还主线程事件循环
        while True:
            time.sleep(60)
    except Exception:
        traceback.print_exc()