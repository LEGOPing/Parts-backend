/**
 * Bricklink 价格指南无头浏览器抓取 —— Cloudflare Workers + Browser Rendering (Playwright @cloudflare/playwright)
 *
 * 思路：由 Cloudflare 托管的 Chromium（Browser Rendering binding）真实执行 Bricklink 的
 * AWS WAF 挑战脚本拿到 aws-waf-token，从而读到 catalogPG.asp 价格指南页，再解析两组价格：
 *   1. Last 6 Months Sales · New
 *   2. Current Items for Sale · New
 * 解析算法与前端 ui.js 的 extractBLPriceGuide 及 app/bricklink_price.py 对齐：
 *   锚定 "Last 6 Months Sales" + 宽松正则，避免误取 Stores 搜索筛选里的 Min/Max。
 *
 * 调用：GET /api/price?P=<part>&colorID=<color>
 * 响应：{ ok, last_6_months, current_for_sale, currency, updated_at, source }
 */
// 注意：运行期 @cloudflare/playwright 禁用了 chromium.browserType.launch()，
// 必须用包顶层导出的 launch()，并把 Browser Rendering binding(Fetcher) 作为 endpoint 传入。
import { launch } from '@cloudflare/playwright';

interface Env {
  MYBROWSER: Fetcher;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const SEP = String.raw`(?:\s|\u00a0|&nbsp;)*`;

/** 在价格指南区域内按文档顺序收集所有指标单元格（4 数据列恒为 Last6-New/Used, Current-New/Used）。 */
function collectPriceCells(html: string) {
  const re = new RegExp(
    String.raw`<td>(Min Price|Qty Avg Price|Avg Price|Max Price):</td>\s*` +
    String.raw`<td><b>([A-Z]{2,3})` + SEP + String.raw`([\d,]+\.\d+)</b></td>`,
    'gi',
  );
  const cells: Record<string, Array<{ currency: string; value: number }>> = {
    min: [], avg: [], qty_avg: [], max: [],
  };
  const keyMap: Record<string, keyof typeof cells> = {
    'min price': 'min', 'avg price': 'avg', 'qty avg price': 'qty_avg', 'max price': 'max',
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const key = keyMap[m[1].toLowerCase()];
    if (!key) continue;
    const value = Number.parseFloat(m[3].replace(/,/g, ''));
    if (Number.isNaN(value)) continue;
    cells[key].push({ currency: m[2].toUpperCase(), value });
  }
  return cells;
}

/** 取某一条件列（col=0 为 New 用于 last6，col=2 为 New 用于 current）的四项价格。 */
function blockFromCols(cells: ReturnType<typeof collectPriceCells>, col: number) {
  const get = (k: keyof typeof cells) => (cells[k][col] ? cells[k][col].value : undefined);
  const currency = (k: keyof typeof cells) => (cells[k][col] ? cells[k][col].currency : '');
  const min = get('min'), avg = get('avg'), qty = get('qty_avg'), max = get('max');
  if ([min, avg, qty, max].every((v) => v === undefined)) return null;
  return {
    currency: currency('min') || currency('avg') || currency('qty_avg') || currency('max'),
    min, avg, qty_avg: qty, max,
  };
}

function parsePriceGuide(html: string) {
  const idx = html.indexOf('Last 6 Months Sales');
  if (idx < 0) return null;
  // 从标题起截取前 20k 字符，覆盖四个条件列，避免吃到更下方的商店在售列表
  const section = html.slice(idx, idx + 20000);
  const cells = collectPriceCells(section);
  const last_6_months = blockFromCols(cells, 0);
  const current_for_sale = blockFromCols(cells, 2);
  if (!last_6_months && !current_for_sale) return null;
  return { last_6_months, current_for_sale };
}

function buildUrl(part: string, color: string) {
  const clean = part.replace(/[^a-zA-Z0-9]/g, '');
  return `https://www.bricklink.com/catalogPG.asp?P=${encodeURIComponent(clean)}&colorID=${encodeURIComponent(color)}`;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') return json(405, { ok: false, error: '仅支持 GET' });

    const url = new URL(request.url);
    const part = (url.searchParams.get('P') || '')
      .replace(/[^a-zA-Z0-9]/g, '');
    const color = (url.searchParams.get('colorID') || url.searchParams.get('color') || '').toString();
    if (!part || !color) return json(400, { ok: false, error: '缺少参数 P / colorID' });

    let browser;
    try {
      // env.MYBROWSER 是 Browser Rendering 的 Fetcher；launch() 运行期接受该
      // binding，仅类型签名不匹配，故做一次类型断言。
      browser = await launch(env.MYBROWSER as any);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'en-US',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      });
      const page = await context.newPage();
      await page.goto(buildUrl(part, color), { waitUntil: 'domcontentloaded', timeout: 40000 });
      // AWS WAF 挑战通过后浏览器会自动 reload。轮询等待价格锚点出现，
      // 避免"挑战页已 load、价格还没渲染"时过早取 content。
      const deadline = Date.now() + 30000;
      let html = await page.content();
      while (Date.now() < deadline && !html.includes('Last 6 Months Sales')) {
        try {
          await page.waitForTimeout(800);
        } catch { /* 忽略 */ }
        html = await page.content();
      }
      const data = parsePriceGuide(html);
      if (!data) {
        // debug=1 时把去标签后的可见文本前部吐出来，便于排查是被 WAF 拦截还是布局变化
        if (new URL(request.url).searchParams.get('debug') === '1') {
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          return json(200, {
            ok: false,
            error: 'bricklink 解析无数据(可能被风控拦截)',
            page_text: text.slice(0, 4000),
          });
        }
        return json(200, { ok: false, error: 'bricklink 解析无数据(可能被风控拦截)' });
      }
      const currency = (data.last_6_months && data.last_6_months.currency)
        || (data.current_for_sale && data.current_for_sale.currency)
        || '';
      return json(200, {
        ok: true,
        part_num: part,
        color_id: color,
        currency,
        last_6_months: data.last_6_months,
        current_for_sale: data.current_for_sale,
        updated_at: new Date().toISOString(),
        source: 'bricklink-live-cloudflare-workers',
      });
    } catch (e) {
      return json(200, { ok: false, error: `bricklink 抓取异常: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) });
    } finally {
      try {
        await browser?.close();
      } catch { /* 忽略 */ }
    }
  },
} satisfies ExportedHandler<Env>;