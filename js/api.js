const API_BASE_URL = 'https://parts-backend-282911-9-1450790322.sh.run.tcloudbase.com/api';

const GITEE_JSON_URL = 'https://gitee.com/legoping/Parts-json/raw/master/';
const GITEE_IMG_URL = 'https://gitee.com/legoping/Parts-img/raw/main/';

let cachedColors = null;
let colorsCacheTime = 0;
const CACHE_EXPIRY = 3600000;

let cachedParts = null;
let partsCacheTime = 0;

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
    try {
        const response = await fetch(`${API_BASE_URL}/repositories/`);
        return await response.json();
    } catch (error) {
        console.error('获取仓库列表失败:', error.message);
        return [];
    }
}

async function getRepositoryById(repoId) {
    try {
        const response = await fetch(`${API_BASE_URL}/repositories/${repoId}`);
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('获取仓库信息失败:', error.message);
        return null;
    }
}

async function createRepository(name) {
    try {
        const response = await fetch(`${API_BASE_URL}/repositories/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: name || '新仓库' })
        });
        if (response.ok) {
            return await response.json();
        }
        throw new Error('创建仓库失败');
    } catch (error) {
        console.error('创建仓库失败:', error.message);
        throw error;
    }
}

async function updateRepository(repoId, data) {
    try {
        const response = await fetch(`${API_BASE_URL}/repositories/${repoId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return response.ok;
    } catch (error) {
        console.error('更新仓库失败:', error.message);
        return false;
    }
}

async function deleteRepository(repoId) {
    try {
        const response = await fetch(`${API_BASE_URL}/repositories/${repoId}`, {
            method: 'DELETE'
        });
        return response.ok;
    } catch (error) {
        console.error('删除仓库失败:', error.message);
        return false;
    }
}

async function getBoxes(repoId) {
    try {
        const url = repoId ? `${API_BASE_URL}/boxes/?repository_id=${repoId}` : `${API_BASE_URL}/boxes/`;
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error('获取盒子列表失败:', error.message);
        return [];
    }
}

async function getBoxById(boxId) {
    try {
        const response = await fetch(`${API_BASE_URL}/boxes/${boxId}`);
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('获取盒子信息失败:', error.message);
        return null;
    }
}

async function createBox(repositoryId, boxNumber, name) {
    try {
        const response = await fetch(`${API_BASE_URL}/boxes/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                repository_id: repositoryId,
                box_number: boxNumber,
                name: name || '新盒子'
            })
        });
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('创建盒子失败:', error.message);
        return null;
    }
}

async function updateBox(boxId, data) {
    try {
        const response = await fetch(`${API_BASE_URL}/boxes/${boxId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return response.ok;
    } catch (error) {
        console.error('更新盒子失败:', error.message);
        return false;
    }
}

async function deleteBox(boxId) {
    try {
        const response = await fetch(`${API_BASE_URL}/boxes/${boxId}`, {
            method: 'DELETE'
        });
        return response.ok;
    } catch (error) {
        console.error('删除盒子失败:', error.message);
        return false;
    }
}

async function getParts(boxId) {
    try {
        const url = boxId ? `${API_BASE_URL}/parts/?box_id=${boxId}` : `${API_BASE_URL}/parts/`;
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error('获取零件列表失败:', error.message);
        return [];
    }
}

async function getPartById(partId) {
    try {
        const response = await fetch(`${API_BASE_URL}/parts/${partId}`);
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('获取零件信息失败:', error.message);
        return null;
    }
}

async function createPart(data) {
    try {
        const response = await fetch(`${API_BASE_URL}/parts/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('创建零件失败:', error.message);
        return null;
    }
}

async function updatePart(partId, data) {
    try {
        const response = await fetch(`${API_BASE_URL}/parts/${partId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return response.ok;
    } catch (error) {
        console.error('更新零件失败:', error.message);
        return false;
    }
}

async function deletePart(partId) {
    try {
        const response = await fetch(`${API_BASE_URL}/parts/${partId}`, {
            method: 'DELETE'
        });
        return response.ok;
    } catch (error) {
        console.error('删除零件失败:', error.message);
        return false;
    }
}

async function searchParts(params) {
    try {
        const url = new URL(`${API_BASE_URL}/search/`);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, value);
            }
        });
        const response = await fetch(url.toString());
        return await response.json();
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
        const response = await fetch(`${API_BASE_URL}/parts/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(partsData)
        });
        if (response.ok) {
            const results = await response.json();
            return { success: true, count: results.length, errors: [] };
        }
        return { success: false, count: 0, errors: [{ part_num: '批量导入', error: '批量导入失败' }] };
    } catch (error) {
        console.error('批量导入失败:', error.message);
        return { success: false, count: 0, errors: [{ part_num: '批量导入', error: error.message }] };
    }
}