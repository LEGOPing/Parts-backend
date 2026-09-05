const SUPABASE_URL = 'https://tfxydlkpxkdpxyoqrkez.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EPZpWFRObklmwpfXerINvQ_S-OeeIM_';

const API_BASE = `${SUPABASE_URL}/rest/v1`;
// 本地开发（localhost）走本机 FastAPI，可利用本机 IP 抓取 Bricklink 重量；
// 生产环境走 CloudBase 云托管（依赖 Supabase part_weights 缓存）。
const BACKEND_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? `http://${location.hostname}:8000`
    : 'https://parts-backend-1257419788.ap-shanghai.run.tcloudbase.com';

const GITEE_JSON_URL = 'https://gitee.com/legoping/Parts-json/raw/master/';
const GITEE_JSON_API_URL = 'https://gitee.com/api/v5/repos/legoping/Parts-json/contents';
const GITEE_IMG_URL = 'https://gitee.com/legoping/Parts-img/raw/main/';
const GITEE_RB_RAW_URL = 'https://gitee.com/legoping/parts-rb/raw/main';
const CORS_PROXY = 'https://corsproxy.io/?url=';

const RB_DATABASE_FILE = 'rb_database.json';
const DEFAULT_GITEE_TOKEN = '5e8fe75044a023e2c992c1b5d11c95f0';

let cachedColors = null;
let colorsCacheTime = 0;
const CACHE_EXPIRY = 3600000;

function supabaseHeaders(extra = {}) {
    return {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...extra
    };
}

async function executeSQL(query) {
    // 调用后端 API 重置序列
    try {
        const response = await fetch(`${BACKEND_URL}/api/settings/reset-sequences`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`重置序列失败: HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('重置序列失败:', error.message);
        throw error;
    }
}

async function supabaseRequest(table, options = {}) {
    try {
        let url = `${API_BASE}/${table}`;
        const queryParams = [];
        
        if (options.select) {
            queryParams.push(`select=${encodeURIComponent(options.select)}`);
        }
        if (options.filters) {
            for (const [key, value] of Object.entries(options.filters)) {
                if (value !== undefined && value !== null) {
                    if (Array.isArray(value)) {
                        const encodedValues = value.map(v => encodeURIComponent(v)).join(',');
                        queryParams.push(`${key}=eq.${encodedValues}`);
                    } else if (typeof value === 'string' && value.startsWith('eq.')) {
                        queryParams.push(`${key}=${value}`);
                    } else {
                        queryParams.push(`${key}=eq.${value}`);
                    }
                }
            }
        }
        if (options.order) {
            queryParams.push(`order=${encodeURIComponent(options.order)}`);
        }
        if (options.limit) {
            queryParams.push(`limit=${options.limit}`);
        }
        
        if (queryParams.length > 0) {
            url += `?${queryParams.join('&')}`;
        }

        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: supabaseHeaders(options.headers),
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }
        return await response.text();
    } catch (error) {
        console.error(`Supabase request failed (${table}):`, error.message);
        throw error;
    }
}

async function fetchJSONFile(fileName) {
    try {
        const response = await fetch(`${GITEE_JSON_URL}${fileName}`);
        return await response.json();
    } catch (error) {
        console.error(`加载JSON文件失败: ${fileName}`, error);
        return null;
    }
}

async function fetchRBFile(fileName) {
    try {
        // 使用Gitee API + Token获取文件（CORS代理已全部失效，仅保留此方式）
        const token = localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
        if (token) {
            const apiUrl = `https://gitee.com/api/v5/repos/legoping/parts-rb/contents/${fileName}?ref=main`;
            const apiResponse = await fetch(apiUrl, {
                headers: { 'Authorization': `token ${token}` }
            });
            if (apiResponse.ok) {
                const data = await apiResponse.json();
                if (data.content) {
                    // 使用TextDecoder替代escape+decodeURIComponent，大幅提升大文件(14MB+)解码性能
                    const binaryString = atob(data.content);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    return new TextDecoder('utf-8').decode(bytes);
                }
            }
        }
        
        throw new Error('无法访问Gitee文件: ' + fileName);
    } catch (error) {
        console.error(`加载RB文件失败: ${fileName}`, error);
        return null;
    }
}

// 从 Gitee parts-rb 下载 bl_colors.json 并写入离线 RB 数据库 rb_bl_colors 表。
// 用于启动补全 / 更新 RB 时加载 BL 颜色表，非阻塞（失败仅告警）。
async function loadBLColorsToRBDB() {
    const text = await fetchRBFile('bl_colors.json');
    if (!text) return { success: false, count: 0, error: 'bl_colors.json 读取失败' };
    let records;
    try {
        records = JSON.parse(text);
    } catch (e) {
        return { success: false, count: 0, error: 'bl_colors.json 解析失败: ' + e.message };
    }
    return await importBLColorsToRBDb(records);
}

// ==================== Bricklink 价格指南（catalogPG.asp）====================
// 价格数据位于“Last 6 Months Sales”下的“New”行：
//   Min Price / Avg Price / Qty Avg Price / Max Price
// 因该页面结构与.Product页不同、且有时带 WAF 反爬，这里采用锚定 + 正则的宽松解析，
// 借助“Last 6 Months Sales”定位区域、以“New”标签定位新件行，避免误取“Stores搜索筛选”里的 Min/Max。

