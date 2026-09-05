// ============================================================================
// bl-proxy-worker：Bricklink 价格代理 Worker
//
// 架构（对应需求）：
//   Cloudflare Worker (bl-proxy.你的域.workers.dev)
//     ├─ 查 KV：bl:<P>:<colorID>:N  → 命中且 <30min → 返缓存
//     ├─ miss → Cookie 预热 + 抓 BL catalogPG.asp → 解析 → 写回 KV → 返回
//
// 对外接口：
//   GET /api/price?P=3001&colorID=5
//   返回 JSON：
//     { ok:true,
//       last_6_months:{currency,new:{min,avg,qty_avg,max},used:{...}},
//       current_for_sale:{...同结构},
//       cached:true|false,  generated_at:ISO }
//
// 绑定(在 wrangler.toml 中声明)：
//   [[kv_namespaces]] binding = "BL_CACHE"  id = "<你的KV命名空间ID>"
//
// 重要说明：普通 Worker 的 fetch() 无法执行 AWS WAF 的 JS 挑战脚本，
// 从数据中心 IP 直接抓 catalogPG.asp 大概率拿到 HTTP 202 挑战页而非价格。
// 本脚本含"Cookie 预热"用于持有已结算的 aws-waf-token，若仍 202 则返回
// 明确错误码，提示改用 Cloudflare Browser Rendering（渲染 API）。
// ============================================================================

// 缓存有效期（毫秒）：30 分钟
const CACHE_TTL_MS = 30 * 60 * 1000;
// 抓 BL 页面的超时
const FETCH_TIMEOUT_MS = 30000;

// 加解密不下发到前端的敏感出入环境变量
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

// 规范化零件号：只保留字母数字
function cleanPartNum(p) {
  return String(p == null ? '' : p).replace(/[^a-zA-Z0-9]/g, '');
}

// ----------------------------------------------------------------------------
// 从价格指南 HTML 中解析两组价格（移植自 app/bricklink_price.py 的正则逻辑）
//
// Bricklink 价格指南是一个"指标为行、条件为列"的网格，列顺序恒为：
//   [Last6-New, Last6-Used, Current-New, Current-Used]
// 单元格形如：<td>Min Price:</td><td><b>CNY&nbsp;0.07</b></td>
// ----------------------------------------------------------------------------
function extractPriceGuide(html) {
  // 注意：Qty Avg Price 必须先于 Avg Price，避免贪婪误匹配
  const re = /<td>(Min Price|Qty Avg Price|Avg Price|Max Price):<\/td>\s*<td><b>([A-Z]{2,3})?(?:\s|&nbsp;|\u00a0)*([\d,]+\.\d+)<\/b><\/td>/gi;
  const cols = { min: [], avg: [], qty_avg: [], max: [] };
  let m;
  while ((m = re.exec(html)) !== null) {
    const label = m[1].toLowerCase();
    const currency = (m[2] || '');
    const value = parseFloat(m[3].replace(/,/g, ''));
    cols[label].push({ currency, value });
  }

  // 用锚点找到两个分区，只取分区内的格子，避免误取 Stores 搜索里的范围
  const parts = {};
  const secRe = /(Last 6 Months Sales|Current Items for Sale)([\s\S]*?)(?=<h1|$)/gi;
  let s;
  while ((s = secRe.exec(html)) !== null) {
    const bucket = [];
    const cRe = /\b(Min Price|Qty Avg Price|Avg Price|Max Price):/gi;
    let c;
    let lastIdx = 0;
    let lastLabel = '';
    let lastRec = null;
    while ((c = cRe.exec(s[2])) !== null) {
      const label = c[1].toLowerCase();
      // 取紧随其后的数字作为金额
      const seg = s[2].slice(c.index + c[0].length, c.index + c[0].length + 200);
      const num = seg.match(/<b>([A-Z]{2,3})?(?:\s|&nbsp;|\u00a0)*([\d,]+\.\d+)<\/b>/);
      if (num) {
        const kind = label === 'min price' ? 'min'
          : label === 'qty avg price' ? 'qty_avg'
          : label === 'avg price' ? 'avg' : 'max';
        bucket.push({ kind, currency: num[1], value: parseFloat(num[2].replace(/,/g, '')) });
      }
    }
    // bucket 顺序就是列顺序 [New,Used,New,Used...]；按列切分不在此处做，
    // 统一交给下方对 4 列规约，这里仅标记分区原始序列。
    parts[s[1].trim()] = bucket;
  }

  // 规约出按条件的 4 列结构。每个分区下按每 2 个指标布局还原列：
  // 列序恒为 [Last6New, Last6Used, CurrentNew, CurrentUsed]
  // bucket 内相邻 [min,avg,min,avg...] 以 4 个指标为一组 => 一组 = 一列
  function groupColumns(bucket) {
    // 每列包含 4 个指标：min/avg/qty_avg/max（缺失则 null）
    const columns = [[], [], [], []]; // last6new, last6used, curnew, curused
    let col = 0;
    let cur = { min: null, avg: null, qty_avg: null, max: null, currency: '' };
    for (const r of bucket) {
      cur[r.kind] = r.value;
      if (r.currency) cur.currency = r.currency;
      if (cur.min && cur.avg && (r.kind === 'max')) {
        columns[col] = cur;
        col = (col + 1) % 4;
        cur = { min: null, avg: null, qty_avg: null, max: null, currency: '' };
      }
    }
    return columns;
  }

  const last6 = groupColumns(parts['Last 6 Months Sales'] || []);
  const current = groupColumns(parts['Current Items for Sale'] || []);
  const currency = (last6[0] && last6[0].currency) || (current[0] && current[0].currency) || 'CNY';

  return {
    currency,
    last_6_months: { new: last6[0], used: last6[1] },
    current_for_sale: { new: current[0], used: current[1] },
  };
}

