const CLOUDBASE_ENV = 'legopart-d3gyvl7hw36084032';
const CLOUDBASE_REGION = 'ap-shanghai';
const CLOUDBASE_APPID = '1450790322';

const GITEE_JSON_URL = 'https://gitee.com/legoping/Parts-json/raw/master/';
const GITEE_IMG_URL = 'https://gitee.com/legoping/Parts-img/raw/master/';

let cloudbaseInitialized = false;
let cloudbaseApp = null;
let cloudbaseError = null;

let cachedColors = null;
let colorsCacheTime = 0;
const CACHE_EXPIRY = 3600000;

let cachedParts = null;
let partsCacheTime = 0;

function timeoutPromise(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`操作超时 (${ms}ms)`));
        }, ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

async function initCloudbase() {
    if (cloudbaseInitialized) return cloudbaseApp;
    if (cloudbaseError) return null;
    
    try {
        if (!window.cloudbase) {
            await timeoutPromise(new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/@cloudbase/js-sdk@latest/dist/cloudbase.full.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            }), 10000);
        }
        
        const app = window.cloudbase.init({
            env: CLOUDBASE_ENV,
            region: CLOUDBASE_REGION
        });
        
        await timeoutPromise(app.auth({ persistence: 'local' }).signInAnonymously(), 10000);
        cloudbaseInitialized = true;
        cloudbaseApp = app;
        return app;
    } catch (error) {
        console.error('CloudBase初始化失败:', error);
        cloudbaseError = error;
        return null;
    }
}