// 从价格指南 HTML 中提取 New 商品的四个价格（含币种），返回 { currency, minPrice, avgPrice, qtyAvgPrice, maxPrice }
function extractBLPriceGuide(html) {
    if (!html || typeof html !== 'string') return null;
    // 币种：形如 CNY/USD/EUR 等，跟随价格的货币代码
    const CURRENCY_RE = /(CNY|USD|EUR|GBP|HKD|RMB|JPY|AUD|CAD)\s*[\d,]+\.\d+/i;

    // 1. 定位 “Last 6 Months Sales” 区域，限长 40000 字符（避免命中其他页面片段）
    const anchor = html.indexOf('Last 6 Months Sales');
    if (anchor < 0) return null;
    const section = html.slice(anchor, anchor + 40000);

    // 2. 定位 “New” 条件段；若存在多个 New，取第一个（其后跟价格单元格）
    let newIdx = section.indexOf('>New<');
    if (newIdx < 0) newIdx = section.indexOf('New Price'); // 兼容备用锚点
    if (newIdx < 0) newIdx = section.indexOf('>New</');
    if (newIdx < 0) return null;
    const newSection = section.slice(newIdx, newIdx + 8000);

    // 3. 用标签正则逐个提取金额。币种可选（部分页面不显示币种代码），金额必含小数。
    //    Avg Price 须用负向后行断言排除 "Qty Avg Price"。
    function extractValue(text, labelRe) {
        const m = text.match(labelRe);
        if (!m) return null;
        const numRaw = (m[2] != null ? m[2] : m[m.length - 1]).replace(/[^\d.]/g, '');
        const v = parseFloat(numRaw);
        return isNaN(v) ? null : v;
    }

    const minValue = extractValue(newSection, /Min Price\D{0,120}?(?:([A-Z]{2,3})\s*)?([\d,]+\.\d+)/i);
    const avgValue = extractValue(newSection, /(?<!Qty )Avg Price\D{0,120}?(?:([A-Z]{2,3})\s*)?([\d,]+\.\d+)/i);
    const qtyAvgValue = extractValue(newSection, /Qty Avg Price\D{0,120}?(?:([A-Z]{2,3})\s*)?([\d,]+\.\d+)/i);
    const maxValue = extractValue(newSection, /Max Price\D{0,120}?(?:([A-Z]{2,3})\s*)?([\d,]+\.\d+)/i);

    if (minValue === null && avgValue === null && qtyAvgValue === null && maxValue === null) {
        return null;
    }

    const curMatch = section.match(CURRENCY_RE);
    return {
        currency: curMatch ? String(curMatch[1]).toUpperCase() : '',
        minPrice: minValue,
        avgPrice: avgValue,
        qtyAvgPrice: qtyAvgValue,
        maxPrice: maxValue
    };
}

// 通过 CORS 代理从浏览器抓取 Bricklink 价格指南页并解析 New 件价格
async function fetchBLPriceGuide(brickLinkPart, blColorId) {
    const cleanNum = String(brickLinkPart || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!cleanNum) return null;
    const blUrl = `https://www.bricklink.com/catalogPG.asp?P=${encodeURIComponent(cleanNum)}&colorID=${encodeURIComponent(blColorId)}`;
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(blUrl)}`;
    try {
        const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
        if (!resp.ok) return null;
        const html = await resp.text();
        return extractBLPriceGuide(html);
    } catch (e) {
        console.warn('CORS 代理 Bricklink 价格抓取失败:', e.message);
        return null;
    }
}

// 由 RB 颜色 ID 解析对应的 BL 颜色 ID（离线 rb_bl_colors 表，按颜色名匹配）
async function resolveBLColorId(rbColorId) {
    try {
        const color = await getColorById(rbColorId);
        const name = color && color.name ? String(color.name) : '';
        if (!name) return null;
        const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = norm(name);
        if (!target) return null;
        const colors = await getAllBLColors();
        for (const rec of colors) {
            if (rec && norm(rec.name) === target) return rec.id;
        }
        return null; // 未在 BL 颜色表命中，无法确定 BL 颜色ID
    } catch (e) {
        console.warn('解析 BL 颜色ID失败:', e.message);
        return null;
    }
}

// 将 RB 型号 + RB 颜色ID 解析为 BL 价格指南所需的 { blPartNum, blColorId }
async function resolveBLTarget(rbPartNum, rbColorId) {
    const blColorId = await resolveBLColorId(rbColorId);
    if (blColorId === null) return null;
    const blPartNum = String(rbPartNum == null ? '' : rbPartNum).replace(/[^a-zA-Z0-9]/g, '');
    if (!blPartNum) return null;
    return { blPartNum, blColorId };
}

// 分片文件命名常量（与 push_inventory_parts_to_gitee.py 保持一致）
const INVENTORY_SHARD_BASE = 'inventory_parts_';
const INVENTORY_SHARD_SUFFIX = '.csv';
const INVENTORY_SHARDS_MANIFEST = 'inventory_parts_shards.json';

async function fetchRBShardsManifest() {
    try {
        const text = await fetchRBFile(INVENTORY_SHARDS_MANIFEST);
        if (!text) return null;
        const manifest = JSON.parse(text);
        if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
            return null;
        }
        return manifest;
    } catch (error) {
        console.error(`加载库存分片清单失败: ${INVENTORY_SHARDS_MANIFEST}`, error);
        return null;
    }
}

// 依次下载库存分片并合并（每个分片都带表头，仅保留第一个分片的表头）
// 若分片清单不存在（尚未分片上传），回退读取旧单文件 inventory_parts.csv，避免更新RB失败
async function fetchRBInventoryParts() {
    const manifest = await fetchRBShardsManifest();
    if (!manifest) {
        return await fetchRBFile('inventory_parts.csv');
    }

    const shardTexts = [];
    for (const fileName of manifest.files) {
        const text = await fetchRBFile(fileName);
        if (text === null || text === undefined) {
            console.error(`下载库存分片失败: ${fileName}`);
            return null;
        }
        shardTexts.push(text);
    }

    if (shardTexts.length === 0) {
        return null;
    }

    // 保留第一个分片的表头，其余分片去掉表头行后拼接。
    // 分片文件本身不含结尾换行，直接拼接会导致边界行粘连，因此分片间用换行衔接
    const mergedLines = [];
    for (let i = 0; i < shardTexts.length; i++) {
        let text = shardTexts[i].replace(/\r?\n$/, '');
        if (i === 0) {
            mergedLines.push(text);
        } else {
            const newlineIdx = text.indexOf('\n');
            mergedLines.push(newlineIdx === -1 ? '' : text.slice(newlineIdx + 1));
        }
    }
    return mergedLines.join('\n') + '\n';
}

// Gitee API 请求重试封装：处理写操作限流（HTTP 429）与连接重置（HTTP 000/网络异常）
// 429 响应为 HTML 且无 Retry-After 头，实测采用指数退避重试；400/401/404 等确定性错误不重试
async function giteeRequestWithRetry(fetchFn, { maxRetries = 5, onRetry = null } = {}) {
    let delay = 1000;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetchFn();
            if (response.ok) {
                return response;
            }
            if (response.status !== 429) {
                throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => '')}`);
            }
            if (attempt >= maxRetries) {
                throw new Error(`HTTP 429 (限流) 重试${maxRetries}次后仍失败`);
            }
            if (onRetry) onRetry(attempt + 1, delay);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 2, 60000);
        } catch (e) {
            const isNetworkError = e instanceof TypeError || !e.status;
            if (isNetworkError && attempt < maxRetries) {
                if (onRetry) onRetry(attempt + 1, delay);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.min(delay * 2, 60000);
                continue;
            }
            throw e;
        }
    }
    throw new Error('Gitee请求重试次数用尽');
}

