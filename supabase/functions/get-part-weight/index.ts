// Supabase Edge Function: 根据零件型号从 Bricklink 查询单个零件重量（克）
// 部署方式：Supabase Dashboard → Edge Functions → Create new function → 粘贴代码 → Deploy
// 前端调用：GET https://tfxydlkpxkdpxyoqrkez.supabase.co/functions/v1/get-part-weight?part_number=3001

interface WeightResult {
  part_number: string;
  weight: number | null;
  error?: string;
}

// 从 HTML 中提取单个零件重量（克），算法与后端 Python 实现一致
function extractWeightFromHtml(html: string): number | null {
  // 先查找 "Weight:"/"Weight：" 关键字后的数字
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
  // 回退：匹配 "数字 g" 模式
  const fallback = html.match(/(\d+(?:\.\d+)?)\s*g/);
  if (fallback) {
    const w = parseFloat(fallback[1]);
    if (w > 0) return Math.round(w * 10000) / 10000;
  }
  return null;
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
  // CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  };

  // 解析查询参数
  const url = new URL(req.url);
  const partNumber = url.searchParams.get('part_number') || url.searchParams.get('partNumber') || '';

  if (!partNumber.trim()) {
    const result: WeightResult = { part_number: '', weight: null, error: '零件型号不能为空' };
    return new Response(JSON.stringify(result), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // 清理零件型号：只保留字母和数字
  const cleanNum = partNumber.replace(/[^a-zA-Z0-9]/g, '');
  if (!cleanNum) {
    const result: WeightResult = { part_number: '', weight: null, error: '零件型号无效' };
    return new Response(JSON.stringify(result), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // 抓取 Bricklink 页面（含重试）
  const bricklinkUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${cleanNum}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  };

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(bricklinkUrl, { headers });
      if (!resp.ok) {
        lastError = `HTTP ${resp.status}`;
        if (resp.status === 404) {
          const result: WeightResult = { part_number: cleanNum, weight: null, error: 'Bricklink 上未找到该零件' };
          return new Response(JSON.stringify(result), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        continue;
      }
      const html = await resp.text();
      const weight = extractWeightFromHtml(html);
      if (weight !== null) {
        const result: WeightResult = { part_number: cleanNum, weight };
        return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      lastError = '未在页面中找到重量数据';
    } catch (e) {
      lastError = String(e);
      console.warn(`Bricklink 重量查询失败 (尝试 ${attempt}):`, e);
    }
  }

  const result: WeightResult = { part_number: cleanNum, weight: null, error: lastError || '查询失败' };
  return new Response(JSON.stringify(result), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
