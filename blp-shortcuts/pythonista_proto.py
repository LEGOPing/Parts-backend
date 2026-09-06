# coding: utf-8
"""
pythonista_proto.py — 「外壳 + 内嵌浏览器」原型（批量版）

目标：在 iPhone 上用 Pythonista 外壳 + WKWebView（真实 WebKit 内核）绕开 BL 的
WAF，像正常浏览器一样逐页打开价格页、抓回价格，写成本地 result.json。
本版是对「最小链路」的打磨：
    - 支持多零件循环（依次打开每个价格页抓取）
    - 抓完自动关闭界面（不用再手动退出）
    - 带进度提示（[i/N]、成功/跳过），没抓到就跳过继续下一个，不卡死一批

数据流（每条）：
    1. WKWebView load_url 打开 BL 价格页 -> 真实 WebKit 过 WAF
    2. webview_did_finish_load 回调 -> @ui.in_background 后台线程 eval_js 轮询价格段
    3. 提取 JSON -> 存进 _results
    4. 全部处理完 -> 写 result.json + 自动 close() 界面

运行：
    Pythonista 打开本文件 -> 点运行三角 -> 等全部抓完自动关。
    结果在 result.json（与 BL-price.json 同构：records 数组）。
    要抓的连接改 PARTS 即可，每项是 (part_num, BL颜色ID)。
"""

# ---------------------------------------------------------------------------
# 0) 可调参数
# ---------------------------------------------------------------------------
# 待抓列表：(零件型号, BL 颜色 ID)。BL 颜色 ID 是 BL 的 id，需先做 RB->BL 映射。
PARTS = [
    ('3001', '86'),   # 1x1 Brick, Dark Bluish Gray
    # 追加更多 ('3002', '86'), ('3001', '7'), ...
]

URL_TMPL  = 'https://www.bricklink.com/catalogPG.asp?P={part}&colorID={color}'
OUT_JSON  = 'result.json'
MAX_WAIT  = 60   # 单页最长等待价格段出现（秒），超时则标记跳过并继续下一个

# 预置一个连接，方便直接测试打包后的脚本（避免空列表跑空）
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

# 全局引用：绝不让 WKWebView 被 GC（闪退根因）
_webview = None
# 批处理状态
_queue   = list(PARTS)      # 待抓队列，pop(0) 依次处理
_current = None             # ('part','color') 当前正在抓的组合
_results = []               # 已成功抓取的结果记录
_N       = len(PARTS)

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
# 3) 单页轮询：直到价格段出现 / 超时
# ---------------------------------------------------------------------------
def _fetch_and_extract(webview, timeout=MAX_WAIT):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = webview.eval_js(EXTRACT_JS)
        except Exception as e:
            print('    eval_js 异常(稍后重试):', e, flush=True)
            time.sleep(3)
            continue
        last = '' if isinstance(last, (type(None), bool)) else str(last)
        if last.startswith('ERR:'):
            print('    JS 错误:', last, flush=True)
            return None
        if last == 'NO_PRICE':
            time.sleep(3)   # 仍在过 WAF / 加载，等待
            continue
        try:
            return json.loads(last)
        except Exception as e:
            print('    解析 JSON 失败:', e, '| raw=', last[:200], flush=True)
            time.sleep(3)
            continue
    print('    超时未等到价格段（最后返回: %r）' % (last,), flush=True)
    return None


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


# ---------------------------------------------------------------------------
# 4) 批处理推进：抓完当前 -> 下一个 -> 全部完成则写文件并关界面
# ---------------------------------------------------------------------------
def _progress_part(webview, part, color_bl):
    url = URL_TMPL.format(part=part, color=color_bl)
    print('[%d/%d] 打开 %s:%s -> %s' % (_N - len(_queue), _N, part, color_bl, url), flush=True)
    @on_main_thread
    def _do_load():
        try:
            webview.load_url(url)
        except Exception as e:
            print('    load_url 失败:', e, flush=True)
            _advance(webview)
    _do_load()


def _advance(webview):
    """处理完当前项后的推进逻辑：成功/失败都继续下一个，最后收尾。"""
    if _queue:
        part, color_bl = _queue.pop(0)
        _current = (part, color_bl)
        _progress_part(webview, part, color_bl)
    else:
        _finish(webview)


def _handle_one(webview, part, color_bl):
    """抓取当前项 -> 记录结果 -> 推进。"""
    print('  [%d/%d] 抓取 %s:%s ...' % (_N - len(_queue), _N, part, color_bl), flush=True)
    data = _fetch_and_extract(webview)
    if data:
        rec = _build_record(part, color_bl, data)
        _results.append(rec)
        print('  [%d/%d] 成功 %s:%s  avg=%s %s' % (
            _N - len(_queue), _N, part, color_bl,
            (data.get('last_6_months') or {}).get('avg'),
            (data.get('last_6_months') or {}).get('currency', '')), flush=True)
    else:
        print('  [%d/%d] 跳过 %s:%s（未抓到，下次重试）' % (
            _N - len(_queue), _N, part, color_bl), flush=True)
    _advance(webview)


def _finish(webview):
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
    # 抓完自动关闭界面
    @on_main_thread
    def close_ui():
        try:
            webview.close()
        except Exception:
            pass
    close_ui()


# ---------------------------------------------------------------------------
# 5) delegate：@ui.in_background 让 eval_js 在后台线程跑；load_url 回到主线程
# ---------------------------------------------------------------------------
class LoaderDelegate:

    @ui.in_background
    def webview_did_finish_load(self, webview):
        _handle_one(webview, _current[0], _current[1])

    @ui.in_background
    def webview_did_fail_load(self, webview, error_code, error_msg):
        print('[warn] 加载失败(%s): %s' % (error_code, error_msg), flush=True)
        _handle_one(webview, _current[0], _current[1])


# ---------------------------------------------------------------------------
# 6) 主流程
# ---------------------------------------------------------------------------
def main():
    global _webview, _current
    print('共 %d 组待抓：%s' % (_N, [(p, c) for p, c in PARTS]), flush=True)
    _webview = WKWebView(name='BLP', delegate=LoaderDelegate())
    _webview.present('full_modal')
    if _queue:
        part, color_bl = _queue.pop(0)
        _current = (part, color_bl)
        _progress_part(_webview, part, color_bl)

if __name__ == '__main__':
    try:
        main()
        # 保持进程存活（@ui.in_background 后台线程完成抽取），并把控制权交还主线程事件循环
        while True:
            time.sleep(60)
    except Exception:
        traceback.print_exc()