// 上传单个分片到 Gitee parts-rb 仓库（POST 创建 / PUT 更新，幂等）
async function uploadRBShardToGitee(fileName, csvText, token) {
    const apiUrl = `${GITEE_JSON_API_URL.replace('/Parts-json/contents', '/parts-rb/contents')}/${fileName}`;
    const base64Data = btoa(unescape(encodeURIComponent(csvText)));

    const checkResp = await fetch(`${apiUrl}?ref=main`, {
        headers: { 'Authorization': `token ${token}` }
    });
    const existing = checkResp.ok ? await checkResp.json() : null;

    const body = {
        message: `feat: 更新RB库存分片 ${fileName} [skip ci]`,
        content: base64Data,
        branch: 'main'
    };
    if (existing && existing.sha) {
        body.sha = existing.sha;
    }

    return giteeRequestWithRetry(() => fetch(apiUrl, {
        method: existing ? 'PUT' : 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `token ${token}`
        },
        body: JSON.stringify(body)
    }));
}

// 将零件别名映射表（{ alias_part_num: rb_part_num }）全量写回 Gitee parts-rb 仓库的 part_aliases.csv
// 文件不存在则用 POST 创建，存在则用 PUT 更新（携带 sha，幂等）。
async function updatePartAliasesCSV(aliasesMap, token) {
    const t = token || localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
    if (!t) throw new Error('缺少 Gitee Token，无法写回别名CSV');

    const apiUrl = `${GITEE_JSON_API_URL.replace('/Parts-json/contents', '/parts-rb/contents')}/part_aliases.csv`;
    // 组装 CSV（header：alias_part_num,rb_part_num,remark）
    const lines = ['alias_part_num,rb_part_num,remark'];
    for (const [alias, rb] of Object.entries(aliasesMap || {})) {
        if (alias && rb) {
            lines.push(`${String(alias).trim()},${String(rb).trim()},BL重配自动更新`);
        }
    }
    const csvText = lines.join('\n') + '\n';
    const base64Data = btoa(unescape(encodeURIComponent(csvText)));

    // 1) 读取现有文件以获取 sha
    const checkResp = await fetch(`${apiUrl}?ref=main`, {
        headers: { 'Authorization': `token ${t}` }
    });
    const existing = checkResp.ok ? await checkResp.json() : null;

    // 2) 推送更新
    const body = {
        message: 'feat: 更新零件别名映射 part_aliases.csv [skip ci]',
        content: base64Data,
        branch: 'main'
    };
    if (existing && existing.sha) {
        body.sha = existing.sha;
    }

    await giteeRequestWithRetry(() => fetch(apiUrl, {
        method: existing ? 'PUT' : 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `token ${t}`
        },
        body: JSON.stringify(body)
    }));
    return lines.length - 1; // 返回别名条数
}

// 将别名数据（AL.json 生成的 { ITEMID, part_num } 列表）合并写入 Gitee parts-rb 仓库的 part_aliases.csv
// 保留已有记录原样，仅追加新别名（格式：alias_part_num,rb_part_num,remark）；
// 已有相同 alias 键的数据略过（不覆盖既有映射，含值不同者），避免破坏已有别名。
// 返回 { added, skipped, total }
async function mergeAliasesToPartAliasesCSV(aliasPairs, remark = 'BL匹配') {
    const t = localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
    if (!t) throw new Error('缺少 Gitee Token，无法写入别名CSV');

    const apiUrl = `${GITEE_JSON_API_URL.replace('/Parts-json/contents', '/parts-rb/contents')}/part_aliases.csv`;

    // 1) 读取现有文件（获取 sha 与已有数据行）
    let sha = null;
    let existingLines = [];
    const checkResp = await fetch(`${apiUrl}?ref=main`, {
        headers: { 'Authorization': `token ${t}` }
    });
    if (checkResp.ok) {
        const existing = await checkResp.json();
        if (existing && existing.content) {
            sha = existing.sha;
            const binaryString = atob(existing.content);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            existingLines = new TextDecoder('utf-8').decode(bytes).split(/\r?\n/);
        }
    }

    // 2) 保留表头与已有行，记录已存在的别名键
    const outLines = [];
    const existingAlias = new Set();
    let hasHeader = false;
    for (let i = 0; i < existingLines.length; i++) {
        const line = String(existingLines[i]).trim();
        if (!line) continue;
        if (!hasHeader && line.toLowerCase().startsWith('alias_part_num')) {
            outLines.push(line);
            hasHeader = true;
            continue;
        }
        const f = parseRBCSVLine(line);
        if (f.length >= 2 && f[0].trim()) {
            existingAlias.add(String(f[0]).trim());
            outLines.push(line);
        } else {
            outLines.push(line);
        }
    }
    if (!hasHeader) outLines.push('alias_part_num,rb_part_num,remark');

    // 3) 追加新别名（已有键略过，避免重复/覆盖）
    let added = 0, skipped = 0;
    const batchAdded = new Set();
    for (const pair of aliasPairs || []) {
        const a = String(pair.ITEMID == null ? pair.alias_part_num : pair.ITEMID).trim();
        const r = String(pair.part_num == null ? pair.rb_part_num : pair.part_num).trim();
        if (!a || !r || a === r) continue;
        if (existingAlias.has(a) || batchAdded.has(a)) {
            skipped++;
            continue;
        }
        outLines.push(`${a},${r},${remark}`);
        batchAdded.add(a);
        added++;
    }

    const csvText = outLines.join('\n') + '\n';

    // 4) 写回 Gitee（存在 PUT 更新 / 不存在 POST 创建，幂等）
    const base64Data = btoa(unescape(encodeURIComponent(csvText)));
    const body = {
        message: `feat: 追加零件别名映射 part_aliases.csv (+${added}) [skip ci]`,
        content: base64Data,
        branch: 'main'
    };
    if (sha) body.sha = sha;

    await giteeRequestWithRetry(() => fetch(apiUrl, {
        method: sha ? 'PUT' : 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `token ${t}`
        },
        body: JSON.stringify(body)
    }));

    return { added, skipped, total: outLines.length - 1 };
}

// 读取 Gitee parts-rb 仓库的 ID_Abc.json（型号英文词汇表），返回数组或 null
// 文件形状为 [{ word, count }]，按出现次数降序排列
async function fetchIDAbcJson() {
    try {
        const text = await fetchRBFile('ID_Abc.json');
        if (!text) return null;
        const data = JSON.parse(text);
        return Array.isArray(data) ? data : null;
    } catch (error) {
        console.error('加载 ID_Abc.json 失败:', error);
        return null;
    }
}

