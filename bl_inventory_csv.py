#coding: utf-8
"""
bl_inventory_csv.py — 在 Pythonista 里抓 BrickLink 套装零件清单（重量 + Qty Avg Price）

核心反爬策略（来自 BLP.py / wkwebview.py 的验证经验）：
  1) 用 wkwebview.WKWebView（objc_util 封装的真 WKWebView）—— 走 iPhone Safari 内核过 AWS-WAF 挑战
  2) 注入反自动化脚本：navigator.webdriver→undefined + window.chrome
  3) 设置真实 Safari UA（iPhone iOS 17）
  4) 用 Navigation delegate 信号 + anchor JS 双保险判断"真内容到达"
  5) 完整拦截标记检测（aws-waf-token / Just a moment / Attention Required / Access Denied / CAPTCHA）
     —— 发现就提前退出，避免空等 60s
  6) 套装号自动 fallback：60011 → 60011-1 → 60011（如果用户带了后缀）

依赖：同目录下必须有 wkwebview.py（Gitee 上 parts-rb/main 已有）

用法（在 Pythonista 里）：
  直接运行，输入套装号，比如 60011
  CSV 输出到 ~/Documents/BL_{set}_{ts}.csv
"""

import json
import os
import queue
import re
import sys
import time
from datetime import datetime

try:
    from wkwebview import WKWebView
except ImportError:
    # 给个明确的错误提示，别让 Pythonista 报一串看不懂的堆栈
    print("""
❌ 缺少依赖 wkwebview.py

请把 wkwebview.py 下载到和本脚本同一个目录（~/Documents/套装零件清单/）：
  https://gitee.com/legoping/parts-rb/raw/main/wkwebview.py
""")
    sys.exit(1)


# ============================================================
# BrickLink URL 模板
# ============================================================
# viewID=Y 显示完整列（含 Inv ID），v=0 控制排序/视图版本
# rpp=500 每页条数（BrickLink 上限似乎在 1000 左右）
INV_URL = "https://www.bricklink.com/catalogItemInv.asp?S={set_no}&v=0&viewID=Y&rpp=500"
PART_URL = "https://www.bricklink.com/v2/catalog/catalogitem.page?P={part}"
PG_URL = "https://www.bricklink.com/catalogPG.asp?P={part}&colorID={color_id}"

# iPhone Safari UA（真实的 iOS 17）
SAFARI_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
             "Mobile/15E148 Safari/604.1")

