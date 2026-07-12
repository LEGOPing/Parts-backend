const CLOUDBASE_ENV = 'legopart-d3gyvl7hw36084032';
const CLOUDBASE_REGION = 'ap-shanghai';
const CLOUDBASE_APPID = '1450790322';

const GITEE_JSON_URL = 'https://gitee.com/LEGOPing/LEGOPART-JSON/raw/master/';
const GITEE_IMG_URL = 'https://gitee.com/LEGOPing/LEGOPART-IMG/raw/master/';

let cloudbaseInitialized = false;

async function initCloudbase() {
    if (cloudbaseInitialized) return;
    
    try {
        if (!window.cloudbase) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/@cloudbase/js-sdk@latest/dist/cloudbase.full.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        
        const app = window.cloudbase.init({
            env: CLOUDBASE_ENV,
            region: CLOUDBASE_REGION
        });
        
        await app.auth({ persistence: 'local' }).signInAnonymously();
        cloudbaseInitialized = true;
        return app;
    } catch (error) {
        console.error('CloudBase初始化失败:', error);
        return null;
    }
}

async function getDatabase() {
    const app = await initCloudbase();
    if (!app) return null;
    return app.database();
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
    const colors = await fetchJSONFile('colors.json');
    if (!colors) {
        const defaultColors = {
            1: '黑色', 2: '深灰色', 3: '浅灰色', 4: '白色',
            5: '红色', 6: '橙色', 7: '黄色', 8: '黄绿色',
            9: '绿色', 10: '深蓝色', 11: '蓝色', 12: '亮蓝色',
            13: '紫色', 14: '深粉色', 15: '粉色', 16: '棕色'
        };
        return defaultColors[colorId] || '未知颜色';
    }
    const color = colors.find(c => c.id === colorId);
    return color ? color.name : '未知颜色';
}

async function getPartInfo(partNum) {
    const parts = await fetchJSONFile('parts.json');
    if (!parts) return null;
    return parts.find(p => p.part_num === partNum);
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