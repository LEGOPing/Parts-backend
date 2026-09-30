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
# 必须是 /v2/catalog/catalogitem.page 且带 ?P= 或 ?M= 的链接
# v2 SPA 渲染比 v1 HTML 晚，严格等 v2 真正出现才算真内容
INV_ANCHOR_JS = (
    "document.querySelectorAll("
    "'a[href*=\"/v2/catalog/catalogitem.page?P=\"], a[href*=\"/v2/catalog/catalogitem.page?M=\"]'"
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

JS_EXTRACT_INVENTORY = r"""(() => {
  var rows = [];
  var seen = new Set();

  // 同时支持 v2（主）和 v1（fallback）
  var links = document.querySelectorAll('a[href*="catalogitem.page"], a[href*="catalogItemPic.asp"]');

  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var href = a.getAttribute('href') || '';

    // 必须包含 ?P= 或 ?M=
    var isPart = (href.indexOf('?P=') >= 0 || href.indexOf('&P=') >= 0);
    var isMinifig = (href.indexOf('?M=') >= 0 || href.indexOf('&M=') >= 0);
    if (!isPart && !isMinifig) continue;

    // 零件号 / 人仔号
    var m_p = href.match(/[?&]P=([A-Za-z0-9]+)/);
    var m_m = href.match(/[?&]M=([A-Za-z0-9]+)/);
    var partText = m_p ? m_p[1] : (m_m ? m_m[1] : '');
    if (!partText) continue;

    // 颜色 ID — 优先 idColor=（v2），fallback colorID=（v1）
    var colorId = '-1';
    var m_c1 = href.match(/[?&]idColor=(-?\d+)/);
    var m_c2 = href.match(/[?&]colorID=(-?\d+)/);
    if (m_c1) colorId = m_c1[1];
    else if (m_c2) colorId = m_c2[1];

    // 找最近祖先 <tr>
    var tr = a;
    while (tr && tr.tagName && tr.tagName !== 'TR') tr = tr.parentElement;
    if (!tr) continue;

    var trText = (tr.textContent || '').replace(/\s+/g, ' ').trim();

    // ── Qty：双重策略 ──
    var qty = 1;
    var partLabel = (a.textContent || '').trim() || partText;
    var partIdx = trText.indexOf(partLabel);
    if (partIdx <= 0) partIdx = trText.indexOf(partText);

    // 策略 A：Yes/No 和 PartNo 之间的数字
    var yesIdx = trText.search(/\b(Yes|No)\b/);
    if (yesIdx >= 0 && partIdx > yesIdx) {
      var between = trText.substring(yesIdx, partIdx);
      var bm = between.match(/\b(\d{1,3})\b/g);
      if (bm && bm.length > 0) {
        var candA = parseInt(bm[0], 10);
        if (candA > 0 && candA < 1000) qty = candA;
      }
    }

    // 策略 B：零件号之前最近的 1-3 位小数字
    if (qty === 1 && partIdx > 0) {
      var before = trText.substring(0, partIdx);
      var allNums = before.match(/\b(\d{1,3})\b/g);
      if (allNums && allNums.length > 0) {
        var last = parseInt(allNums[allNums.length - 1], 10);
        if (last > 0 && last <= 999) qty = last;
      }
    }

    // 去重
    var key = partText + '|' + colorId;
    if (seen.has(key)) continue;
    seen.add(key);

    // 描述：零件号链接所在 td 后面的兄弟 td
    var desc = '';
    var parentTd = a.parentElement;
    while (parentTd && parentTd.tagName !== 'TD') parentTd = parentTd.parentElement;
    if (parentTd) {
      var nextTd = parentTd.nextElementSibling;
      while (nextTd) {
        var t = (nextTd.textContent || '').trim();
        if (t && t !== partText && t !== partLabel && t !== 'Yes' && t !== 'No'
            && t.length > 2 && !/^\d+$/.test(t)) {
          desc = t.substring(0, 120);
          break;
        }
        nextTd = nextTd.nextElementSibling;
      }
    }

    rows.push({
      part: partText,
      color_id: colorId,
      qty: qty,
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

# ---- BL 颜色表 ----
BL_COLORS = {}         # id → {"name": ..., "type": ...}
BL_COLOR_BY_NAME = {}  # lowercase name → id

def _load_bl_colors():
    """加载套装零件清单文件夹里的 bl-color.json（或 Gitee 上的 bl_colors.json）。"""
    global BL_COLORS, BL_COLOR_BY_NAME
    candidates = [
        os.path.join(os.path.expanduser('~/Documents'), '套装零件清单', 'bl-colors.json'),
        os.path.join(os.path.expanduser('~/Documents'), '套装零件清单', 'bl_colors.json'),
        os.path.join(os.path.expanduser('~/Documents'), '套装零件清单', 'bl-color.json'),
        os.path.join(os.path.expanduser('~/Documents'), 'bl-colors.json'),
    ]
    data = None
    for p in candidates:
        if os.path.isfile(p):
            try:
                data = json.load(open(p, encoding='utf-8'))
                print(f'  🎨 加载本地颜色表: {p}')
                break
            except Exception as e:
                print(f'  ⚠️  本地颜色表加载失败 {p}: {e}')
    if data is None:
        # 回退：从 Gitee 拉
        try:
            url = 'https://gitee.com/legoping/parts-rb/raw/main/bl_colors.json'
            req = urllib.request.Request(url, headers={'User-Agent': 'curl/8'})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            print(f'  🎨 从 Gitee 拉到颜色表 ({len(data)} 条)')
        except Exception as e:
            print(f'  ⚠️  Gitee 颜色表拉取失败: {e}')
            data = []
    for rec in data:
        cid = rec.get('id')
        cname = rec.get('name', '')
        if cid is None: continue
        BL_COLORS[str(cid)] = rec
        key = (cname or '').strip().lower()
        if key:
            BL_COLOR_BY_NAME[key] = str(cid)
    print(f'  ✅ 颜色表 {len(BL_COLORS)} 条可查')


def _resolve_color_from_name(color_name):
    """从颜色名（英文）查 BL 颜色 ID。返回 str 或 None。"""
    if not color_name:
        return None
    key = color_name.strip().lower()
    # 精确匹配
    if key in BL_COLOR_BY_NAME:
        return BL_COLOR_BY_NAME[key]
    # 模糊匹配（包含）
    for k, v in BL_COLOR_BY_NAME.items():
        if key in k or k in key:
            return v
    return None


def _resolve_color_id(part_color_id, part_description):
    """
    优先用 inventory 页面 URL 里的 idColor。
    如果是 -1 或空 → 从描述里解析颜色名 → bl_colors.json 匹配。
    """
    if part_color_id not in ('', '-1', '-'):
        return str(part_color_id)
    # 从描述里找颜色词
    desc = (part_description or '').strip()
    # 描述通常以颜色名开头："Dark Bluish Gray Brick 1 x 2" / "Blue Plate 2 x 4"
    # 尝试匹配 bl_colors 里已知颜色名
    for cname, cid in BL_COLOR_BY_NAME.items():
        # 用  边界避免 "Red" 匹配 "Redstone" 之类
        if re.search(r'' + re.escape(cname) + r'', desc, re.IGNORECASE):
            return cid
    return '-1'



# ============================================================
# BLBrowser —— 基于 wkwebview.WKWebView 的浏览器驱动
# ============================================================

"""BLBrowser —— 重写版

核心修复：
1. main() 用 @ui.in_background → 脚本跑后台线程，主线程留给 objc 回调
2. 自己建 objc WKNavigationDelegate（create_objc_class），直接覆盖 wkwebview 的转发链
3. 自己实现带 timeout 的 eval_js（queue.get(timeout=12)）
4. eval_js_async 用 @on_main_thread 包装（objc evaluateJavaScript 需要主线程）
"""
import ui
import threading
import queue
import functools
from objc_util import (ObjCClass, ObjCInstance, create_objc_class, retain_global,
                       ObjCBlock, c_void_p, c_long, c_bool, ctypes, on_main_thread)

# wkwebview.py 里的 block descriptor（复用）
class _block_decision_handler(ctypes.Structure):
    _fields_ = [
        ('reserved', ctypes.c_ulong),
        ('size', ctypes.c_ulong),
        ('copy_helper', c_void_p),
        ('dispose_helper', c_void_p),
        ('signature', ctypes.c_char_p)
    ]


def _make_ns_url(url_str):
    """str → NSURL (ObjCInstance)"""
    NSURL = ObjCClass('NSURL')
    return NSURL.URLWithString_(url_str)


class _BlockLiteral(ctypes.Structure):
    """ObjCBlock 的 _fields_ 模板（wkwebview.py 里已经有，这里重复免得依赖）"""
    _fields_ = [
        ('isa', c_void_p),
        ('flags', ctypes.c_int),
        ('reserved', ctypes.c_int),
        ('invoke', ctypes.CFUNCTYPE(c_void_p, c_void_p, c_void_p)),
        ('descriptor', _block_decision_handler)
    ]


def _make_block_literal(*arg_types):
    return [
        ('isa', c_void_p),
        ('flags', ctypes.c_int),
        ('reserved', ctypes.c_int),
        ('invoke', ctypes.CFUNCTYPE(c_void_p, c_void_p, *arg_types)),
        ('descriptor', _block_decision_handler)
    ]


class BLBrowser:
    """重写的 BrickLink 浏览器驱动。

    关键设计：
    - __init__ 在**主线程**调用（因为 objc 初始化要主线程）
    - load_url / eval_js 在**主线程**调用（objc 方法要求）
    - goto / run 在**后台线程**（@ui.in_background），用 queue.get(timeout) 等回调
    """

    def __init__(self, progress_cb=None):
        self.progress_cb = progress_cb or (lambda msg: None)
        self._sig_load_finished = threading.Event()
        self._sig_load_error = threading.Event()
        self._last_error = None
        self._nav_finished_count = 0
        self._nav_started_count = 0

        # 建容器 View
        w, h = ui.get_screen_size()
        self.container = ui.View()
        self.container.frame = (0, 0, w, h)

        # 创建 wkwebview.WKWebView（走主线程）
        self.wv = WKWebView(frame=self.container.bounds, flex='WH')
        self.container.add_subview(self.wv)

        # 注入反自动化脚本
        self.wv.add_script(ANTI_WEBDRIVER_JS, add_to_end=False)

        # 设置 Safari UA
        self.wv.user_agent = SAFARI_UA

        # ---- 关键：用 wkwebview.WKWebView 自带的 CustomNavigationDelegate ----
        # wkwebview 已经在 objc 层桥好了：objc 回调 → 调 webview.delegate 的 Python 方法
        # 我们只需要把自己挂到 self.wv.delegate 上，实现三个 Python 回调方法
        self.wv.delegate = self

        # eval_js queue（自己管，不用 wkwebview 的）
        self._eval_queue = queue.Queue()

    @on_main_thread
    def _load_url_on_main(self, url):
        """在主线程触发加载。"""
        NSURLRequest = ObjCClass('NSURLRequest')
        nsurl = _make_ns_url(url)
        request = NSURLRequest.requestWithURL_cachePolicy_timeoutInterval_(
            nsurl, 0, 30)  # cachePolicy=0(useProtocolCachePolicy), timeout=30s
        self.wv.webview.loadRequest_(request)

    @on_main_thread
    def _reload_on_main(self):
        self.wv.webview.reload()

    def _log_async(self, msg):
        """从后台线程安全打日志（用 Python 的 print，flush）。"""
        self.progress_cb(msg)

    # ── wkwebview 原生 Python delegate 回调 ──
    # wkwebview 的 CustomNavigationDelegate 会从 objc 层调到这里
    def webview_did_start_load(self, webview):
        self._nav_started_count += 1
        self._log_async(f'  🚀 开始加载 #{self._nav_started_count}')

    def webview_did_finish_load(self, webview):
        self._nav_finished_count += 1
        self._sig_load_finished.set()
        self._log_async(f'  📄 完成加载 #{self._nav_finished_count}')

    def webview_did_fail_load(self, webview, error_code, error_msg):
        self._last_error = f'WKWebView error {error_code}: {error_msg}'
        self._sig_load_error.set()
        self._log_async(f'  ❌ 导航失败: {self._last_error}')

    def show(self):
        self.container.present('fullscreen', hide_title_bar=False)
        # 等一下窗口和 WKWebView 初始化
        time.sleep(2.0)

    def eval_js(self, js, timeout=12):
        """
        同步 eval JS（主线程安全）。

        关键修复：
        - eval_js_async 用 @on_main_thread（objc evaluateJavaScript 要主线程）
        - queue.get(timeout=12) 超时保护（不无限阻塞）
        - completion handler 被 @on_main_thread 包装后，能在主线程被调用
        - 我们的脚本在后台线程跑（@ui.in_background），所以 queue.get() 不阻塞主线程
        """
        q = queue.Queue()

        @on_main_thread
        def _do_eval():
            # 必须在主线程调 objc evaluateJavaScript
            def _completion_handler(_obj, _err):
                # completion handler 可能在主线程也可能在别的线程
                # 保险起见包装一下
                try:
                    if _obj is not None:
                        val = str(ObjCInstance(_obj))
                    elif _err is not None:
                        val = None  # JS 执行出错或返回空
                    else:
                        val = None
                except Exception:
                    val = None
                try:
                    q.put(val)
                except Exception:
                    pass

            block = ObjCBlock(
                _completion_handler,
                restype=None,
                argtypes=[c_void_p, c_void_p, c_void_p]
            )
            retain_global(block)
            self.wv.webview.evaluateJavaScript_completionHandler_(js, block)

        _do_eval()

        try:
            val = q.get(timeout=timeout)
            return val
        except queue.Empty:
            self.progress_cb(f'  ⏱️  eval_js 超时 ({timeout}s) JS={js[:60]}...')
            return None

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

        在后台线程运行（由 @ui.in_background 的 run() 调用）。
        主线程专门留给 objc delegate 回调和 evaluateJavaScript。
        """
        self.progress_cb('→ 加载 ' + url[:90])

        self._sig_load_finished.clear()
        self._sig_load_error.clear()
        self._last_error = None
        self._nav_finished_count = 0
        self._nav_started_count = 0

        self._load_url_on_main(url)

        t0 = time.time()
        deadline = t0 + anchor_timeout
        last_log = 0
        nav_seen = 0
        still_blocked = False

        while time.time() < deadline:
            # 1) 等下一个 didFinish（每次导航都触发，包括 WAF 自动 reload）
            self._sig_load_finished.clear()
            remaining = deadline - time.time()
            wait_time = min(5, max(1, remaining))
            self._sig_load_finished.wait(timeout=wait_time)

            # 2) 失败检查
            if self._sig_load_error.is_set():
                self.progress_cb(f'  ❌ WKWebView load 失败: {self._last_error}')
                return False

            # 3) 新导航完成
            if self._nav_finished_count > nav_seen:
                nav_seen = self._nav_finished_count
                cur_url = self.eval_js('location.href') or ''
                self.progress_cb(f'  📄 第 {nav_seen} 次完成（{cur_url[:80]}）')

            # 4) 拦截标记（AWS WAF 在第 1 次 didFinish 后通常还在）
            blocked = self._detect_blocked()
            if blocked:
                if not still_blocked:
                    self.progress_cb(f'  🛡️  检测到拦截: {blocked}（等 JS 自动 reload）')
                still_blocked = True
                # 卡 3+ 次导航还在挑战页 → 手动 reload 一次救场
                if nav_seen >= 3:
                    self.progress_cb('  🔄 已卡 3+ 次导航，手动 reload 一次...')
                    self._reload_on_main()
                    time.sleep(1.0)
                time.sleep(1.0)
                continue  # 关键：别 return False，继续等下一次导航
            else:
                if still_blocked:
                    self.progress_cb('  ✅ 拦截标记消失（WAF 通过）')
                still_blocked = False

            # 5) anchor JS
            if anchor_js:
                try:
                    r = self.eval_js(anchor_js)
                    if r:
                        self.progress_cb('  ✅ anchor 命中，真内容到了')
                        return True
                except Exception:
                    pass

            # 6) 进度
            elapsed = int(time.time() - t0)
            if elapsed - last_log >= 10:
                last_log = elapsed
                extra = f' 拦截={"是" if still_blocked else "否"}'
                self.progress_cb(f'  ⏳ {elapsed}s / {nav_seen} 次导航{extra}')

            time.sleep(0.5)

        self.progress_cb(f'  ⏰ 超时 ({anchor_timeout}s)，拦截={still_blocked}, 导航={nav_seen}')
        return False

    def dump_diagnostics(self):
        print('\n  ── 诊断 ──')
        try:
            title = self.eval_js(JS_TITLE) or '(空)'
            cur_url = self.eval_js('location.href') or '(空)'
            html_len = self.eval_js(JS_HTML_LEN) or 0
            ready = self.eval_js('document.readyState') or '(空)'
            blocked = self.eval_js(JS_HAS_BLOCKED) or '(无拦截)'
            html_head = self.eval_js(JS_HTML_SNIPPET) or '(空 body)'
            print(f'  标题          : {title}')
            print(f'  当前 URL      : {cur_url[:120]}')
            print(f'  readyState    : {ready}')
            print(f'  HTML 长度     : {html_len}')
            print(f'  导航次数      : {self._nav_finished_count} 完成 / {self._nav_started_count} 开始')
            print(f'  拦截标记      : {blocked}')
            print(f'  body 前 500字符:')
            print(f'  {html_head[:500]}')
            print(f'  ────────────\n')
        except Exception as e:
            print(f'  (诊断失败: {e})')

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


@ui.in_background
def run(user_input):
    global g_set_no, g_inventory, g_results, g_browser

    if g_browser is None:
        print('❌ g_browser 未初始化')
        return

    print('=' * 50)
    print('套装:', user_input)
    print('=' * 50)

    # 等主线程 UI 初始化稳定一下
    time.sleep(2.0)

    # --- 1. 抓 inventory（带 fallback） ---
    _load_bl_colors()
    print('\n[1/3] 加载零件清单 ...')
    g_inventory, used_no = _try_load_inventory(g_browser, user_input)

    # Fallback 1：没后缀 → 补 -1
    if not g_inventory and '-' not in user_input:
        print(f'  ⚠️  没抓到零件，自动补 "-1" 后缀再试一次 ...')
        time.sleep(1.0)
        g_inventory, used_no = _try_load_inventory(g_browser, user_input + '-1')

    # Fallback 2：有后缀 → 试不带后缀
    elif not g_inventory and '-' in user_input:
        alt = user_input.split('-')[0]
        if alt != user_input:
            print(f'  ⚠️  没抓到零件，试不带后缀 "{alt}" ...')
            time.sleep(1.0)
            g_inventory, used_no = _try_load_inventory(g_browser, alt)

    g_set_no = used_no

    if not g_inventory:
        print('❌ 所有尝试都没抓到零件')
        g_browser.dump_diagnostics()
        time.sleep(3)
        try:
            g_browser.container.close()
        except Exception:
            pass
        return

    # 颜色 ID fallback：如果 URL 里拿不到 idColor → 从描述解析
    fixed = 0
    for item in g_inventory:
        orig = item.get('color_id', '-1')
        desc = item.get('description', '')
        resolved = _resolve_color_id(orig, desc)
        if resolved != orig:
            item['color_id'] = resolved
            fixed += 1
    if fixed:
        print(f'  🎨  从描述补到 {fixed} 个零件的颜色 ID')
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
            ok_w = g_browser.goto(part_url, anchor_js=PART_WEIGHT_ANCHOR_JS,
                                anchor_timeout=25)
            if ok_w:
                weight_str = g_browser.eval_js(JS_EXTRACT_WEIGHT) or ''
            if weight_str:
                g_weight_cache[part] = weight_str

        try:
            weight_g = float(weight_str) if weight_str else 0.0
        except ValueError:
            weight_g = 0.0
        total_weight = round(weight_g * qty, 3)

        # --- 3b. 价格 ---
        pg_url = PG_URL.format(part=part, color_id=color_id)
        ok_p = g_browser.goto(pg_url, anchor_js=PRICE_ANCHOR_JS,
                            anchor_timeout=25)
        currency = ''
        qty_avg_price = None
        price_data = {}
        if ok_p:
            raw_p = g_browser.eval_js(JS_EXTRACT_PRICE)
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
    # CSV 固定输出到 ~/Documents/套装零件清单/
    out_dir = os.path.join(os.path.expanduser('~/Documents'), '套装零件清单')
    os.makedirs(out_dir, exist_ok=True)
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
            g_browser.container.close()
        except Exception:
            pass


@on_main_thread
def _main_thread_init(user_input):
    """主线程：创建浏览器 + 显示窗口。"""
    global g_browser
    g_browser = BLBrowser(progress_cb=set_progress)
    g_browser.show()


def main():
    global g_browser

    # 用户输入（主线程）
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

    # 主线程建 UI
    _main_thread_init(user_input)

    # 后台线程跑抓取
    run(user_input)


if __name__ == '__main__':
    g_browser = None
    main()
