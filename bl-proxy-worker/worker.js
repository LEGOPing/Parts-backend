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
// 从价格指南 HTML 中解析两组价格（移植自 app/bricklink_price.py，输出完全一致）
//
// Bricklink 价格指南是一个"指标为行、条件为列"的网格，4 个数据列恒为：
//   [Last6-New(col0), Last6-Used(col1), Current-New(col2), Current-Used(col3)]
// 单元格形如：<td>Min Price:</td><td><b>CNY&nbsp;0.07</b></td>
//
// 返回（New 条件，与前端期待的结构一致）：
//   {
//     last_6_months:     { min, avg, qty_avg, max, currency },
//     current_for_sale:  { min, avg, qty_avg, max, currency },
//   }
// ----------------------------------------------------------------------------
function extractPriceGuide(html) {
  if (!html || typeof html !== 'string') return null;
  const idx = html.indexOf('Last 6 Months Sales');
  if (idx < 0) return null;

  // 从 "Last 6 Months Sales" 标题起截取足够范围（覆盖四个条件列；不含更下方的在售列表）
  const section = html.slice(idx, idx + 20000);

  // 注意：Qty Avg Price 必须先于 Avg Price，避免贪婪误匹配
  const re = /<td>(Min Price|Qty Avg Price|Avg Price|Max Price):<\/td>\s*<td><b>([A-Z]{2,3})?(?:\s|&nbsp;|\u00a0)*([\d,]+\.\d+)<\/b><\/td>/gi;
  const cells = { min: [], avg: [], qty_avg: [], max: [] };
  let m;
  while ((m = re.exec(section)) !== null) {
    const label = m[1].toLowerCase();
    const currency = (m[2] || '').toUpperCase();
    const value = parseFloat(m[3].replace(/,/g, ''));
    const key = label === 'min price' ? 'min'
      : label === 'qty avg price' ? 'qty_avg'
      : label === 'avg price' ? 'avg' : 'max';
    cells[key].push({ currency, value });
  }

  // 取某一条件列(c0=New 用在 Last6；c2=New 用在 Current)的四项价格，与 Python 对齐
  function blockFromCols(col) {
    const get = (key) => {
      const lst = cells[key] || [];
      return lst[col] ? lst[col].value : null;
    };
    const cur = (key) => {
      const lst = cells[key] || [];
      return lst[col] ? lst[col].currency : '';
    };
    const min = get('min'), avg = get('avg'), qty = get('qty_avg'), max = get('max');
    if (min == null && avg == null && qty == null && max == null) return null;
    return {
      currency: cur('min') || cur('avg') || cur('qty_avg') || cur('max'),
      min, avg, qty_avg: qty, max,
    };
  }

  return {
    last_6_months: blockFromCols(0),   // Last6 · New
    current_for_sale: blockFromCols(2), // Current · New
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
    if (!parsed) {
      return json({ ok: false, error: 'no_price_data', hint: '未找到价格锚点，可能被 WAF 拦截或页面结构变化' }, 502);
    }
    const lm = parsed.last_6_months, cf = parsed.current_for_sale;
    const hasData = (lm && lm.min != null) || (cf && cf.min != null);
    if (!hasData) {
      return json({ ok: false, error: 'no_price_data', hint: '页面已加载但未解析到价格，可能页面结构变化' }, 502);
    }

    // 6) 组装与后端完全一致的响应结构
    const nowIso = new Date().toISOString();
    const currency = (lm && lm.currency) || (cf && cf.currency) || 'CNY';
    const body = {
      ok: true,
      part_num: P,
      color_id: colorID,
      currency,
      last_6_months: lm,
      current_for_sale: cf,
      source: 'bl-proxy-worker',
      updated_at: nowIso,
      cached: false,
    };
    // 缓存含内部时间戳 _t 用于 30 分钟判龄
    await env.BL_CACHE.put(cacheKey, JSON.stringify({ ...body, _t: Date.now() }), {
      expirationTtl: Math.ceil(CACHE_TTL_MS / 1000),
    });

    return json(body);
  },
};