// 将型号英文词汇数组（[{ word, count }]）全量写回 Gitee parts-rb 仓库的 ID_Abc.json
// 文件不存在则 POST 创建，存在则 PUT 更新（携带 sha，幂等）。返回写入条数。
async function uploadIDAbcToGitee(records, token) {
    const t = token || localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
    if (!t) throw new Error('缺少 Gitee Token，无法写回 ID_Abc.json');

    const apiUrl = `${GITEE_JSON_API_URL.replace('/Parts-json/contents', '/parts-rb/contents')}/ID_Abc.json`;
    const jsonText = JSON.stringify(records || []);
    const base64Data = btoa(unescape(encodeURIComponent(jsonText)));

    const payload = {
        message: 'feat: 更新型号英文词汇 ID_Abc.json [skip ci]',
        content: base64Data,
        branch: 'main'
    };

    // 读取现有文件 sha。注意：路径不存在时 Gitee 可能返回空数组 []（JS 中为 truthy），
    // 只有返回含 sha 的对象才视为文件已存在，否则按创建处理，避免 PUT 缺 sha 报错。
    async function readSha() {
        try {
            const resp = await fetch(`${apiUrl}?ref=main`, { headers: { 'Authorization': `token ${t}` } });
            if (!resp.ok) return null;
            const json = await resp.json();
            return (json && !Array.isArray(json) && json.sha) ? json.sha : null;
        } catch (e) {
            console.warn('读取 ID_Abc.json 的 sha 失败:', e.message);
            return null;
        }
    }

    let sha = await readSha();
    if (sha) payload.sha = sha;

    try {
        await giteeRequestWithRetry(() => fetch(apiUrl, {
            method: sha ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `token ${t}` },
            body: JSON.stringify(payload)
        }));
    } catch (e) {
        // 文件已存在但未拿到 sha（POST 创建失败）：补读 sha 后改用 PUT 更新
        if (!sha && /sha|exist/i.test(String(e.message))) {
            sha = await readSha();
            if (sha) {
                payload.sha = sha;
                await giteeRequestWithRetry(() => fetch(apiUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `token ${t}` },
                    body: JSON.stringify(payload)
                }));
                return (records || []).length;
            }
        }
        throw e;
    }
    return (records || []).length;
}

// 将本地 inventory_parts.csv 去重后分割为 <4MB 分片并上传到 Gitee parts-rb 仓库
// 分片命名 inventory_parts_1.csv、inventory_parts_2.csv ...（序号从1开始，每片都带表头）
// 上传完成后写入清单 inventory_parts_shards.json，前端读取逻辑按清单合并
async function uploadRBInventoryShards(file, { onProgress = null } = {}) {
    const token = localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
    if (!token) {
        throw new Error('缺少 Gitee Token，无法上传分片');
    }

    const MAX_SHARD_BYTES = 4 * 1024 * 1024;

    const text = await file.text();
    const lines = text.split(/\r?\n/);
    const headerLine = lines[0];
    const rawLines = lines.slice(1).filter(line => line.trim() !== '');

    // 去重：仅移除完全重复的行，确保数据完整。
    // 关键列存在时按 (part_num, color_id, img_url) 去重——同一 part+color 的不同图片
    // （img_url 不同）全部保留（前端按 part+color 查询图片依赖多图），只剔除
    // "同零件同颜色同图片"在不同 inventory 中重复出现的行（当前用途无需 inventory_id/quantity）。
    // 若表头缺少关键列，退化为按整行去重，保证不会误删任何不同记录。
    const headerFields = parseRBCSVLine(headerLine);
    const keyIdx = {
        part: headerFields.indexOf('part_num'),
        color: headerFields.indexOf('color_id'),
        img: headerFields.indexOf('img_url')
    };
    const hasKeyCols = keyIdx.part >= 0 && keyIdx.color >= 0;
    const seen = new Set();
    const dataLines = [];
    for (const line of rawLines) {
        let key;
        if (hasKeyCols) {
            const f = parseRBCSVLine(line);
            const part = keyIdx.part < f.length ? f[keyIdx.part] : '';
            const color = keyIdx.color < f.length ? f[keyIdx.color] : '';
            const img = (keyIdx.img >= 0 && keyIdx.img < f.length) ? f[keyIdx.img] : '';
            key = part + '\u0000' + color + '\u0000' + img;
        } else {
            key = line;
        }
        if (!seen.has(key)) {
            seen.add(key);
            dataLines.push(line);
        }
    }

    const shards = [];
    let current = [headerLine];
    let currentSize = new Blob([headerLine + '\n']).size;
    for (const line of dataLines) {
        const lineSize = new Blob([line + '\n']).size;
        if (currentSize + lineSize >= MAX_SHARD_BYTES && current.length > 1) {
            shards.push(current.join('\n'));
            current = [headerLine];
            currentSize = new Blob([headerLine + '\n']).size;
        }
        current.push(line);
        currentSize += lineSize;
    }
    if (current.length > 1) {
        shards.push(current.join('\n'));
    }

    if (shards.length === 0) {
        throw new Error('文件为空或仅含表头');
    }

    const manifest = {
        count: shards.length,
        files: shards.map((_, i) => `${INVENTORY_SHARD_BASE}${i + 1}${INVENTORY_SHARD_SUFFIX}`),
        rows: dataLines.length,
        source_rows: rawLines.length,
        generated_at: new Date().toISOString()
    };

    for (let i = 0; i < shards.length; i++) {
        const fileName = manifest.files[i];
        const onRetry = (retryNum, waitMs) => {
            if (onProgress) onProgress({
                phase: 'retry',
                shardIndex: i,
                shardTotal: shards.length,
                retryNum,
                waitMs,
                message: `分片 ${i + 1}/${shards.length} 触发限流，${Math.round(waitMs / 1000)}秒后第 ${retryNum} 次重试...`
            });
        };
        if (onProgress) onProgress({
            phase: 'upload',
            shardIndex: i,
            shardTotal: shards.length,
            message: `上传分片 ${i + 1}/${shards.length} (${fileName})...`
        });
        await uploadRBShardToGitee(fileName, shards[i], token);
        // 分片间间隔，避免连续写触发 Gitee 限流
        if (i < shards.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2500));
        }
    }

    if (onProgress) onProgress({
        phase: 'manifest',
        shardTotal: shards.length,
        message: '上传分片清单...'
    });
    await uploadRBShardToGitee(INVENTORY_SHARDS_MANIFEST, JSON.stringify(manifest), token);

    return { count: shards.length, rows: dataLines.length, source_rows: rawLines.length, files: manifest.files };
}