// ----------------------------------------------------------------------------
// Cookie 预热：先访问一次挑战页结算 aws-waf-token，把 Cookie 存进 KV 复用
// ----------------------------------------------------------------------------
const COOKIE_KEY = 'cookie:bl';

async function warmupCookie(env) {
  const cached = await env.BL_CACHE.get(COOKIE_KEY);
  const cooked = cached || '';
  const warmUrl = 'https://www.bricklink.com/catalogPG.asp?P=3001&colorID=7';
  const res = await fetch(warmUrl, {
    headers: { 'User-Agent': UA, Cookie: cooked },
    redirect: 'manual',
  });
  const setCookies = [];
  // 收集 Set-Cookie，拼出可复用的 Cookie 串
  const h = res.headers.get('set-cookie');
  if (h) setCookies.push(h);
  const newCook = mergeCookie(cooked, setCookies);
  if (newCook && newCook !== cooked) {
    await env.BL_CACHE.put(COOKIE_KEY, newCook, { expirationTtl: 60 * 60 });
  }
  return { cook: newCook, status: res.status };
}

function mergeCookie(oldCook, setCookies) {
  const map = {};
  if (oldCook) for (const kv of oldCook.split(';')) { const [k, ...v] = kv.trim().split('='); if (k) map[k] = v.join('='); }
  for (const sc of setCookies) if (sc) map[sc.split('=')[0].trim()] = sc.split(';')[0].split('=').slice(1).join('=');
  return Object.keys(map).map((k) => `${k}=${map[k]}`).join('; ');
}

// ----------------------------------------------------------------------------
// 主入口
// ----------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response('', { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/api/price') {
      return json({ ok: false, error: 'not_found', hint: '使用 /api/price?P=<型号>&colorID=<颜色ID>' }, 404);
    }

    const P = cleanPartNum(url.searchParams.get('P'));
    const colorID = String(url.searchParams.get('colorID') || '').trim();
    if (!P || !colorID) {
      return json({ ok: false, error: 'bad_request', hint: '缺少 P 或 colorID' }, 400);
    }

    // 1) 先查 KV 缓存
    const cacheKey = `bl:${P}:${colorID}:N`;
    const cached = await env.BL_CACHE.get(cacheKey).then((s) => (s ? JSON.parse(s) : null));
    if (cached) {
      const age = Date.now() - (cached._t || 0);
      if (age < CACHE_TTL_MS) {
        return json({ ...cached, cached: true });
      }
    }

    // 2) miss → Cookie 预热
    const warm = await warmupCookie(env).catch(() => ({ cook: '', status: 0 }));

    // 3) 抓 BL 价格指南页
    const target = `https://www.bricklink.com/catalogPG.asp?P=${encodeURIComponent(P)}&colorID=${encodeURIComponent(colorID)}`;
    const res = await fetch(target, {
      headers: { 'User-Agent': UA, Cookie: warm.cook, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
    });
    const html = await res.text();

    // 4) WAF 挑战未结算
    if (res.status === 202 || html.indexOf('aws-waf-token') !== -1 || html.indexOf('challenge') !== -1 && html.length < 5000) {
      return json({
        ok: false,
        error: 'waf_challenge',
        status: res.status,
        hint: '数据中心 IP 仍在 AWS WAF 挑战中，可选方案：启用 Cloudflare Browser Rendering 或使用 Bricklink 官方 Open API。',
      }, 502);
    }

    // 5) 解析
    const parsed = extractPriceGuide(html);
    const hasData =
      (parsed.last_6_months.new && parsed.last_6_months.new.min != null) ||
      (parsed.current_for_sale.new && parsed.current_for_sale.new.min != null);
    if (!hasData) {
      return json({ ok: false, error: 'no_price_data', hint: '页面已加载但未解析到价格，可能页面结构变化' }, 502);
    }

    // 6) 写回 KV 缓存
    const body = {
      ok: true,
      P, colorID,
      currency: parsed.currency,
      last_6_months: parsed.last_6_months,
      current_for_sale: parsed.current_for_sale,
      source: 'bl-proxy-worker',
      generated_at: new Date().toISOString(),
      _t: Date.now(),
      cached: false,
    };
    // 去掉 _t 后缓存，读取时用 _t 判龄
    const store = { ...body, _t: Date.now() };
    await env.BL_CACHE.put(cacheKey, JSON.stringify(store), { expirationTtl: Math.ceil(CACHE_TTL_MS / 1000) });

    return json(body);
  },
};