async function getDatabase() {
    const app = await initCloudbase();
    if (!app) {
        console.warn('CloudBase未初始化，返回null');
        return null;
    }
    try {
        return app.database();
    } catch (error) {
        console.error('获取数据库实例失败:', error);
        return null;
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
    const db = await getDatabase();
    if (!db) return [];
    
    try {
        const res = await db.collection('repositories').get();
        return res.data;
    } catch (error) {
        console.error('获取仓库列表失败:', error);
        return [];
    }
}

async function getRepositoryById(repoId) {
    const db = await getDatabase();
    if (!db) return null;
    
    try {
        const res = await db.collection('repositories').doc(repoId).get();
        return res.data[0];
    } catch (error) {
        console.error('获取仓库失败:', error);
        return null;
    }
}

async function createRepository(name) {
    const db = await getDatabase();
    if (!db) return null;
    
    try {
        const res = await db.collection('repositories').add({
            name: name || '新仓库',
            createdAt: new Date().toISOString()
        });
        return { id: res.id, name: name || '新仓库' };
    } catch (error) {
        console.error('创建仓库失败:', error);
        return null;
    }
}

async function updateRepository(repoId, data) {
    const db = await getDatabase();
    if (!db) return false;
    
    try {
        await db.collection('repositories').doc(repoId).update(data);
        return true;
    } catch (error) {
        console.error('更新仓库失败:', error);
        return false;
    }
}

async function deleteRepository(repoId) {
    const db = await getDatabase();
    if (!db) return false;
    
    try {
        await db.collection('repositories').doc(repoId).remove();
        return true;
    } catch (error) {
        console.error('删除仓库失败:', error);
        return false;
    }
}

async function getBoxes(repoId) {
    const db = await getDatabase();
    if (!db) return [];
    
    try {
        const res = await db.collection('boxes').where({
            repository_id: repoId
        }).get();
        return res.data;
    } catch (error) {
        console.error('获取盒子列表失败:', error);
        return [];
    }
}

async function getBoxById(boxId) {
    const db = await getDatabase();
    if (!db) return null;
    
    try {
        const res = await db.collection('boxes').doc(boxId).get();
        return res.data[0];
    } catch (error) {
        console.error('获取盒子失败:', error);
        return null;
    }
}

async function createBox(repositoryId, boxNumber, name) {
    const db = await getDatabase();
    if (!db) return null;
    
    try {
        const res = await db.collection('boxes').add({
            repository_id: repositoryId,
            box_number: boxNumber,
            name: name || '新盒子',
            createdAt: new Date().toISOString()
        });
        return { id: res.id, box_number: boxNumber, name: name || '新盒子', repository_id: repositoryId };
    } catch (error) {
        console.error('创建盒子失败:', error);
        return null;
    }
}

async function updateBox(boxId, data) {
    const db = await getDatabase();
    if (!db) return false;
    
    try {
        await db.collection('boxes').doc(boxId).update(data);
        return true;
    } catch (error) {
        console.error('更新盒子失败:', error);
        return false;
    }
}

async function deleteBox(boxId) {
    const db = await getDatabase();
    if (!db) return false;
    
    try {
        await db.collection('boxes').doc(boxId).remove();
        return true;
    } catch (error) {
        console.error('删除盒子失败:', error);
        return false;
    }
}

async function getParts(boxId) {
    const db = await getDatabase();
    if (!db) return [];
    
    try {
        const res = await db.collection('parts').where({
            box_id: boxId
        }).get();
        return res.data;
    } catch (error) {
        console.error('获取零件列表失败:', error);
        return [];
    }
}

async function getPartById(partId) {
    const db = await getDatabase();
    if (!db) return null;
    
    try {
        const res = await db.collection('parts').doc(partId).get();
        return res.data[0];
    } catch (error) {
        console.error('获取零件失败:', error);
        return null;
    }
}

async function createPart(data) {
    const db = await getDatabase();
    if (!db) return null;
    
    try {
        const res = await db.collection('parts').add({
            box_id: data.box_id,
            part_num: data.part_num,
            name: data.name,
            color_id: data.color_id,
            is_new: data.is_new || false,
            quantity: data.quantity || 1,
            createdAt: new Date().toISOString()
        });
        return { id: res.id, ...data };
    } catch (error) {
        console.error('创建零件失败:', error);
        return null;
    }
}

async function updatePart(partId, data) {
    const db = await getDatabase();
    if (!db) return false;
    
    try {
        await db.collection('parts').doc(partId).update(data);
        return true;
    } catch (error) {
        console.error('更新零件失败:', error);
        return false;
    }
}

async function deletePart(partId) {
    const db = await getDatabase();
    if (!db) return false;
    
    try {
        await db.collection('parts').doc(partId).remove();
        return true;
    } catch (error) {
        console.error('删除零件失败:', error);
        return false;
    }
}

async function searchParts(query) {
    const db = await getDatabase();
    if (!db) return [];
    
    try {
        const res = await db.collection('parts').where({
            part_num: db.RegExp({ regexp: query, options: 'i' })
        }).get();
        return res.data;
    } catch (error) {
        console.error('搜索零件失败:', error);
        return [];
    }
}

async function advancedSearchParts(params) {
    const db = await getDatabase();
    if (!db) return [];
    
    try {
        const whereConditions = {};
        
        if (params.partNum && params.partNum.trim()) {
            whereConditions.part_num = db.RegExp({ regexp: params.partNum.trim(), options: 'i' });
        }
        
        if (params.partName && params.partName.trim()) {
            whereConditions.name = db.RegExp({ regexp: params.partName.trim(), options: 'i' });
        }
        
        if (params.colorId && !isNaN(parseInt(params.colorId))) {
            whereConditions.color_id = parseInt(params.colorId);
        }
        
        if (params.isNew !== undefined && params.isNew !== null) {
            whereConditions.is_new = params.isNew;
        }
        
        const res = await db.collection('parts').where(whereConditions).get();
        return res.data;
    } catch (error) {
        console.error('高级搜索零件失败:', error);
        return [];
    }
}

async function batchCreateParts(partsData) {
    const db = await getDatabase();
    if (!db) return { success: false, count: 0, errors: [] };
    
    const errors = [];
    let successCount = 0;
    
    for (const partData of partsData) {
        try {
            await db.collection('parts').add({
                box_id: partData.box_id,
                part_num: partData.part_num,
                name: partData.name || partData.part_num,
                color_id: parseInt(partData.color_id) || 0,
                is_new: partData.is_new !== undefined ? partData.is_new : true,
                quantity: parseInt(partData.quantity) || 1,
                createdAt: new Date().toISOString()
            });
            successCount++;
        } catch (error) {
            errors.push({ part_num: partData.part_num, error: error.message });
        }
    }
    
    return { success: errors.length === 0, count: successCount, errors: errors };
}