function parseRBCSVLine(line) {
    const result = [];
    let currentField = '';
    let inQuotes = false;
    
    for (const char of line) {
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(currentField.trim());
            currentField = '';
        } else {
            currentField += char;
        }
    }
    
    result.push(currentField.trim());
    return result;
}

function parseRBCSV(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) return { headers: [], data: [] };
    
    const headers = parseRBCSVLine(lines[0]);
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const row = parseRBCSVLine(lines[i]);
        if (row.length === headers.length) {
            const obj = {};
            headers.forEach((h, idx) => {
                obj[h] = row[idx];
            });
            data.push(obj);
        }
    }
    
    return { headers, data };
}

// RB数据类型定义 - 明确指定每个字段的类型
const RB_SCHEMAS = {
    colors: {
        numeric: ['id', 'num_parts', 'num_sets', 'y1', 'y2'],
        boolean: ['is_trans']
    },
    parts: {
        numeric: ['part_cat_id'],
        string: ['part_num', 'name', 'part_material']
    },
    part_categories: {
        numeric: ['id'],
        string: ['name']
    },
    elements: {
        numeric: ['element_id', 'color_id', 'design_id'],
        string: ['part_num']
    },
    inventory_parts: {
        numeric: ['inventory_id', 'color_id', 'quantity'],
        boolean: ['is_spare'],
        string: ['part_num', 'img_url']
    },
    part_relationships: {
        string: ['rel_type', 'child_part_num', 'parent_part_num']
    },
// BL-parts：Bricklink 目录桥接表。CODENAME 实为数字（对应 elements.element_id 数字主键），
    // 故转 numeric 便于 getByKey 直接匹配；ITEMID/COLOR 为文本（ITEMID 可能含字母，如 "14pb10"）。
    bl_parts: {
        numeric: ['CODENAME'],
        string: ['ITEMTYPE', 'ITEMID', 'COLOR']
    }
};

function convertRBData(storeKey, data) {
    const schema = RB_SCHEMAS[storeKey];
    if (!schema) return data;
    
    return data.map(row => {
        const converted = {};
        for (const [key, value] of Object.entries(row)) {
            if (schema.numeric && schema.numeric.includes(key)) {
                converted[key] = value !== '' ? Number(value) : 0;
            } else if (schema.boolean && schema.boolean.includes(key)) {
                converted[key] = value === 'True' || value === 'true';
            } else {
                converted[key] = value;
            }
        }
        return converted;
    });
}

async function getColorName(colorId) {
    const colors = await fetchAllColors();
    const color = colors.find(c => c.id === colorId);
    return color ? color.name : '未知颜色';
}

async function getColorInfo(colorId) {
    const colors = await fetchAllColors();
    return colors.find(c => c.id === colorId) || null;
}

async function fetchAllColors() {
    const now = Date.now();
    if (cachedColors && now - colorsCacheTime < CACHE_EXPIRY) {
        return cachedColors;
    }

    const colors = await fetchJSONFile('colors.json');
    let result;

    if (!colors || !colors[0] || !colors[0].rgb) {
        result = [
            { id: 1, name: 'Black', rgb: '#1a1a1a' },
            { id: 2, name: 'Dark Gray', rgb: '#4a4a4a' },
            { id: 3, name: 'Light Gray', rgb: '#9a9a9a' },
            { id: 4, name: 'White', rgb: '#ffffff' },
            { id: 5, name: 'Red', rgb: '#c41e3a' },
            { id: 6, name: 'Orange', rgb: '#ff7f00' },
            { id: 7, name: 'Yellow', rgb: '#ffd700' },
            { id: 8, name: 'Yellow Green', rgb: '#9acd32' },
            { id: 9, name: 'Green', rgb: '#228b22' },
            { id: 10, name: 'Dark Blue', rgb: '#191970' },
            { id: 11, name: 'Blue', rgb: '#0066cc' },
            { id: 12, name: 'Light Blue', rgb: '#00bfff' },
            { id: 13, name: 'Purple', rgb: '#8b008b' },
            { id: 14, name: 'Dark Pink', rgb: '#ff1493' },
            { id: 15, name: 'Pink', rgb: '#ff69b4' },
            { id: 16, name: 'Brown', rgb: '#8b4513' },
            { id: 17, name: 'Beige', rgb: '#f5f5dc' },
            { id: 18, name: 'Gold', rgb: '#ffd700' },
            { id: 19, name: 'Silver', rgb: '#c0c0c0' },
            { id: 20, name: 'Transparent', rgb: '#e0e0e0' },
            { id: 21, name: 'Dark Blue', rgb: '#000080' },
            { id: 22, name: 'Light Blue', rgb: '#87ceeb' },
            { id: 23, name: 'Dark Green', rgb: '#006400' },
            { id: 24, name: 'Light Green', rgb: '#98fb98' },
            { id: 25, name: 'Dark Red', rgb: '#8b0000' },
            { id: 26, name: 'Coral', rgb: '#ff7f50' },
            { id: 27, name: 'Violet', rgb: '#ee82ee' },
            { id: 28, name: 'Indigo', rgb: '#4b0082' },
            { id: 29, name: 'Teal', rgb: '#20b2aa' },
            { id: 30, name: 'Lemon', rgb: '#fffacd' }
        ];
    } else {
        // 优先使用英文名称字段
        result = colors.map(c => ({
            ...c,
            name: c.name_en || c.en_name || c.english_name || c.name
        }));
    }

    cachedColors = result;
    colorsCacheTime = now;
    return result;
}

async function getPartInfo(partNum) {
    const parts = await fetchJSONFile('parts.json');
    if (!parts) return null;
    return parts.find(p => p.part_num === partNum);
}

async function getPartSuggestions(query) {
    const parts = await fetchJSONFile('parts.json');
    if (!parts) return [];
    
    const q = query.toLowerCase().trim();
    return parts
        .filter(p => 
            p.part_num.toLowerCase().includes(q) || 
            p.name.toLowerCase().replace(/\s*x\s*/g, 'x').includes(q.replace(/\s*x\s*/g, 'x'))
        )
        .slice(0, 20);
}

async function getRepositories() {
    try {
        return await supabaseRequest('repositories', {
            select: 'id,name',
            order: 'id'
        });
    } catch (error) {
        console.error('获取仓库列表失败:', error.message);
        return [];
    }
}

async function getRepositoryById(repoId) {
    try {
        const results = await supabaseRequest('repositories', {
            filters: { id: repoId }
        });
        return results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error('获取仓库信息失败:', error.message);
        return null;
    }
}

