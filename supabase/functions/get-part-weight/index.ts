// Supabase Edge Function: 根据零件型号从 Bricklink 查询单个零件重量（克）
// 部署方式：Supabase Dashboard → Edge Functions → Edit → 粘贴代码 → Deploy
// 前端调用：GET https://tfxydlkpxkdpxyoqrkez.supabase.co/functions/v1/get-part-weight?part_number=3001

interface WeightResult {
  part_number: string;
  weight: number | null;
  error?: string;
}

// 内存缓存：已查询过的零件重量，避免重复请求
const weightCache = new Map<string, number>();

// 从 HTML 中提取单个零件重量（克），算法与 Swift 版 AddPartView.extractWeight 一致
function extractWeightFromHtml(html: string): number | null {
  const patterns = ['Weight：', 'Weight:', 'weight：', 'weight:'];
  for (const pattern of patterns) {
    const idx = html.indexOf(pattern);
    if (idx !== -1) {
      const segment = html.substring(idx, idx + 100);
      const m = segment.match(/(\d+(?:\.\d+)?)/);
      if (m) {
        const w = parseFloat(m[1]);
        if (w > 0) return Math.round(w * 10000) / 10000;
      }
    }
  }
  const fallback = html.match(/(\d+(?:\.\d+)?)\s*g/);
  if (fallback) {
    const w = parseFloat(fallback[1]);
    if (w > 0) return Math.round(w * 10000) / 10000;
  }
  return null;
}

// 从 Bricklink 页面抓取重量（与 Swift 版 fetchBricklinkPartWeight 一致：简单 headers）
async function fetchWeightFromBricklink(partNum: string): Promise<{ weight: number | null; error?: string }> {
  const bricklinkUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${partNum}`;

  // 与 Swift 版 URLSession 一致：简单 headers，不暴露爬虫特征
  const headers = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'text/html',
  };

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(bricklinkUrl, { headers });
      if (!resp.ok) {
        lastError = `Bricklink HTTP ${resp.status}`;
        if (resp.status === 404) {
          return { weight: null, error: 'Bricklink 上未找到该零件' };
        }
        continue;
      }
      const html = await resp.text();
      const weight = extractWeightFromHtml(html);
      if (weight !== null) {
        return { weight };
      }
      lastError = '未在 Bricklink 页面中找到重量数据';
    } catch (e) {
      lastError = `Bricklink 请求失败: ${String(e)}`;
    }
  }
  return { weight: null, error: lastError };
}

// 处理 CORS 预检请求
function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  };

  const url = new URL(req.url);
  const partNumber = url.searchParams.get('part_number') || url.searchParams.get('partNumber') || '';

  if (!partNumber.trim()) {
    return new Response(
      JSON.stringify({ part_number: '', weight: null, error: '零件型号不能为空' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const cleanNum = partNumber.replace(/[^a-zA-Z0-9]/g, '');
  if (!cleanNum) {
    return new Response(
      JSON.stringify({ part_number: '', weight: null, error: '零件型号无效' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 1. 检查内存缓存（与 Swift 版 getLocalPartWeight 对应）
  if (weightCache.has(cleanNum)) {
    const cachedWeight = weightCache.get(cleanNum)!;
    return new Response(
      JSON.stringify({ part_number: cleanNum, weight: cachedWeight }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 2. 从 Bricklink 抓取
  const bricklinkResult = await fetchWeightFromBricklink(cleanNum);
  if (bricklinkResult.weight !== null) {
    weightCache.set(cleanNum, bricklinkResult.weight);
    return new Response(
      JSON.stringify({ part_number: cleanNum, weight: bricklinkResult.weight }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 3. 失败则返回错误
  return new Response(
    JSON.stringify({
      part_number: cleanNum,
      weight: null,
      error: bricklinkResult.error || '查询失败',
    }),
    { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
