/*
 * extract-price-on-safari.js
 * ---------------------------------------------------------------------------
 * 「独立 B」原型核心：在 Safari 当前价格页上运行的 JavaScript 提取器。
 *
 * 适用场景：
 *   iPhone 主屏幕 / Safari 里，用快捷指令(Shortcuts)的「运行 JavaScript」动作
 *   调用本脚本，从当前已打开(且已通过 WAF 挑战)的 BrickLink 价格页
 *   提取 min/avg/qty_avg/max，返回与 BLP.py / BL-price.json 兼容的 JSON 结构。
 *
 * 为什么可行：
 *   - 它在 Safari 自身环境执行，WAF 挑战已由浏览器自动通过（与手动浏览一致）；
 *   - 不依赖 Playwright / Python，iPhone 也能跑；
 *   - 输入/输出都是文本，方便快捷指令继续加工或写回文件。
 *
 * 用法：
 *   1) iOS「快捷指令」里：
 *      - 「获取 URL 内容」或手动在 Safari 打开价格页（例如
 *        https://www.bricklink.com/catalogPG.asp?P=3001&colorID=86）
 *      - 「运行 JavaScript on Safari Web Page」→ 粘贴本文件内容
 *      - 输出的 completion(result) 是一个对象，再转成 JSON 文本保存。
 *   2) 桌面浏览器验证（Mac/PC）：
 *      在新标签页打开一个价格页，F12 打开 Console，粘贴本脚本末尾调用
 *      runExtract(); 查看返回对象。
 * ---------------------------------------------------------------------------
 */

function extractPriceGuide(page) {
  var idx = page.indexOf('Last 6 Months Sales');
  if (idx < 0) return null;

  // 截取价格区（与 BLP.py 取 20000 字符一致，多加缓冲）
  var section = page.substring(idx, idx + 20000);

  // 真实结构示例：
  //   <tr align="RIGHT"><td>Avg Price:</td><td><b>CNY&nbsp;0.89</b></td></tr>
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

var runExtract = function () {
  var html = document.documentElement.outerHTML;
  var result = extractPriceGuide(html);
  if (!result) {
    return JSON.stringify({ extract_error: '未找到 Last 6 Months Sales 价格段' });
  }
  // 把当前部件的 part_num / color 一并带出，方便快捷指令匹配
  var url = location.href;
  var mPart = url.match(/[?&]P=([^&]+)/);
  var mColor = url.match(/[?&]colorID=([^&]+)/);
  var out = {
    url: url,
    part_num: mPart ? decodeURIComponent(mPart[1]) : null,
    color_id: mColor ? mColor[1] : null
  };
  if (result.last_6_months)      out.last_6_months      = result.last_6_months;
  if (result.current_for_sale)   out.current_for_sale   = result.current_for_sale;
  return JSON.stringify(out);
};

// 快捷指令「运行 JavaScript」会调用 completion()；若在真浏览器 Console 里验证用 runExtract()
if (typeof completion === 'function') {
  completion(runExtract());
}