async function createRepository(name, id = null) {
    try {
        const body = { name: name || '新仓库' };
        if (id !== null) {
            body.id = id;
        }
        const results = await supabaseRequest('repositories', {
            method: 'POST',
            body: body
        });
        if (results && results.length > 0) {
            return results[0];
        }
        throw new Error('创建仓库失败');
    } catch (error) {
        console.error('创建仓库失败:', error.message);
        throw error;
    }
}

async function updateRepository(repoId, data) {
    try {
        const results = await supabaseRequest('repositories', {
            method: 'PATCH',
            filters: { id: repoId },
            body: data
        });
        return true;
    } catch (error) {
        console.error('更新仓库失败:', error.message);
        return false;
    }
}

async function deleteRepository(repoId) {
    try {
        await supabaseRequest('repositories', {
            method: 'DELETE',
            filters: { id: repoId }
        });
        return true;
    } catch (error) {
        console.error('删除仓库失败:', error.message);
        return false;
    }
}

async function getBoxes(repoId) {
    try {
        const options = {
            select: 'id,box_number,name,repository_id',
            order: 'box_number'
        };
        if (repoId != null) {
            options.filters = { repository_id: repoId };
        }
        return await supabaseRequest('boxes', options);
    } catch (error) {
        console.error('获取盒子列表失败:', error.message);
        return [];
    }
}

async function getBoxById(boxId) {
    try {
        const results = await supabaseRequest('boxes', {
            filters: { id: boxId }
        });
        return results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error('获取盒子信息失败:', error.message);
        return null;
    }
}

async function createBox(repositoryId, boxNumber, name) {
    try {
        const results = await supabaseRequest('boxes', {
            method: 'POST',
            body: {
                repository_id: repositoryId,
                box_number: boxNumber,
                name: name || '新盒子'
            }
        });
        if (results && results.length > 0) {
            return results[0];
        }
        return null;
    } catch (error) {
        console.error('创建盒子失败:', error.message);
        return null;
    }
}

async function updateBox(boxId, data) {
    try {
        await supabaseRequest('boxes', {
            method: 'PATCH',
            filters: { id: boxId },
            body: data
        });
        return true;
    } catch (error) {
        console.error('更新盒子失败:', error.message);
        return false;
    }
}

async function deleteBox(boxId) {
    try {
        await supabaseRequest('boxes', {
            method: 'DELETE',
            filters: { id: boxId }
        });
        return true;
    } catch (error) {
        console.error('删除盒子失败:', error.message);
        return false;
    }
}

async function getParts(boxId) {
    try {
        const options = {
            select: 'id,part_num,name,color_id,is_new,quantity,box_id',
            order: 'part_num'
        };
        if (boxId != null) {
            options.filters = { box_id: boxId };
        }
        return await supabaseRequest('parts', options);
    } catch (error) {
        console.error('获取零件列表失败:', error.message);
        return [];
    }
}

async function getPartById(partId) {
    try {
        const results = await supabaseRequest('parts', {
            filters: { id: partId }
        });
        return results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error('获取零件信息失败:', error.message);
        return null;
    }
}

async function createPart(data) {
    try {
        const results = await supabaseRequest('parts', {
            method: 'POST',
            body: data
        });
        if (results && results.length > 0) {
            return results[0];
        }
        return null;
    } catch (error) {
        console.error('创建零件失败:', error.message);
        return null;
    }
}

async function updatePart(partId, data) {
    try {
        await supabaseRequest('parts', {
            method: 'PATCH',
            filters: { id: partId },
            body: data
        });
        return true;
    } catch (error) {
        console.error('更新零件失败:', error.message);
        return false;
    }
}

async function deletePart(partId) {
    try {
        const result = await supabaseRequest('parts', {
            method: 'DELETE',
            filters: { id: partId },
            select: 'id'
        });
        console.log('删除零件结果:', result);
        return true;
    } catch (error) {
        console.error('删除零件失败:', error.message);
        return false;
    }
}

// 批量转移某盒子内的全部零件（例如删除盒子时整体转入临时盒子）
async function updatePartsByBox(boxId, data) {
    try {
        await supabaseRequest('parts', {
            method: 'PATCH',
            filters: { box_id: boxId },
            body: data
        });
        return true;
    } catch (error) {
        console.error('批量更新零件失败:', error.message);
        return false;
    }
}

async function searchParts(params) {
    try {
        const { part_num, name, color_id, is_new, repo_ids } = params;
        const filters = {};
        
        if (color_id !== undefined && color_id !== null && color_id !== '') {
            filters.color_id = color_id;
        }
        if (is_new !== undefined && is_new !== null && is_new !== '') {
            filters.is_new = is_new;
        }
        
        let results;
        if (Object.keys(filters).length > 0) {
            results = await supabaseRequest('parts', {
                select: 'id,part_num,name,color_id,is_new,quantity,box_id',
                filters: filters,
                order: 'part_num'
            });
        } else {
            results = await supabaseRequest('parts', {
                select: 'id,part_num,name,color_id,is_new,quantity,box_id',
                order: 'part_num'
            });
        }
        
        let filtered = results || [];
        
        if (part_num) {
            const q = part_num.toLowerCase();
            filtered = filtered.filter(p => p.part_num.toLowerCase().includes(q));
        }
        if (name) {
            const q = name.toLowerCase().replace(/\s*x\s*/g, 'x');
            const level = getSearchNamePrecisionLevel();
            const threshold = 1 - level * 0.1;
            filtered = filtered.filter(p => {
                const pName = p.name.toLowerCase().replace(/\s*x\s*/g, 'x');
                return nameMatchingScore(pName, q) >= threshold;
            });
        }

        // 按仓库（repository）过滤：零件通过 box 归属到仓库
        if (repo_ids && repo_ids.length > 0) {
            const boxIdSet = new Set();
            for (const repoId of repo_ids) {
                const boxes = await getBoxes(repoId);
                if (boxes) {
                    boxes.forEach(b => boxIdSet.add(b.id));
                }
            }
            filtered = filtered.filter(p => p.box_id != null && boxIdSet.has(p.box_id));
        }
        
        return filtered;
    } catch (error) {
        console.error('搜索零件失败:', error.message);
        return [];
    }
}

// 获取名称搜索精度等级（0-5，默认0=精准100%）
function getSearchNamePrecisionLevel() {
    const v = parseInt(localStorage.getItem('searchNamePrecision'), 10);
    return (v >= 0 && v <= 5) ? v : 0;
}

// 计算两个字符串的编辑距离（Levenshtein）
function levenshteinDist(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = [];
    for (let i = 0; i <= m; i++) dp[i] = [i];
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[m][n];
}

