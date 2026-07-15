const CLOUDBASE_ENV = 'legopart-d3gyvl7hw36084032';
const CLOUDBASE_REGION = 'ap-shanghai';

const GITEE_JSON_URL = 'https://gitee.com/legoping/Parts-json/raw/master/';
const GITEE_IMG_URL = 'https://gitee.com/legoping/Parts-img/raw/main/';

let cachedColors = null;
let colorsCacheTime = 0;
const CACHE_EXPIRY = 3600000;

let cachedParts = null;
let partsCacheTime = 0;

let cloudbaseApp = null;

async function initCloudBase() {
    if (cloudbaseApp) return cloudbaseApp;
    
    try {
        cloudbaseApp = cloudbase.init({
            env: CLOUDBASE_ENV,
            region: CLOUDBASE_REGION
        });
        
        try {
            await cloudbaseApp.auth({
                persistence: 'none'
            }).anonymousAuthProvider().signIn();
            console.log('CloudBase 初始化成功（已登录）');
        } catch (authError) {
            console.warn('匿名登录失败，尝试无认证模式:', authError.message);
        }
        
        return cloudbaseApp;
    } catch (error) {
        console.error('CloudBase 初始化失败:', error);
        return null;
    }
}

async function getDatabase() {
    const app = await initCloudBase();
    if (!app) {
        throw new Error('CloudBase 未初始化');
    }
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
        const db = await getDatabase();
        const res = await db.collection('repositories').orderBy('createdAt', 'desc').get();
        return res.data.map(item => ({
            id: item._id,
            name: item.name,
            createdAt: item.createdAt
        }));
    } catch (error) {
        console.error('获取仓库列表失败:', error);
        return [];
    }
}

async function getRepositoryById(repoId) {
    const repos = await getRepositories();
    return repos.find(r => r.id === repoId) || null;
}

async function createRepository(name) {
    try {
        const db = await getDatabase();
        const result = await db.collection('repositories').add({
            data: {
                name: name || '新仓库',
                createdAt: new Date().toISOString()
            }
        });
        return { id: result.id, name: name || '新仓库' };
    } catch (error) {
        console.error('创建仓库失败:', error);
        throw error;
    }
}

async function updateRepository(repoId, data) {
    try {
        const db = await getDatabase();
        await db.collection('repositories').doc(repoId).update({
            data: data
        });
        return true;
    } catch (error) {
        console.error('更新仓库失败:', error);
        return false;
    }
}

async function deleteRepository(repoId) {
    try {
        const db = await getDatabase();
        await db.collection('repositories').doc(repoId).remove();
        return true;
    } catch (error) {
        console.error('删除仓库失败:', error);
        return false;
    }
}

async function getBoxes(repoId) {
    try {
        const db = await getDatabase();
        const res = await db.collection('boxes').where({
            repository_id: repoId
        }).orderBy('box_number', 'asc').get();
        return res.data.map(item => ({
            id: item._id,
            box_number: item.box_number,
            name: item.name,
            repository_id: item.repository_id,
            createdAt: item.createdAt
        }));
    } catch (error) {
        console.error('获取盒子列表失败:', error);
        return [];
    }
}

async function getBoxById(boxId) {
    try {
        const db = await getDatabase();
        const res = await db.collection('boxes').doc(boxId).get();
        return res.data ? {
            id: res.data._id,
            box_number: res.data.box_number,
            name: res.data.name,
            repository_id: res.data.repository_id,
            createdAt: res.data.createdAt
        } : null;
    } catch (error) {
        console.error('获取盒子失败:', error);
        return null;
    }
}

async function createBox(repositoryId, boxNumber, name) {
    try {
        const db = await getDatabase();
        const result = await db.collection('boxes').add({
            data: {
                repository_id: repositoryId,
                box_number: boxNumber,
                name: name || '新盒子',
                createdAt: new Date().toISOString()
            }
        });
        return {
            id: result.id,
            box_number: boxNumber,
            name: name || '新盒子',
            repository_id: repositoryId
        };
    } catch (error) {
        console.error('创建盒子失败:', error);
        return null;
    }
}

async function updateBox(boxId, data) {
    try {
        const db = await getDatabase();
        await db.collection('boxes').doc(boxId).update({
            data: data
        });
        return true;
    } catch (error) {
        console.error('更新盒子失败:', error);
        return false;
    }
}

