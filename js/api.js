const CLOUDBASE_ENV = 'legopart-d3gyvl7hw36084032';
const CLOUDBASE_REGION = 'ap-shanghai';
const CLOUDBASE_APPID = '1450790322';

const CLOUD_FUNCTIONS_URL = `https://${CLOUDBASE_ENV}-service.${CLOUDBASE_REGION}.tcloudbaseapi.com/`;

const GITEE_JSON_URL = 'https://gitee.com/legoping/Parts-json/raw/master/';
const GITEE_IMG_URL = 'https://gitee.com/legoping/Parts-img/raw/main/';

let cachedColors = null;
let colorsCacheTime = 0;
const CACHE_EXPIRY = 3600000;

let cachedParts = null;
let partsCacheTime = 0;

async function callCloudFunction(functionName, data = {}) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${CLOUD_FUNCTIONS_URL}${functionName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.body && typeof result.body === 'string') {
            try {
                return JSON.parse(result.body);
            } catch (e) {
                return result;
            }
        }
        
        if (result.data && result.success !== undefined) {
            return result;
        }
        
        return result;
    } catch (error) {
        console.error(`调用云函数 ${functionName} 失败:`, error);
        return { success: false, error: error.message };
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
    const result = await callCloudFunction('getRepositories');
    if (result.success) {
        return result.data;
    }
    console.error('获取仓库列表失败:', result.error);
    return [];
}

async function getRepositoryById(repoId) {
    const repos = await getRepositories();
    return repos.find(r => r.id === repoId) || null;
}

async function createRepository(name) {
    const result = await callCloudFunction('createRepository', { name: name || '新仓库' });
    if (result.success) {
        return result.data;
    }
    console.error('创建仓库失败:', result.error);
    return null;
}

async function updateRepository(repoId, data) {
    const result = await callCloudFunction('updateRepository', { id: repoId, ...data });
    return result.success;
}

async function deleteRepository(repoId) {
    const result = await callCloudFunction('deleteRepository', { id: repoId });
    return result.success;
}

async function getBoxes(repoId) {
    const result = await callCloudFunction('getBoxes', { repository_id: repoId });
    if (result.success) {
        return result.data;
    }
    console.error('获取盒子列表失败:', result.error);
    return [];
}

async function getBoxById(boxId) {
    const result = await callCloudFunction('getBoxById', { id: boxId });
    if (result.success) {
        return result.data;
    }
    return null;
}

async function createBox(repositoryId, boxNumber, name) {
    const result = await callCloudFunction('createBox', {
        repository_id: repositoryId,
        box_number: boxNumber,
        name: name || '新盒子'
    });
    if (result.success) {
        return result.data;
    }
    console.error('创建盒子失败:', result.error);
    return null;
}

async function updateBox(boxId, data) {
    const result = await callCloudFunction('updateBox', { id: boxId, ...data });
    return result.success;
}

async function deleteBox(boxId) {
    const result = await callCloudFunction('deleteBox', { id: boxId });
    return result.success;
}

async function getParts(boxId) {
    const result = await callCloudFunction('getParts', { box_id: boxId });
    if (result.success) {
        return result.data;
    }
    console.error('获取零件列表失败:', result.error);
    return [];
}

async function getPartById(partId) {
    const result = await callCloudFunction('getPartById', { id: partId });
    if (result.success) {
        return result.data;
    }
    return null;
}

async function createPart(data) {
    const result = await callCloudFunction('createPart', data);
    if (result.success) {
        return result.data;
    }
    console.error('创建零件失败:', result.error);
    return null;
}

async function updatePart(partId, data) {
    const result = await callCloudFunction('updatePart', { id: partId, ...data });
    return result.success;
}

async function deletePart(partId) {
    const result = await callCloudFunction('deletePart', { id: partId });
    return result.success;
}

async function searchParts(query) {
    const result = await callCloudFunction('searchParts', { query });
    if (result.success) {
        return result.data;
    }
    console.error('搜索零件失败:', result.error);
    return [];
}

async function advancedSearchParts(params) {
    const result = await callCloudFunction('searchParts', params);
    if (result.success) {
        return result.data;
    }
    console.error('高级搜索零件失败:', result.error);
    return [];
}

async function batchCreateParts(partsData) {
    const result = await callCloudFunction('importData', { parts: partsData });
    if (result.success) {
        return { success: true, count: result.data.count || partsData.length, errors: [] };
    }
    return { success: false, count: 0, errors: [{ part_num: '批量导入', error: result.error }] };
}