// 名称匹配得分（0-1，越接近1越精确）。
// 名称包含查询串时返回1；其余情况取名称中与查询等长的滑动窗口的最小编辑距离相似度。
function nameMatchingScore(name, query) {
    if (!query) return 1;
    if (name.includes(query)) return 1;
    const qlen = query.length;
    let minDist = Infinity;
    for (let i = 0; i + qlen <= name.length; i++) {
        const d = levenshteinDist(name.substring(i, i + qlen), query);
        if (d < minDist) minDist = d;
        if (minDist === 0) break;
    }
    if (name.length < qlen) {
        const d = levenshteinDist(name, query);
        if (d < minDist) minDist = d;
    }
    if (minDist === Infinity) minDist = qlen;
    return Math.max(0, 1 - minDist / qlen);
}

async function advancedSearchParts(params) {
    return await searchParts(params);
}

async function batchCreateParts(partsData) {
    try {
        const results = await supabaseRequest('parts', {
            method: 'POST',
            body: partsData
        });
        if (results) {
            return { success: true, count: results.length, errors: [] };
        }
        return { success: false, count: 0, errors: [{ part_num: '批量导入', error: '批量导入失败' }] };
    } catch (error) {
        console.error('批量导入失败:', error.message);
        return { success: false, count: 0, errors: [{ part_num: '批量导入', error: error.message }] };
    }
}

async function getStats() {
    try {
        const [repos, boxes, parts] = await Promise.all([
            supabaseRequest('repositories', { select: 'id' }),
            supabaseRequest('boxes', { select: 'id' }),
            supabaseRequest('parts', { select: 'id,quantity' })
        ]);
        
        const totalQty = (parts || []).reduce((sum, p) => sum + (p.quantity || 0), 0);
        
        return {
            repositories: repos ? repos.length : 0,
            boxes: boxes ? boxes.length : 0,
            parts: parts ? parts.length : 0,
            total_quantity: totalQty
        };
    } catch (error) {
        console.error('获取统计信息失败:', error.message);
        return { repositories: 0, boxes: 0, parts: 0, total_quantity: 0 };
    }
}

// 检查 Parts-json 仓库是否存在 rb_database.json
async function checkRBDatabaseOnCloud() {
    try {
        const response = await fetch(`${GITEE_JSON_API_URL}/${RB_DATABASE_FILE}?ref=master`);
        if (response.status === 404) {
            return { exists: false, message: 'RB数据库不存在于Parts-json仓库' };
        }
        if (response.ok) {
            const data = await response.json();
            return { exists: true, sha: data.sha, message: 'RB数据库存在于Parts-json仓库' };
        }
        throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        console.error('检查Parts-json仓库RB数据库失败:', error);
        return { exists: false, message: '检查失败: ' + error.message };
    }
}

// 从 Parts-json 仓库下载 rb_database.json
async function downloadRBDatabaseFromCloud() {
    try {
        const response = await fetch(`${GITEE_JSON_API_URL}/${RB_DATABASE_FILE}?ref=master`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (data.content) {
            const jsonText = decodeURIComponent(escape(atob(data.content)));
            return JSON.parse(jsonText);
        }
        return null;
    } catch (error) {
        console.error('从Parts-json下载RB数据库失败:', error);
        return null;
    }
}

// 将 rb_database.json 上传到 Parts-json 仓库（需要 token）
async function uploadRBDatabaseToCloud(jsonData, token = '') {
    try {
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(jsonData))));
        const apiUrl = `${GITEE_JSON_API_URL}/${RB_DATABASE_FILE}`;
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `token ${token}`
            },
            body: JSON.stringify({
                message: '更新RB数据库',
                content: content,
                branch: 'master'
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        return { success: true, sha: result.sha };
    } catch (error) {
        console.error('上传RB数据库到Parts-json失败:', error);
        return { success: false, error: error.message };
    }
}

// 更新已存在的 rb_database.json（需要 token 和 sha）
async function updateRBDatabaseOnCloud(jsonData, sha, token = '') {
    try {
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(jsonData))));
        const apiUrl = `${GITEE_JSON_API_URL}/${RB_DATABASE_FILE}`;
        
        const response = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `token ${token}`
            },
            body: JSON.stringify({
                message: '更新RB数据库',
                content: content,
                sha: sha,
                branch: 'master'
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        return { success: true, sha: result.sha };
    } catch (error) {
        console.error('更新Parts-json上的RB数据库失败:', error);
        return { success: false, error: error.message };
    }
}

// 将单个零件重量记录添加到 Gitee 的 weights.json 文件中。
// 如果文件已存在，追加/更新该零件条目；如果文件不存在，创建新文件。
// 返回 { success: true } 或 { success: false, error }
async function addWeightToGiteeJSON(partNum, weight) {
    const token = localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
    if (!token) {
        return { success: false, error: '缺少 Gitee Token' };
    }

    const fileName = 'weights.json';
    const apiUrl = `${GITEE_JSON_API_URL.replace('/Parts-json/contents', '/parts-rb/contents')}/${fileName}`;

    try {
        // 1. 获取现有文件内容及 SHA
        const checkResp = await fetch(`${apiUrl}?ref=main`, {
            headers: { 'Authorization': `token ${token}` }
        });

        let weights = {};
        let sha = null;

        if (checkResp.ok) {
            const existing = await checkResp.json();
            sha = existing.sha;
            // 解码现有内容
            const decoded = decodeURIComponent(escape(atob(existing.content)));
            try {
                weights = JSON.parse(decoded);
            } catch (e) {
                console.warn('解析现有 weights.json 失败，将创建新文件:', e.message);
            }
        }

        // 2. 添加/更新该零件记录
        const cleanNum = String(partNum).replace(/[^a-zA-Z0-9]/g, '');
        weights[cleanNum] = weight;

        // 3. 编码并推送
        const updatedJson = JSON.stringify(weights, null, 2);
        const base64Data = btoa(unescape(encodeURIComponent(updatedJson)));

        const body = {
            message: `feat: 添加零件重量 ${cleanNum}=${weight}g [skip ci]`,
            content: base64Data,
            branch: 'main'
        };
        if (sha) {
            body.sha = sha;
        }

        await giteeRequestWithRetry(() => fetch(apiUrl, {
            method: sha ? 'PUT' : 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `token ${token}`
            },
            body: JSON.stringify(body)
        }));

        return { success: true };
    } catch (e) {
        console.error('添加重量到 Gitee weights.json 失败:', e.message);
        return { success: false, error: e.message };
    }
}