async function deleteBox(boxId) {
    try {
        const db = await getDatabase();
        await db.collection('boxes').doc(boxId).remove();
        return true;
    } catch (error) {
        console.error('删除盒子失败:', error);
        return false;
    }
}

async function getParts(boxId) {
    try {
        const db = await getDatabase();
        const res = await db.collection('parts').where({
            box_id: boxId
        }).orderBy('part_num', 'asc').get();
        return res.data.map(item => ({
            id: item._id,
            box_id: item.box_id,
            part_num: item.part_num,
            name: item.name,
            color_id: item.color_id,
            is_new: item.is_new,
            quantity: item.quantity,
            createdAt: item.createdAt
        }));
    } catch (error) {
        console.error('获取零件列表失败:', error);
        return [];
    }
}

async function getPartById(partId) {
    try {
        const db = await getDatabase();
        const res = await db.collection('parts').doc(partId).get();
        return res.data ? {
            id: res.data._id,
            box_id: res.data.box_id,
            part_num: res.data.part_num,
            name: res.data.name,
            color_id: res.data.color_id,
            is_new: res.data.is_new,
            quantity: res.data.quantity,
            createdAt: res.data.createdAt
        } : null;
    } catch (error) {
        console.error('获取零件失败:', error);
        return null;
    }
}

async function createPart(data) {
    try {
        const db = await getDatabase();
        const result = await db.collection('parts').add({
            data: {
                box_id: data.box_id,
                part_num: data.part_num,
                name: data.name,
                color_id: data.color_id,
                is_new: data.is_new !== undefined ? data.is_new : false,
                quantity: data.quantity !== undefined ? data.quantity : 1,
                createdAt: new Date().toISOString()
            }
        });
        return {
            id: result.id,
            box_id: data.box_id,
            part_num: data.part_num,
            name: data.name,
            color_id: data.color_id,
            is_new: data.is_new !== undefined ? data.is_new : false,
            quantity: data.quantity !== undefined ? data.quantity : 1
        };
    } catch (error) {
        console.error('创建零件失败:', error);
        return null;
    }
}

async function updatePart(partId, data) {
    try {
        const db = await getDatabase();
        await db.collection('parts').doc(partId).update({
            data: data
        });
        return true;
    } catch (error) {
        console.error('更新零件失败:', error);
        return false;
    }
}

async function deletePart(partId) {
    try {
        const db = await getDatabase();
        await db.collection('parts').doc(partId).remove();
        return true;
    } catch (error) {
        console.error('删除零件失败:', error);
        return false;
    }
}

async function searchParts(params) {
    try {
        const db = await getDatabase();
        let query = db.collection('parts');
        
        if (params.partNum) {
            query = query.where({
                part_num: db.RegExp({
                    regexp: params.partNum,
                    options: 'i'
                })
            });
        }
        
        if (params.partName) {
            query = query.where({
                name: db.RegExp({
                    regexp: params.partName,
                    options: 'i'
                })
            });
        }
        
        if (params.colorId) {
            query = query.where({
                color_id: parseInt(params.colorId)
            });
        }
        
        if (params.isNew !== undefined) {
            query = query.where({
                is_new: params.isNew
            });
        }
        
        const res = await query.orderBy('part_num', 'asc').get();
        return res.data.map(item => ({
            id: item._id,
            box_id: item.box_id,
            part_num: item.part_num,
            name: item.name,
            color_id: item.color_id,
            is_new: item.is_new,
            quantity: item.quantity,
            createdAt: item.createdAt
        }));
    } catch (error) {
        console.error('搜索零件失败:', error);
        return [];
    }
}

async function advancedSearchParts(params) {
    return await searchParts(params);
}

async function batchCreateParts(partsData) {
    try {
        const db = await getDatabase();
        let successCount = 0;
        const errors = [];
        
        for (const data of partsData) {
            try {
                await db.collection('parts').add({
                    data: {
                        box_id: data.box_id,
                        part_num: data.part_num,
                        name: data.name || data.part_num,
                        color_id: parseInt(data.color_id) || 1,
                        is_new: data.is_new !== undefined ? data.is_new : false,
                        quantity: parseInt(data.quantity) || 1,
                        createdAt: new Date().toISOString()
                    }
                });
                successCount++;
            } catch (e) {
                errors.push({ part_num: data.part_num, error: e.message });
            }
        }
        
        return { success: true, count: successCount, errors: errors };
    } catch (error) {
        console.error('批量导入失败:', error);
        return { success: false, count: 0, errors: [{ part_num: '批量导入', error: error.message }] };
    }
}