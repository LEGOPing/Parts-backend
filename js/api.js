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
            p.name.toLowerCase().includes(q)
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
        const { part_num, name, color_id, is_new } = params;
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
            const q = name.toLowerCase();
            filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
        }
        
        return filtered;
    } catch (error) {
        console.error('搜索零件失败:', error.message);
        return [];
    }
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

// 查询单个零件重量（克）。
// 策略（按用户指定顺序）：
// 1. 优先查离线 RB 数据库的 rb_weights（IndexedDB，来自 weights.json，离线可用）
// 2. 其次尝试 Bricklink：优先读 Supabase part_weights 缓存（零后端）；
//    缓存未命中时，仅本机开发环境调 FastAPI 抓 Bricklink（本机 IP 可避开反爬）并回写缓存；
// 3. 以上都失败/出错，返回 weight=null，由调用方（称重计算弹窗）回退到手工输入。
// 返回 { part_number, weight } 或 { part_number, weight: null, error }
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

    // 2. 尝试 Bricklink：先查 Supabase part_weights 缓存（前端直连，零后端）
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

    // 2.1 缓存未命中：仅本机开发环境调 FastAPI 抓取（本机 IP 避开 Bricklink 反爬）
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

    // 3. 全部失败：返回空，调用方回退到手工输入
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
        const checkResp = await fetch(`${apiUrl}?ref=${GITEE_IMG_BRANCH}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        const existing = checkResp.ok ? await checkResp.json() : null;

        const body = {
            message: existing ? `更新零件图片 ${partNum}_${colorId}` : `添加零件图片 ${partNum}_${colorId}`,
            content: base64Data,
            branch: GITEE_IMG_BRANCH
        };
        if (existing && existing.sha) {
            body.sha = existing.sha;
        }

        const response = await fetch(apiUrl, {
            method: existing ? 'PUT' : 'POST',
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