// 从 Bricklink 商品页 HTML 中提取重量（克）
function extractWeightFromHtml(html) {
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

// 查询单个零件重量（克）。
// 策略（按用户指定顺序）：
// 1. 优先查离线 RB 数据库的 rb_weights（IndexedDB，来自 weights.json，离线可用）
// 2. 其次查 Supabase part_weights 缓存（零后端）
// 3. 缓存未命中，通过 CORS 代理从浏览器直接抓取 Bricklink 商品页（手机 IP 可避开反爬）
// 4. 仅本机开发环境调 FastAPI 抓取（本机 IP 也可避开反爬）
// 5. 全部失败，返回 weight=null，由调用方（称重计算弹窗）回退到手工输入。
// 返回 { part_number, weight, source } 或 { part_number, weight: null, error }
async function fetchBricklinkPartWeight(partNumber) {
    const cleanNum = String(partNumber).replace(/[^a-zA-Z0-9]/g, '');
    if (!cleanNum) {
        return { part_number: '', weight: null, error: '零件型号无效' };
    }

    // 1. 优先查离线 RB 数据库（rb_weights store）
    try {
        if (typeof getPartWeightByNum === 'function') {
            const offlineWeight = await getPartWeightByNum(cleanNum);
            if (offlineWeight !== null && offlineWeight > 0) {
                return { part_number: cleanNum, weight: offlineWeight, source: 'offline' };
            }
        }
    } catch (e) {
        console.warn('离线重量查询失败:', e.message);
    }

    // 2. 查 Supabase part_weights 缓存（前端直连，零后端）
    try {
        const cached = await supabaseRequest('part_weights', {
            select: 'weight',
            filters: { part_num: cleanNum }
        });
        if (cached && cached.length > 0 && cached[0].weight != null) {
            return { part_number: cleanNum, weight: cached[0].weight, source: 'supabase' };
        }
    } catch (e) {
        console.warn('重量缓存查询失败:', e.message);
    }

    // 3. 缓存未命中，通过 CORS 代理从浏览器直接抓取 Bricklink（手机 IP 可避开反爬，不限 localhost）
    try {
        const blUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(cleanNum)}`;
        const proxyUrl = `${CORS_PROXY}${encodeURIComponent(blUrl)}`;
        const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
            const html = await resp.text();
            const weight = extractWeightFromHtml(html);
            if (weight !== null && weight > 0) {
                return { part_number: cleanNum, weight, source: 'browser' };
            }
        }
    } catch (e) {
        console.warn('CORS 代理 Bricklink 抓取失败:', e.message);
    }

    // 4. 仅本机开发环境调 FastAPI 抓取（本机 IP 也可避开反爬）
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        try {
            const response = await fetch(`${BACKEND_URL}/api/parts/weight?part_number=${encodeURIComponent(cleanNum)}`);
            if (response.ok) {
                const data = await response.json();
                if (data && data.weight != null && data.weight > 0) {
                    return data;
                }
            }
        } catch (e) {
            console.warn('FastAPI 重量抓取失败:', e.message);
        }
    }

    // 5. 全部失败：返回空，调用方回退到手工输入
    return { part_number: cleanNum, weight: null, error: '暂无重量数据，可手动输入' };
}

// 重置 Supabase 自增序列（通过 RPC 函数，无需 CloudBase 后端）
async function resetSequencesViaSupabase() {
    try {
        const response = await fetch(`${API_BASE}/rpc/reset_sequences`, {
            method: 'POST',
            headers: supabaseHeaders(),
            body: JSON.stringify({})
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('重置序列失败:', error.message);
        throw error;
    }
}

// ===== Parts-img 仓库图片上传/删除 =====
const GITEE_IMG_API_URL = 'https://gitee.com/api/v5/repos/legoping/Parts-img/contents';
const GITEE_IMG_BRANCH = 'main';

// 上传零件图片到 Gitee Parts-img 仓库（POST 新建 / PUT 更新）
async function uploadPartImageToGitee(partNum, colorId, imageBase64) {
    try {
        const token = localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
        if (!token) {
            throw new Error('缺少 Gitee Token，无法上传');
        }
        // 兼容 dataURL 或纯 base64
        const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
        const filePath = `parts/${partNum}_${colorId}.jpg`;
        const apiUrl = `${GITEE_IMG_API_URL}/${filePath}`;

        // 检查文件是否已存在，获取 sha 用于更新
        let checkResp, existing, hasExisting = false;
        try {
            checkResp = await fetch(`${apiUrl}?ref=${GITEE_IMG_BRANCH}`, {
                headers: { 'Authorization': `token ${token}` }
            });
            if (checkResp.ok) {
                const data = await checkResp.json();
                existing = data;
                // Gitee 返回 [] 空数组或缺失 sha 时视为新文件
                hasExisting = !Array.isArray(data) && data && data.sha;
            }
        } catch (_) {
            // 检查失败时视为新文件
        }

        const body = {
            message: hasExisting ? `更新零件图片 ${partNum}_${colorId}` : `添加零件图片 ${partNum}_${colorId}`,
            content: base64Data,
            branch: GITEE_IMG_BRANCH
        };
        if (hasExisting) {
            body.sha = existing.sha;
        }

        const response = await fetch(apiUrl, {
            method: hasExisting ? 'PUT' : 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `token ${token}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        const result = await response.json();
        return { success: true, sha: result.sha };
    } catch (error) {
        console.error('上传零件图片到Parts-img失败:', error);
        return { success: false, error: error.message };
    }
}

// 从 Gitee Parts-img 仓库删除零件图片
async function deletePartImageFromGitee(partNum, colorId) {
    try {
        const token = localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
        if (!token) {
            throw new Error('缺少 Gitee Token，无法删除');
        }
        const filePath = `parts/${partNum}_${colorId}.jpg`;
        const apiUrl = `${GITEE_IMG_API_URL}/${filePath}`;

        // 先获取 sha（删除必须携带 sha）
        const checkResp = await fetch(`${apiUrl}?ref=${GITEE_IMG_BRANCH}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        if (!checkResp.ok) {
            return { success: false, error: '文件不存在，无需删除' };
        }
        const existing = await checkResp.json();

        const response = await fetch(apiUrl, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `token ${token}`
            },
            body: JSON.stringify({
                message: `删除零件图片 ${partNum}_${colorId}`,
                sha: existing.sha,
                branch: GITEE_IMG_BRANCH
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return { success: true };
    } catch (error) {
        console.error('删除零件图片失败:', error);
        return { success: false, error: error.message };
    }
}