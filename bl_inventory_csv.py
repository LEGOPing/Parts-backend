#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
乐高套装零件清单生成器（Pythonista / iPhone）
==============================================
在 BrickLink 查询指定套装的零件清单，批量获取每个零件的重量和 Qty Avg Price，
最后导出一份 CSV 清单。

为什么不用 API：
  BrickLink 的 catalogItemInv.asp / catalogPG.asp 位于 AWS WAF 之后，
  非浏览器请求会返回 HTTP 202 + JS 挑战页。本脚本使用 Pythonista
  的 ui.WebView（iOS WKWebView 内核）真实加载页面，自动通过挑战。

用法（在 Pythonista 里）：
  1. 把本脚本放到 Pythonista 的 Scripts 目录
  2. 运行，输入套装型号（如 75290-1 或 75290）
  3. 等待进度条走完 → 生成的 CSV 在 Pythonista 文档目录
"""

import csv
import json
import os
import re
import sys
import time
from datetime import datetime

import ui

# ---------- BrickLink URL 模板 ----------
# viewID=Y 显示完整列（含 Inv ID），v=0 控制排序/视图版本
# rpp=500 每页条数（大套装可能需要调更大，但 BrickLink 上限似乎在 1000 左右）
INV_URL = "https://www.bricklink.com/catalogItemInv.asp?S={set_no}&v=0&viewID=Y&rpp=500"
PART_URL = "https://www.bricklink.com/v2/catalog/catalogitem.page?P={part}"
PG_URL = "https://www.bricklink.com/catalogPG.asp?P={part}&colorID={color_id}"

# catalogItemInv 页专用 anchor — 必须至少有一个 Item No 链接出现才算真实加载成功
# （AWS WAF 挑战页本身 readyState=complete 但没有任何零件链接）
JS_INV_ANCHOR = (
    "document.querySelectorAll("
    "'a[href*=\"catalogitem.page?P=\"], a[href*=\"catalogItemPic.asp?P=\"]'"
    ").length >= 1"
)

# ---------- 全局状态 ----------
g_set_no = ""
g_inventory = []      # [{part, color_id, qty, color_name, description}, ...]
g_results = []         # 最终输出行
g_weight_cache = {}    # part → weight（跨套装复用）
g_done = False         # 主流程完成标志
g_last_error = None


# ============================================================
# JS 提取函数（全部在 BrickLink 页面内执行）
# ============================================================

# --- 从 inventory 页面提取零件列表（改进版） ---
JS_EXTRACT_INVENTORY = r"""
(() => {
  var rows = [];
  var seen = new Set();

  // === 策略 A：遍历所有行，按 Item No 链接定位 ===
  // BrickLink inventory 的每行里，"Item No" 列一定包含一个指向 catalogitem.page 的 <a>
  // 这是最可靠的锚点。从这个 <a> 的所在行我们可以同时拿到 Qty / 描述 / 颜色
  var trs = document.querySelectorAll('table tr');
  for (var i = 0; i < trs.length; i++) {
    var tr = trs[i];
    // Item No 链接有两种常见形式：
    //   v2 新版:  <a href="/v2/catalog/catalogitem.page?P=3001&colorID=7">3001</a>
    //   旧版:    <a href="/catalogItemPic.asp?P=3001&colorID=7">...</a>
    var partLink = tr.querySelector(
      'a[href*="catalogitem.page?P="], a[href*="catalogItemPic.asp?P="]'
    );
    if (!partLink) continue;

    var href = partLink.getAttribute('href') || '';
    // 提零件号（P= 后面的字母数字）
    var pm = href.match(/[?&]P=([A-Za-z0-9]+)/);
    if (!pm) continue;
    var partText = pm[1];

    // === 颜色 ID ===
    // 优先：从零件链接的 colorID 参数
    var colorId = '';
    var cm = href.match(/[?&]colorID=(-?\d+)/i);
    if (cm) {
      colorId = cm[1];
    } else {
      // 回退：看这个 <tr> 里有没有带 colorID 的其他链接
      var colorLink = tr.querySelector('a[href*="colorID="]');
      if (colorLink) {
        var ch = colorLink.getAttribute('href') || '';
        var cm2 = ch.match(/[?&]colorID=(-?\d+)/i);
        if (cm2) colorId = cm2[1];
      }
    }

    // === Qty ===
    // 方法 1：找 tr 里最独立的整数 <td>（排除 Item No 和 Inv ID 短数字）
    var qty = 1;
    var trTds = tr.querySelectorAll('td');
    // 根据 BrickLink 列顺序，viewID=Y 时：Inv ID | Image | Qty | Item No | Description | MID
    // 所以 Qty 通常是第 3 个 td（index 2）。但不要硬编码。
    // 找所有纯数字 td，排除明显的零件号和 ID
    var candidates = [];
    for (var c = 0; c < trTds.length; c++) {
      var tdTxt = (trTds[c].textContent || '').trim();
      // 尝试 "1,234" 或 "1" 格式
      var qm = tdTxt.match(/^([\d,]+)$/);
      if (!qm) continue;
      var n = parseInt(qm[1].replace(/,/g, ''));
      if (isNaN(n) || n <= 0 || n > 50000) continue;
      // 排除：等于 partText
      if (tdTxt === partText) continue;
      // 排除：太小（Inv ID 通常是 1-3 位，Qty 通常是 1+ 但也可能 1...）
      candidates.push({td: trTds[c], val: n});
    }
    // 如果找到多个，取值最大的那个（Qty 通常比 Inv ID 大）
    if (candidates.length > 0) {
      candidates.sort(function(a, b) { return b.val - a.val; });
      qty = candidates[0].val;
    }

    // === 描述 ===
    var desc = '';
    // Item No 链接所在 td 经常包含描述作为另一个 <a> 或文本
    var itemNoTd = partLink.closest('td');
    if (itemNoTd) {
      // 收集同 td 里除零件号链接外的其他 <a> 文本和纯文本节点
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

    // 去重 + 汇总 Qty（如果同 part+color 出现多次）
    var key = partText + '|' + colorId;
    if (seen.has(key)) {
      // 已存在，累加 qty
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

  // === 策略 B：如果策略 A 没抓到，全文正则兜底 ===
  if (rows.length === 0) {
    var html = document.body.innerHTML;
    var partRe = /catalogitem\.page\?P=([A-Za-z0-9]+)[^"]*?(?:colorID=(-?\d+))?/gi;
    var pm2;
    while ((pm2 = partRe.exec(html)) !== null) {
      var pt = pm2[1];
      var ci = pm2[2] || '-1';
      var k = pt + '|' + ci;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({part: pt, color_id: ci, qty: 1, color_name: '', description: ''});
    }
  }

  return JSON.stringify(rows);
})();
"""


# --- 从零件详情页提取重量 ---
JS_EXTRACT_WEIGHT = r"""
(() => {
  // 优先：精确 id 选择器（已验证的结构）
  var el = document.getElementById('item-weight-info');
  if (el) {
    var m = el.textContent.match(/([\d.]+)\s*g/i);
    if (m) return m[1];
  }
  // 回退：搜索全文 "Weight: X.Xg"
  var html = document.body.innerHTML;
  var idx = html.search(/Weight[：:]\s*([\d.]+)\s*g/i);
  if (idx >= 0) {
    var seg = html.substring(idx, idx + 50);
    var m2 = seg.match(/([\d.]+)\s*g/i);
    if (m2) return m2[1];
  }
  return '';
})();
"""


# --- 从价格指南页提取 Qty Avg Price ---
JS_EXTRACT_PRICE = r"""
(() => {
  var h = document.body.innerHTML;
  // 找 "Qty Avg Price:" 所在行，取 <b> 标签里的币种+数值
  // 结构：<td>Qty Avg Price:</td><td><b>CNY&nbsp;0.71</b></td>
  var re = /Qty Avg Price:<\/td>\s*<td[^>]*><b>([A-Z]{2,3})?(?:\s|&nbsp;|\u00a0)*([\d,]+\.\d+)<\/b>/gi;
  var matches = [];
  var m;
  while ((m = re.exec(h)) !== null) {
    matches.push({
      currency: (m[1] || '').toUpperCase(),
      value: parseFloat(m[2].replace(/,/g, ''))
    });
  }
  // matches[0] = Last 6 Months / New; matches[1] = Last6/Used; matches[2] = Current/New; matches[3] = Current/Used
  // 我们取 matches[2]（Current New），如果不够长就取 matches[0]（Last 6 Months New）
  var target = null;
  if (matches.length > 2) target = matches[2];
  else if (matches.length > 0) target = matches[0];
  if (!target) return JSON.stringify({currency: '', qty_avg: null});
  return JSON.stringify({currency: target.currency, qty_avg: target.value});
})();
"""


# ============================================================
# 核心：WebView 驱动的浏览器抓取
# ============================================================

class BLBrowser:
    """包装一个 ui.WebView，提供"加载-等待-提取"的同步式接口。"""

    def __init__(self, progress_cb=None):
        self.view = ui.WebView()
        self.view.loading = False
        self.progress_cb = progress_cb or (lambda msg: None)
        # 在一个隐藏的容器里创建 WebView（Pythonista 的 WebView 必须在窗口层级才能跑 WKWebView）
        self.container = ui.View()
        self.container.add_subview(self.view)
        w, h = ui.get_screen_size()
        self.container.frame = (0, 0, w, h)
        self.view.frame = self.container.bounds
        self.view.flex = 'WH'

    def show(self):
        """显示浏览器窗口（必须显示才能触发 WKWebView 真实加载）。"""
        self.container.present('fullscreen', hide_title_bar=False)

    def _wait_load(self, timeout=30, anchor_js=None, anchor_timeout=15):
        """
        等待 WebView 完成加载 + WAF 挑战。

        AWS WAF 挑战页本身 HTML 极简（<2KB），document.readyState 秒变 'complete'，
        但此时真正的 BrickLink 页面还没渲染——必须等 anchor_js 成立才可信。

        anchor_js: 反复执行直到返回真值的 JS（必填！尤其 catalogItemInv 页）。
        """
        t0 = time.time()
        # 1) 等 readyState complete（只是第一道门，挑战页也算 complete）
        while time.time() - t0 < timeout:
            try:
                ready = self.view.evaluate_javascript('document.readyState')
                if ready == 'complete':
                    break
            except Exception:
                pass
            time.sleep(0.3)

        # 2) 轮询 anchor（真正的内容锚点）
        #    注意：即使没传 anchor_js 也要额外睡一下给 WAF 留时间
        t1 = time.time()
        anchor_ok = False
        if anchor_js:
            # 每秒检查一次
            while time.time() - t1 < anchor_timeout:
                try:
                    r = self.view.evaluate_javascript(anchor_js)
                    if r:
                        anchor_ok = True
                        break
                except Exception:
                    pass
                remaining = int(anchor_timeout - (time.time() - t1))
                if remaining > 0 and remaining % 5 == 0:
                    self.progress_cb(f'  ⏳ 等待页面加载 {remaining}s ...')
                time.sleep(1.0)
        else:
            # 无 anchor 的保守等待：挑战 + 渲染至少要 5s
            time.sleep(5.0)

        # 3) 最后留一点缓冲让 DOM 稳定
        time.sleep(1.0)
        return anchor_ok or True

    def goto(self, url, anchor_js=None, timeout=30):
        self.progress_cb('→ 加载 ' + url[:80])
        self.view.load_url(url)
        return self._wait_load(timeout=timeout, anchor_js=anchor_js)

    def eval_js(self, js):
        try:
            return self.view.evaluate_javascript(js)
        except Exception as e:
            self.progress_cb('  JS 执行错误: ' + str(e)[:80])
            return None


# ============================================================
# 主流程
# ============================================================

def set_progress(text):
    print(text, flush=True)


def extract_set_no_from_user_input(user_input):
    """用户可能输入 75290 或 75290-1。保留用户原样输入，fallback 逻辑在 run() 里处理。"""
    return (user_input or '').strip()


def _dump_diagnostics(browser, label='诊断'):
    """把当前 WebView 的状态打印出来，方便判断卡在哪一步。"""
    print(f'\n  ── {label} ──')
    try:
        title = browser.eval_js('document.title') or '(空)'
        cur_url = browser.eval_js('location.href') or '(空)'
        ready = browser.eval_js('document.readyState') or '(空)'
        table_cnt = browser.eval_js('document.querySelectorAll("table").length') or 0
        tr_cnt = browser.eval_js('document.querySelectorAll("table tr").length') or 0
        a_cnt = browser.eval_js('document.querySelectorAll("a").length') or 0
        item_cnt = browser.eval_js(
            'document.querySelectorAll('
            'a[href*="catalogitem.page?P="], a[href*="catalogItemPic.asp?P="]'
            ').length'
        ) or 0
        has_waf = browser.eval_js(
            'document.body.innerHTML.indexOf("AwsWafIntegration") >= 0 || '
            'document.body.innerHTML.indexOf("awsWafCookie") >= 0'
        )
        html_head = browser.eval_js(
            'document.body.innerHTML.substring(0, 1000)'
        ) or '(空 body)'

        print(f'  标题       : {title}')
        print(f'  当前 URL   : {cur_url[:100]}')
        print(f'  readyState : {ready}')
        print(f'  table 数   : {table_cnt}')
        print(f'  tr 数      : {tr_cnt}')
        print(f'  总 <a> 数  : {a_cnt}')
        print(f'  Item No 链接数: {item_cnt}')
        print(f'  含 WAF 挑战: {"是 ⚠️" if has_waf else "否 ✅"}')
        print(f'  body 前 500字符:')
        print(f'  {html_head[:500]}')
        print(f'  ────────────\n')
    except Exception as e:
        print(f'  (诊断失败: {e})')


def _try_load_inventory(browser, set_no, anchor_timeout=45):
    """尝试加载指定套装的 inventory，返回 (inventory_list, used_set_no)。
    没抓到任何零件时返回 ([], set_no)。"""
    inv_url = INV_URL.format(set_no=set_no)
    print(f'  尝试套装号: {set_no}')
    ok = browser.goto(inv_url, anchor_js=JS_INV_ANCHOR, timeout=30,
                      anchor_timeout=anchor_timeout)

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
    user_input = extract_set_no_from_user_input(user_input)
    if not user_input:
        print('未输入套装号，退出')
        return

    print('=' * 50)
    print('套装:', user_input)
    print('=' * 50)

    browser = BLBrowser(progress_cb=set_progress)
    browser.show()
    time.sleep(1.5)  # 等窗口 + WKWebView 初始化

    # --- 2. 抓 inventory（带套装号 fallback + 诊断） ---
    print('\n[1/3] 加载零件清单 ...')
    g_inventory, used_no = _try_load_inventory(browser, user_input)

    # Fallback：如果用户没输后缀且第一次没抓到，自动补 -1 再试
    if not g_inventory and '-' not in user_input:
        print(f'  ⚠️  没抓到零件，自动补 "-1" 后缀再试一次 ...')
        time.sleep(1.0)
        g_inventory, used_no = _try_load_inventory(browser, user_input + '-1')
    # 如果用户本来就带后缀但没抓到，再试不带后缀的（覆盖罕见反转情况）
    elif not g_inventory and '-' in user_input:
        alt = user_input.split('-')[0]
        if alt != user_input:
            print(f'  ⚠️  没抓到零件，试不带后缀 "{alt}" ...')
            time.sleep(1.0)
            g_inventory, used_no = _try_load_inventory(browser, alt)

    g_set_no = used_no

    if not g_inventory:
        print('❌ 所有尝试都没抓到零件')
        _dump_diagnostics(browser)
        time.sleep(3)
        browser.container.close()
        return

    print(f'  ✓ 提取到 {len(g_inventory)} 个不重复零件 (用套装号: {g_set_no})')
    # 预览前 3 个
    for it in g_inventory[:3]:
        print('    {part} | color={color_id} | qty={qty}'.format(**it))

    # --- 3. 抓每个零件的重量 + 价格 ---
    print(f'\n[2/3] 抓取重量与价格（共 {len(g_inventory)} 个零件）...')
    print('  (每个零件 ~3 个页面加载，整体会比较慢，请耐心等待)')

    for i, item in enumerate(g_inventory, 1):
        part = item['part']
        color_id = item.get('color_id', '-1')
        qty = item.get('qty', 1)

        # 3a. 重量（可缓存）
        weight = None
        if part in g_weight_cache:
            weight = g_weight_cache[part]
        else:
            part_url = PART_URL.format(part=part)
            browser.goto(part_url, anchor_js='document.getElementById("item-weight-info") !== null', timeout=25)
            w_raw = browser.eval_js(JS_EXTRACT_WEIGHT)
            if w_raw and isinstance(w_raw, str) and w_raw.replace('.', '').isdigit():
                weight = float(w_raw)
            g_weight_cache[part] = weight

        # 3b. 价格
        price_currency = ''
        price_qty_avg = None
        # colorID 为 -1 时表示"全部颜色"，用 -1 也能查到均价
        pg_url = PG_URL.format(part=part, color_id=color_id)
        browser.goto(pg_url, anchor_js='document.body.innerHTML.indexOf("Qty Avg Price") >= 0', timeout=25)
        p_raw = browser.eval_js(JS_EXTRACT_PRICE)
        if p_raw and isinstance(p_raw, str):
            try:
                p_obj = json.loads(p_raw)
                price_currency = p_obj.get('currency', '')
                price_qty_avg = p_obj.get('qty_avg')
            except json.JSONDecodeError:
                pass

        # 汇总到行
        total_weight = round((weight or 0) * qty, 4) if weight else ''
        unit_value = round(price_qty_avg, 4) if price_qty_avg is not None else ''
        total_value = round(unit_value * qty, 4) if (unit_value != '' and price_qty_avg is not None) else ''

        row = {
            'set_no': g_set_no,
            'part_no': part,
            'description': item.get('description', ''),
            'color_id': color_id,
            'qty': qty,
            'weight_g': weight if weight is not None else '',
            'total_weight_g': total_weight,
            'price_currency': price_currency,
            'unit_qty_avg_price': unit_value,
            'total_value': total_value,
        }
        g_results.append(row)

        print(f'  [{i}/{len(g_inventory)}] {part} x{qty} | {weight}g | {price_currency} {unit_value}')

        # 轻微节流，避免被限频（WebView 方式 WAF session 已稳定，不需要太长）
        time.sleep(0.3)

    # --- 4. 写 CSV ---
    print('\n[3/3] 生成 CSV ...')
    out_dir = os.path.expanduser('~/Documents')
    os.makedirs(out_dir, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    csv_path = os.path.join(out_dir, f'BL_{g_set_no}_{ts}.csv')

    fieldnames = [
        'set_no', 'part_no', 'description', 'color_id', 'qty',
        'weight_g', 'total_weight_g',
        'price_currency', 'unit_qty_avg_price', 'total_value'
    ]

    with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(g_results)

    # 汇总统计
    total_parts = len(g_results)
    total_qty = sum(r['qty'] for r in g_results)
    total_w = sum(r['total_weight_g'] for r in g_results if isinstance(r['total_weight_g'], (int, float)))
    total_v = sum(r['total_value'] for r in g_results if isinstance(r['total_value'], (int, float)))
    cur = ''
    for r in g_results:
        if r['price_currency']:
            cur = r['price_currency']
            break

    print('\n' + '=' * 50)
    print(f'✅ 完成！CSV: {csv_path}')
    print(f'  去重零件数: {total_parts}')
    print(f'  零件总数 : {total_qty}')
    print(f'  总重量   : {total_w} g')
    if cur and total_v:
        print(f'  总估算价 : {cur} {total_v:.4f}')
    print('=' * 50)

    # 在 UI 上也弹个提示
    time.sleep(1)
    browser.container.close()


def main():
    try:
        run()
    except KeyboardInterrupt:
        print('\n用户中断')
        sys.exit(130)
    except Exception as e:
        import traceback
        print('❌ 运行出错:', e)
        traceback.print_exc()
        # 把错误也存下来方便排查
        try:
            out_dir = os.path.expanduser('~/Documents')
            with open(os.path.join(out_dir, 'bl_error.log'), 'w') as f:
                traceback.print_exc(file=f)
        except Exception:
            pass


if __name__ == '__main__':
    main()
