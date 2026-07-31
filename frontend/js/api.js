const SUPABASE_URL = 'https://tfxydlkpxkdpxyoqrkez.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EPZpWFRObklmwpfXerINvQ_S-OeeIM_';

const API_BASE = `${SUPABASE_URL}/rest/v1`;

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
    try {
        const url = `${API_BASE}/sql`;
        const response = await fetch(url, {
            method: 'POST',
            headers: supabaseHeaders(),
            body: JSON.stringify({ query })
        });
        if (!response.ok) {
            throw new Error(`SQL执行失败: HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('SQL执行失败:', error.message);
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
            { id: 1, name: '黑色', rgb: '#1a1a1a' },
            { id: 2, name: '深灰色', rgb: '#4a4a4a' },
            { id: 3, name: '浅灰色', rgb: '#9a9a9a' },
            { id: 4, name: '白色', rgb: '#ffffff' },
            { id: 5, name: '红色', rgb: '#c41e3a' },
            { id: 6, name: '橙色', rgb: '#ff7f00' },
            { id: 7, name: '黄色', rgb: '#ffd700' },
            { id: 8, name: '黄绿色', rgb: '#9acd32' },
            { id: 9, name: '绿色', rgb: '#228b22' },
            { id: 10, name: '深蓝色', rgb: '#191970' },
            { id: 11, name: '蓝色', rgb: '#0066cc' },
            { id: 12, name: '亮蓝色', rgb: '#00bfff' },
            { id: 13, name: '紫色', rgb: '#8b008b' },
            { id: 14, name: '深粉色', rgb: '#ff1493' },
            { id: 15, name: '粉色', rgb: '#ff69b4' },
            { id: 16, name: '棕色', rgb: '#8b4513' },
            { id: 17, name: '米色', rgb: '#f5f5dc' },
            { id: 18, name: '金色', rgb: '#ffd700' },
            { id: 19, name: '银色', rgb: '#c0c0c0' },
            { id: 20, name: '透明', rgb: '#e0e0e0' },
            { id: 21, name: '深蓝色', rgb: '#000080' },
            { id: 22, name: '浅蓝色', rgb: '#87ceeb' },
            { id: 23, name: '深绿色', rgb: '#006400' },
            { id: 24, name: '浅绿色', rgb: '#98fb98' },
            { id: 25, name: '深红色', rgb: '#8b0000' },
            { id: 26, name: '珊瑚色', rgb: '#ff7f50' },
            { id: 27, name: '紫罗兰', rgb: '#ee82ee' },
            { id: 28, name: '靛蓝色', rgb: '#4b0082' },
            { id: 29, name: '青绿色', rgb: '#20b2aa' },
            { id: 30, name: '柠檬色', rgb: '#fffacd' }
        ];
    } else {
        result = colors;
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

async function createRepository(name) {
    try {
        const results = await supabaseRequest('repositories', {
            method: 'POST',
            body: { name: name || '新仓库' }
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
        if (repoId) {
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
        if (boxId) {
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
        await supabaseRequest('parts', {
            method: 'DELETE',
            filters: { id: partId }
        });
        return true;
    } catch (error) {
        console.error('删除零件失败:', error.message);
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