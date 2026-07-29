const RB_DB_NAME = 'RB_Database';
const RB_DB_VERSION = 1;

const RB_STORES = {
    COLORS: 'rb_colors',
    ELEMENTS: 'rb_elements',
    INVENTORY_PARTS: 'rb_inventory_parts',
    PART_CATEGORIES: 'rb_part_categories',
    PART_RELATIONSHIPS: 'rb_part_relationships',
    PARTS: 'rb_parts'
};

const RB_STORE_KEYS = {
    'rb_colors': 'colors',
    'rb_parts': 'parts',
    'rb_part_categories': 'part_categories',
    'rb_elements': 'elements',
    'rb_inventory_parts': 'inventory_parts',
    'rb_part_relationships': 'part_relationships'
};

let rbDbInstance = null;

function openRBDatabase() {
    return new Promise((resolve, reject) => {
        if (rbDbInstance) {
            resolve(rbDbInstance);
            return;
        }

        const request = indexedDB.open(RB_DB_NAME, RB_DB_VERSION);

        request.onerror = (event) => {
            reject(event.target.error);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(RB_STORES.COLORS)) {
                db.createObjectStore(RB_STORES.COLORS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(RB_STORES.ELEMENTS)) {
                db.createObjectStore(RB_STORES.ELEMENTS, { keyPath: 'element_id' });
            }
            if (!db.objectStoreNames.contains(RB_STORES.INVENTORY_PARTS)) {
                db.createObjectStore(RB_STORES.INVENTORY_PARTS, { autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(RB_STORES.PART_CATEGORIES)) {
                db.createObjectStore(RB_STORES.PART_CATEGORIES, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(RB_STORES.PART_RELATIONSHIPS)) {
                db.createObjectStore(RB_STORES.PART_RELATIONSHIPS, { autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(RB_STORES.PARTS)) {
                db.createObjectStore(RB_STORES.PARTS, { keyPath: 'part_num' });
            }
        };

        request.onsuccess = (event) => {
            rbDbInstance = event.target.result;
            resolve(rbDbInstance);
        };
    });
}

function clearStore(storeName) {
    return new Promise((resolve, reject) => {
        const db = rbDbInstance;
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

// 分批插入 - 避免大数据量导致浏览器崩溃
async function batchInsertChunks(storeName, data, chunkSize = 5000) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
        chunks.push(data.slice(i, i + chunkSize));
    }

    for (const chunk of chunks) {
        await new Promise((resolve, reject) => {
            const db = rbDbInstance;
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);

            chunk.forEach(item => {
                store.add(item);
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(event.target.error);
        });
    }
}

function getAll(storeName) {
    return new Promise((resolve, reject) => {
        const db = rbDbInstance;
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

function getByKey(storeName, key) {
    return new Promise((resolve, reject) => {
        const db = rbDbInstance;
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

function countRecords(storeName) {
    return new Promise((resolve, reject) => {
        const db = rbDbInstance;
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

// 导入RB数据（带分批处理）
async function importRBData(storeName, data, onProgress) {
    try {
        const db = await openRBDatabase();
        await clearStore(storeName);
        await batchInsertChunks(storeName, data);
        return true;
    } catch (error) {
        console.error(`导入 ${storeName} 数据失败:`, error);
        throw error;
    }
}

// 获取RB统计信息
async function getRBStats() {
    try {
        const db = await openRBDatabase();
        const stats = {};
        for (const [key, value] of Object.entries(RB_STORES)) {
            stats[key] = await countRecords(value);
        }
        return stats;
    } catch (error) {
        console.error('获取RB统计信息失败:', error);
        return null;
    }
}

// 查询功能 - 用于离线使用

// 根据 part_num 查询零件
async function getPartByNum(partNum) {
    try {
        const db = await openRBDatabase();
        return await getByKey(RB_STORES.PARTS, partNum);
    } catch (error) {
        console.error('查询零件失败:', error);
        return null;
    }
}

// 根据 part_num 查询颜色信息
async function getPartColors(partNum) {
    try {
        const db = await openRBDatabase();
        const allElements = await getAll(RB_STORES.ELEMENTS);
        return allElements.filter(e => e.part_num === partNum);
    } catch (error) {
        console.error('查询零件颜色失败:', error);
        return [];
    }
}

// 根据 part_num 查询库存
async function getInventoryByPart(partNum) {
    try {
        const db = await openRBDatabase();
        const allInventory = await getAll(RB_STORES.INVENTORY_PARTS);
        return allInventory.filter(i => i.part_num === partNum);
    } catch (error) {
        console.error('查询库存失败:', error);
        return [];
    }
}

// 根据 ID 查询颜色
async function getColorById(colorId) {
    try {
        const db = await openRBDatabase();
        return await getByKey(RB_STORES.COLORS, colorId);
    } catch (error) {
        console.error('查询颜色失败:', error);
        return null;
    }
}

// 根据 ID 查询类别
async function getCategoryById(categoryId) {
    try {
        const db = await openRBDatabase();
        return await getByKey(RB_STORES.PART_CATEGORIES, categoryId);
    } catch (error) {
        console.error('查询类别失败:', error);
        return null;
    }
}

// 搜索零件（支持按型号或名称搜索）
async function searchPartsInRB(query, limit = 20) {
    try {
        const db = await openRBDatabase();
        const allParts = await getAll(RB_STORES.PARTS);
        const q = query.toLowerCase().trim();
        
        return allParts
            .filter(p => 
                p.part_num.toLowerCase().includes(q) || 
                p.name.toLowerCase().includes(q)
            )
            .slice(0, limit);
    } catch (error) {
        console.error('搜索零件失败:', error);
        return [];
    }
}

// 获取零件关系
async function getPartRelationships(partNum) {
    try {
        const db = await openRBDatabase();
        const allRelations = await getAll(RB_STORES.PART_RELATIONSHIPS);
        return allRelations.filter(r => 
            r.child_part_num === partNum || r.parent_part_num === partNum
        );
    } catch (error) {
        console.error('查询零件关系失败:', error);
        return [];
    }
}

// 获取RB数据库状态
async function checkRBDatabase() {
    try {
        const db = await openRBDatabase();
        const objectStores = Array.from(db.objectStoreNames);
        const hasAllStores = Object.values(RB_STORES).every(s => objectStores.includes(s));
        
        if (!hasAllStores) {
            return { exists: false, message: 'RB数据库未初始化' };
        }
        
        const stats = await getRBStats();
        const totalRecords = Object.values(stats).reduce((sum, v) => sum + v, 0);
        
        return { 
            exists: true, 
            totalRecords,
            stats,
            message: totalRecords > 0 ? 'RB数据库已就绪' : 'RB数据库为空，请点击"读取RB"按钮导入数据'
        };
    } catch (error) {
        console.error('检查RB数据库失败:', error);
        return { exists: false, message: 'RB数据库检查失败' };
    }
}