# 反 webdriver 注入脚本（每次页面加载都会注入）
ANTI_WEBDRIVER_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
window.chrome = window.chrome || { runtime: {}, loadTimes: function(){}, csi: function(){}};
Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en', 'zh-CN']});
Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
"""

# ---- 拦截标记：一旦出现在 html 里就说明被 WAF 挡了 ----
BLOCKED_MARKERS = (
    "aws-waf-token",        # AWS WAF 挑战没通过
    "Just a moment...",     # Cloudflare 风格
    "Attention Required",   # 另一款 WAF
    "Access Denied",        # 直接拒绝
    "Sorry, you have been blocked",  # 明确封号
    "CAPTCHA",              # 验证码
    "Robot Check",          # 机器人检查
)

# ---- Anchor JS ---- 必须至少有一个命中才算"真内容到了" ----
INV_ANCHOR_JS = (
    "document.querySelectorAll("
    "'a[href*=\"catalogitem.page?P=\"], a[href*=\"catalogItemPic.asp?P=\"]'"
    ").length >= 1"
)
PART_WEIGHT_ANCHOR_JS = (
    "document.getElementById('item-weight-info') !== null || "
    "document.body.innerHTML.indexOf('Weight:') >= 0"
)
PRICE_ANCHOR_JS = (
    "document.body.innerHTML.indexOf('Last 6 Months Sales') >= 0"
)


# ============================================================
# JS 提取函数（全部在 BrickLink 页面内执行）
# ============================================================

JS_EXTRACT_INVENTORY = r"""
(() => {
  var rows = [];
  var seen = new Set();

  var trs = document.querySelectorAll('table tr');
  for (var i = 0; i < trs.length; i++) {
    var tr = trs[i];
    var partLink = tr.querySelector(
      'a[href*="catalogitem.page?P="], a[href*="catalogItemPic.asp?P="]'
    );
    if (!partLink) continue;

    var href = partLink.getAttribute('href') || '';
    var pm = href.match(/[?&]P=([A-Za-z0-9]+)/);
    if (!pm) continue;
    var partText = pm[1];

    // 颜色 ID
    var colorId = '';
    var cm = href.match(/[?&]colorID=(-?\d+)/i);
    if (cm) {
      colorId = cm[1];
    } else {
      var colorLink = tr.querySelector('a[href*="colorID="]');
      if (colorLink) {
        var ch = colorLink.getAttribute('href') || '';
        var cm2 = ch.match(/[?&]colorID=(-?\d+)/i);
        if (cm2) colorId = cm2[1];
      }
    }

    // Qty：取同 tr 里最大的纯数字 td
    var qty = 1;
    var trTds = tr.querySelectorAll('td');
    var candidates = [];
    for (var c = 0; c < trTds.length; c++) {
      var tdTxt = (trTds[c].textContent || '').trim();
      var qm = tdTxt.match(/^([\d,]+)$/);
      if (!qm) continue;
      var n = parseInt(qm[1].replace(/,/g, ''));
      if (isNaN(n) || n <= 0 || n > 50000) continue;
      if (tdTxt === partText) continue;
      candidates.push(n);
    }
    if (candidates.length > 0) {
      candidates.sort(function(a, b) { return b - a; });
      qty = candidates[0];
    }

    // 描述
    var desc = '';
    var itemNoTd = partLink.closest('td');
    if (itemNoTd) {
      var allLinks = itemNoTd.querySelectorAll('a');
      for (var l = 0; l < allLinks.length; l++) {
        var at = (allLinks[l].textContent || '').trim();
        if (at && at !== partText && at.length > 2) {
          desc += (desc ? ' ' : '') + at;
        }
      }
      if (!desc) {
        var full = itemNoTd.textContent || '';
        desc = full.replace(partText, '').replace(/\s+/g, ' ').trim();
      }
    }
    if (desc.length > 100) desc = desc.substring(0, 100);

    var key = partText + '|' + colorId;
    if (seen.has(key)) {
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].part === partText && rows[r].color_id === colorId) {
          rows[r].qty += qty;
          break;
        }
      }
      continue;
    }
    seen.add(key);

    rows.push({
      part: partText,
      color_id: colorId || '-1',
      qty: qty,
      color_name: '',
      description: desc
    });
  }

  return JSON.stringify(rows);
})();
"""


JS_EXTRACT_WEIGHT = r"""
(() => {
  var el = document.getElementById('item-weight-info');
  if (el) {
    var m = el.textContent.match(/([\d.]+)\s*g/i);
    if (m) return m[1];
  }
  var html = document.body.innerHTML;
  var idx = html.search(/Weight[：:]\s*([\d.]+)\s*g/i);
  if (idx >= 0) {
    var m2 = html.substring(idx).match(/([\d.]+)\s*g/i);
    if (m2) return m2[1];
  }
  return '';
})();
"""


JS_EXTRACT_PRICE = r"""
(() => {
  var h = document.body.innerHTML;
  var re = /<td>(Min Price|Qty Avg Price|Avg Price|Max Price):<\/td>\s*<td[^>]*><b>([A-Z]{2,3})?(?:\s|&nbsp;|\u00a0)*([\d,]+\.\d+)<\/b>/gi;
  var cells = {min: [], avg: [], qty_avg: [], max: []};
  var gmap = {'min price': 'min', 'avg price': 'avg', 'qty avg price': 'qty_avg', 'max price': 'max'};
  var m;
  while ((m = re.exec(h)) !== null) {
    var k = gmap[(m[1] || '').toLowerCase()];
    if (!k) continue;
    var val = parseFloat((m[3] || '0').replace(/,/g, ''));
    cells[k].push({currency: (m[2] || '').toUpperCase(), val: val});
  }
  function col(idx) {
    return {
      currency: cells.avg[idx] ? cells.avg[idx].currency
               : cells.min[idx] ? cells.min[idx].currency
               : cells.qty_avg[idx] ? cells.qty_avg[idx].currency
               : '',
      min:      cells.min[idx] ? cells.min[idx].val : null,
      avg:      cells.avg[idx] ? cells.avg[idx].val : null,
      qty_avg:  cells.qty_avg[idx] ? cells.qty_avg[idx].val : null,
      max:      cells.max[idx] ? cells.max[idx].val : null,
    };
  }
  var result = {
    last_6_months:    cells.avg[0] || cells.qty_avg[0] || cells.min[0] ? col(0) : null,
    last_6_months_used: cells.avg[1] ? col(1) : null,
    current_for_sale: cells.avg[2] || cells.qty_avg[2] || cells.min[2] ? col(2) : null,
    current_for_sale_used: cells.avg[3] ? col(3) : null,
  };
  return JSON.stringify(result);
})();
"""


JS_HTML_SNIPPET = 'document.body.innerHTML.substring(0, 2000)'
JS_HTML_LEN = 'document.body.innerHTML.length'
JS_TITLE = 'document.title'
JS_HAS_BLOCKED = (
    'function(){ var h=document.body.innerHTML;'
    'var ms=["aws-waf-token","Just a moment","Attention Required",'
    '"Access Denied","Sorry, you have been blocked","CAPTCHA","Robot Check"];'
    'for(var i=0;i<ms.length;i++) if(h.indexOf(ms[i])>=0) return ms[i];'
    'return ""; }()'
)


# ============================================================
# 全局状态
# ============================================================
g_set_no = ""
g_inventory = []
g_results = []
g_weight_cache = {}


# ============================================================
# BLBrowser —— 基于 wkwebview.WKWebView 的浏览器驱动
# ============================================================

class _BLDelegate:
    """Navigation delegate —— 每次导航（含 WAF 触发的 reload）都会触发回调。"""
    def __init__(self, br):
        self.br = br

    def webview_did_finish_load(self, webview):
        # 每次导航完成都会触发（包括 AWS WAF 挑战页 JS 触发的 window.location.reload）
        self.br._nav_finished_count += 1
        self.br._sig_load_finished.set()

    def webview_did_fail_load(self, webview, error_code, error_msg):
        self.br._sig_load_error.set()
        self.br._last_error = f"WKWebView error {error_code}: {error_msg}"

    def webview_should_start_load(self, webview, url, nav_type):
        return True


class BLBrowser:
    def __init__(self, progress_cb=None):
        import threading
        self.progress_cb = progress_cb or (lambda msg: None)
        self._sig_load_finished = threading.Event()
        self._sig_load_error = threading.Event()
        self._last_error = None
        self._nav_finished_count = 0   # 统计 didFinish 触发次数（含 WAF 自动 reload）

        import ui
        self.container = ui.View()
        w, h = ui.get_screen_size()
        self.container.frame = (0, 0, w, h)

        self.wv = WKWebView(frame=self.container.bounds, flex='WH')
        self.wv.delegate = _BLDelegate(self)
        self.container.add_subview(self.wv)

        self.wv.add_script(ANTI_WEBDRIVER_JS, add_to_end=False)
        self.wv.user_agent = SAFARI_UA

    def show(self):
        self.container.present('fullscreen', hide_title_bar=False)

    def eval_js(self, js, timeout=10):
        return self.wv.eval_js(js)

    def _detect_blocked(self):
        try:
            marker = self.eval_js(JS_HAS_BLOCKED)
            if marker and isinstance(marker, str) and len(marker) > 0:
                return marker
        except Exception:
            pass
        return ''

    def goto(self, url, anchor_js=None, anchor_timeout=45):
        """
        加载 URL 并等待"真内容到达"。

        AWS WAF 挑战流程（两次导航）：
          第 1 次 didFinish：服务器返回挑战页 HTML（2 行 div + script）
                               JS 执行 AwsWafIntegration.getToken() → 自动 window.location.reload
          第 2 次 didFinish：带着 ws-waf-token 再次请求 → 真页面

        所以策略是：持续轮询
          (拦截标记消失) AND (anchor JS 命中)
        直到超时。期间会自然等到 WAF 自动 reload 完成。
        """
        self.progress_cb('→ 加载 ' + url[:90])

        self._sig_load_finished.clear()
        self._sig_load_error.clear()
        self._last_error = None
        self._nav_finished_count = 0

        self.wv.load_url(url)

        t0 = time.time()
        deadline = t0 + anchor_timeout
        last_log = 0
        nav_seen = 0
        still_blocked = False

        while time.time() < deadline:
            # 1) 等下一个 didFinish（每次导航都触发）
            self._sig_load_finished.clear()
            try:
                self._sig_load_finished.wait(timeout=min(5, deadline - time.time()))
            except Exception:
                pass

            # 2) 失败检查
            if self._sig_load_error.is_set():
                self.progress_cb(f'  ❌ WKWebView load 失败: {self._last_error}')
                return False

            if self._nav_finished_count > nav_seen:
                nav_seen = self._nav_finished_count
                cur_url = self.eval_js('location.href') or ''
                self.progress_cb(f'  📄 第 {nav_seen} 次加载完成（{cur_url[:80]}）')

            # 3) WAF/拦截标记
            blocked = self._detect_blocked()
            if blocked:
                if not still_blocked:
                    self.progress_cb(f'  🛡️  检测到拦截: {blocked}（等 JS 自动 reload...）')
                still_blocked = True
                # 检查是不是已经在挑战页卡很久了 —— 如果已经是第 3 次以上导航还卡，
                # 可能真过不了，手动触发一次 reload 试试
                if nav_seen >= 3:
                    self.progress_cb('  🔄 已卡 3+ 次导航还在挑战页，手动 reload 一次...')
                    try:
                        self.wv.reload()
                    except Exception:
                        pass
                    time.sleep(1.0)
                # 拦截还在 → 继续等（别 return False！WAF 可能下一次导航就过去了）
                time.sleep(1.0)
                continue
            else:
                if still_blocked:
                    self.progress_cb('  ✅ 拦截标记消失了（WAF 通过）')
                still_blocked = False

            # 4) anchor JS 检查
            if anchor_js:
                try:
                    r = self.eval_js(anchor_js)
                    if r:
                        self.progress_cb('  ✅ anchor 命中，真内容到了')
                        return True
                except Exception:
                    pass

            # 5) 进度日志（每 10s 一次）
            elapsed = int(time.time() - t0)
            if elapsed - last_log >= 10:
                last_log = elapsed
                extra = f' 拦截={"是" if still_blocked else "否"}'
                self.progress_cb(f'  ⏳ 等待中 ... {elapsed}s（导航 {nav_seen} 次）{extra}')

            time.sleep(1.0)

        # 超时
        self.progress_cb(f'  ⏰ 超时 ({anchor_timeout}s)，拦截={still_blocked}, 导航次数={nav_seen}')
        return False

    def dump_diagnostics(self):
        print('\n  ── 诊断 ──')
        try:
            title = self.eval_js(JS_TITLE) or '(空)'
            cur_url = self.eval_js('location.href') or '(空)'
            html_len = self.eval_js(JS_HTML_LEN) or 0
            blocked = self.eval_js(JS_HAS_BLOCKED) or '(无拦截)'
            html_head = self.eval_js(JS_HTML_SNIPPET) or '(空 body)'
            print(f'  标题          : {title}')
            print(f'  当前 URL      : {cur_url[:120]}')
            print(f'  HTML 长度     : {html_len}')
            print(f'  拦截标记      : {blocked}')
            print(f'  body 前 500字符:')
            print(f'  {html_head[:500]}')
            print(f'  ────────────\n')
        except Exception as e:
            print(f'  (诊断失败: {e})')


# ============================================================
# 主流程
# ============================================================

def set_progress(text):
    print(text, flush=True)


def _try_load_inventory(browser, set_no, anchor_timeout=45):
    """尝试加载指定套装的 inventory。"""
    inv_url = INV_URL.format(set_no=set_no)
    print(f'  尝试套装号: {set_no}')
    ok = browser.goto(inv_url, anchor_js=INV_ANCHOR_JS,
                      anchor_timeout=anchor_timeout)

    raw = None
    if ok:
        raw = browser.eval_js(JS_EXTRACT_INVENTORY)
    inv = []
    if isinstance(raw, str):
        try:
            inv = json.loads(raw)
        except json.JSONDecodeError as e:
            print(f'  ❌ JSON 解析失败: {e}  raw前200={raw[:200]!r}')

    if inv:
        return inv, set_no
    return [], set_no


def run():
    global g_set_no, g_inventory, g_results

    # --- 1. 输入套装号 ---
    if len(sys.argv) > 1:
        user_input = sys.argv[1]
    else:
        try:
            user_input = input('乐高套装型号 (如 75290): ')
        except EOFError:
            user_input = ''
    user_input = (user_input or '').strip()
    if not user_input:
        print('未输入套装号，退出')
        return

    print('=' * 50)
    print('套装:', user_input)
    print('=' * 50)

    browser = BLBrowser(progress_cb=set_progress)
    browser.show()
    time.sleep(1.5)  # 等容器 + WKWebView 初始化 + UA 生效

    # --- 2. 抓 inventory（带 fallback） ---
    print('\n[1/3] 加载零件清单 ...')
    g_inventory, used_no = _try_load_inventory(browser, user_input)

    # Fallback 1：没后缀 → 补 -1
    if not g_inventory and '-' not in user_input:
        print(f'  ⚠️  没抓到零件，自动补 "-1" 后缀再试一次 ...')
        time.sleep(1.0)
        g_inventory, used_no = _try_load_inventory(browser, user_input + '-1')

    # Fallback 2：有后缀 → 试不带后缀
    elif not g_inventory and '-' in user_input:
        alt = user_input.split('-')[0]
        if alt != user_input:
            print(f'  ⚠️  没抓到零件，试不带后缀 "{alt}" ...')
            time.sleep(1.0)
            g_inventory, used_no = _try_load_inventory(browser, alt)

    g_set_no = used_no

    if not g_inventory:
        print('❌ 所有尝试都没抓到零件')
        browser.dump_diagnostics()
        time.sleep(3)
        try:
            browser.container.close()
        except Exception:
            pass
        return

    print(f'  ✓ 提取到 {len(g_inventory)} 个不重复零件 (用套装号: {g_set_no})')
    for it in g_inventory[:3]:
        print('    {part} | color={color_id} | qty={qty}'.format(**it))

    # --- 3. 抓每个零件的重量 + 价格 ---
    print(f'\n[2/3] 抓取重量与价格（共 {len(g_inventory)} 个零件）...')
    print('  (每个零件 ~2 个页面加载，整体会比较慢，请耐心等待)')

    for i, item in enumerate(g_inventory, 1):
        part = item['part']
        color_id = item.get('color_id', '-1')
        qty = item.get('qty', 1)

        # --- 3a. 重量（有缓存） ---
        weight_str = g_weight_cache.get(part)
        if not weight_str:
            part_url = PART_URL.format(part=part)
            ok_w = browser.goto(part_url, anchor_js=PART_WEIGHT_ANCHOR_JS,
                                anchor_timeout=25)
            if ok_w:
                weight_str = browser.eval_js(JS_EXTRACT_WEIGHT) or ''
            if weight_str:
                g_weight_cache[part] = weight_str

        try:
            weight_g = float(weight_str) if weight_str else 0.0
        except ValueError:
            weight_g = 0.0
        total_weight = round(weight_g * qty, 3)

        # --- 3b. 价格 ---
        pg_url = PG_URL.format(part=part, color_id=color_id)
        ok_p = browser.goto(pg_url, anchor_js=PRICE_ANCHOR_JS,
                            anchor_timeout=25)
        currency = ''
        qty_avg_price = None
        price_data = {}
        if ok_p:
            raw_p = browser.eval_js(JS_EXTRACT_PRICE)
            if isinstance(raw_p, str):
                try:
                    price_data = json.loads(raw_p)
                except json.JSONDecodeError:
                    pass
        # 优先 current_for_sale，其次 last_6_months
        block = (price_data.get('current_for_sale')
                 or price_data.get('last_6_months') or {})
        currency = block.get('currency', '')
        qty_avg_price = block.get('qty_avg')

        # --- 3c. 汇总 ---
        total_value = None
        if qty_avg_price is not None:
            try:
                total_value = round(float(qty_avg_price) * qty, 4)
            except (TypeError, ValueError):
                total_value = None

        g_results.append({
            'set_no': g_set_no,
            'part_no': part,
            'description': item.get('description', ''),
            'color_id': color_id,
            'qty': qty,
            'weight_g': weight_g,
            'total_weight_g': total_weight,
            'price_currency': currency,
            'unit_qty_avg_price': qty_avg_price,
            'total_value': total_value,
        })

        parts = []
        parts.append(f'[{i}/{len(g_inventory)}]')
        parts.append(f'{part} x{qty}')
        if weight_g:
            parts.append(f'{weight_g}g')
        if currency and qty_avg_price is not None:
            parts.append(f'{currency}{qty_avg_price}')
        print('  ' + ' | '.join(parts), flush=True)

        # 礼貌间隔
        time.sleep(0.8)

    # --- 4. 生成 CSV ---
    print(f'\n[3/3] 生成 CSV ...')
    out_dir = os.path.expanduser('~/Documents')
    if not os.path.isdir(out_dir):
        out_dir = os.path.expanduser('~')
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    out_path = os.path.join(out_dir, f'BL_{g_set_no}_{ts}.csv')

    cols = ['set_no', 'part_no', 'description', 'color_id', 'qty',
            'weight_g', 'total_weight_g', 'price_currency',
            'unit_qty_avg_price', 'total_value']

    try:
        import csv
        with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for row in g_results:
                w.writerow(row)
        print(f'✅ 完成！CSV: {out_path}')
        print(f'   共 {len(g_results)} 条记录')

        # 汇总
        total_parts = sum(r['qty'] for r in g_results)
        total_wt = round(sum(r['total_weight_g'] for r in g_results), 3)
        priced = [r for r in g_results if r['unit_qty_avg_price'] is not None]
        if priced:
            total_val = round(sum(r['total_value'] or 0 for r in priced), 2)
            cur = priced[0]['price_currency'] or ''
            print(f'   总零件数 : {total_parts}')
            print(f'   总重量   : {total_wt} g')
            print(f'   可估价   : {len(priced)}/{len(g_results)} 零件')
            print(f'   总估算价 : {cur}{total_val}')
    except Exception as e:
        print(f'❌ CSV 写入失败: {e}')
    finally:
        time.sleep(2)
        try:
            browser.container.close()
        except Exception:
            pass


def main():
    try:
        run()
    except KeyboardInterrupt:
        print('\n用户中断，退出')
    except Exception as e:
        print(f'\n❌ 运行出错: {e}')
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()
