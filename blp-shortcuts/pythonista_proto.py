# coding: utf-8
"""
pythonista_proto.py — 「外壳 + 内嵌浏览器」最小原型（形态 3：单页验证）

目标：验证「Pythonista 外壳 + WKWebView」这条路，能否在 iPhone 上绕开 BL 的
WAF，像正常浏览器一样打开价格页并抓回价格。

数据流（最小链路）：
    1. 外壳(WKWebView) load_url 打开 BL 价格页 -> 由真实 WebKit 引擎完成 WAF 挑战
    2. 轮询等待页面加载完成（检测到 "Last 6 Months Sales" 价格段才继续）
    3. eval_js 在页面 DOM 上运行 extractPriceGuide（与 extract-price-on-safari.js 一致）
    4. 解析 JSON -> 打印 / 存为同目录 result.json

前置依赖（一次性）：
    WKWebView 封装需要 mikaelho/pythonista-webview 的 wkwebview.py：
    - 方式A(推荐)：在 Pythonista 的 console 里用 Stash 执行
        pip install pythonista-wkwebview
    - 方式B：从 https://github.com/mikaelho/pythonista-webview/raw/master/wkwebview.py
      下载 wkwebview.py，放到与本脚本同一目录（Pythonista 会把它当本地模块 import）。

运行：
    Pythonista 打开本文件 -> 点运行三角 -> 等几秒（页面加载+过WAF）-> 看 console 输出的 JSON，
    或看同目录 result.json。
    改下方单测零件：PART_MONO 和 COLOR_BL。
"""

# ---------------------------------------------------------------------------
# 0) 可调参数（单页验证：随便改成一个真实组合）
# ---------------------------------------------------------------------------
PART_MONO = '3001'   # 零件型号
COLOR_BL  = '86'     # BL 颜色 ID（注意：是 BL 的 id，不是系统库 RB 的 color_id）

URL_TMPL = 'https://www.bricklink.com/catalogPG.asp?P={part}&colorID={color}'
OUT_JSON = 'result.json'

# ---------------------------------------------------------------------------
# 1) 依赖 WKWebView 封装
# ---------------------------------------------------------------------------
try:
    from wkwebview import WKWebView
except ImportError as e:
    raise SystemExit(
        '缺少 wkwebview 模块。请先用 Stash 执行: pip install pythonista-wkwebview\n'
        '（或把 wkwebview.py 下载到本脚本同目录）\n原始错误: %s' % e)

import ui
import console
import json
import re
import threading
import time
from datetime import datetime

# ---------------------------------------------------------------------------
# 2) 抽取函数（从 extract-price-on-safari.js 原样移植，字段与 BL-price.json 兼容）
#    放在浏览器里执行，直接对当前页面 document 提取。
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

// 一次性执行：若页面已有价格段则返回 JSON 字符串，否则返回 'NO_PRICE'
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
# 3) 主流程
# ---------------------------------------------------------------------------
def fetch_one(webview, part, color_bl, timeout=60):
    """在已由外壳打开的 WKWebView 里，轮询等待页面出价并抽取。"""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        # 在后台线程调 eval_js（同步等待结果）
        last = webview.eval_js(EXTRACT_JS) or ''
        last = '' if isinstance(last, (type(None), bool)) else str(last)
        if last.startswith('ERR:'):
            print('  JS 错误:', last)
            return None
        if last == 'NO_PRICE':
            # 还没出价，多半仍在过 WAF 或加载，等一会再试
            time.sleep(2)
            continue
        # 拿到 JSON 字符串
        try:
            return json.loads(last)
        except Exception as e:
            print('  解析 JSON 失败:', e, '| raw=', last[:200])
            time.sleep(2)
            continue
    print('  超时未等到价格段（最后返回: %r）' % last)
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


def main():
    url = URL_TMPL.format(part=PART_MONO, color=COLOR_BL)
    print('打开:', url)

    # 外壳：内嵌 Safari 内核的 WKWebView
    webview = WKWebView()
    # full_modal 或 sheet 均可，界面用于过 WAF 挑战时也能瞟一眼
    webview.present('full_modal')
    webview.load_url(url)

    # 后台线程跑抽取（eval_js 同步必须在非主线程）
    import _thread
    result_holder = {}

    @ui.in_background
    def worker():
        data = fetch_one(webview, PART_MONO, COLOR_BL)
        if data:
            rec = build_record(PART_MONO, COLOR_BL, data)
            result_holder['rec'] = rec
            print('=== 抓取成功 ===')
            print(json.dumps(rec, ensure_ascii=False, indent=2))
            try:
                with open(OUT_JSON, 'w', encoding='utf-8') as f:
                    json.dump(rec, f, ensure_ascii=False, indent=2)
                print('已保存:', OUT_JSON)
            except Exception as e:
                print('保存失败:', e)
        else:
            print('未抓到价格。可能：WAF 未过 / 网络 / 该组合无价格数据。')

    worker()


if __name__ == '__main__':
    main()