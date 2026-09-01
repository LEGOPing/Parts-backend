const RB_DB_NAME = 'RB_Database';
const RB_DB_VERSION = 4;

const RB_STORES = {
    COLORS: 'rb_colors',
    ELEMENTS: 'rb_elements',
    INVENTORY_PARTS: 'rb_inventory_parts',
    PART_CATEGORIES: 'rb_part_categories',
    PART_RELATIONSHIPS: 'rb_part_relationships',
    PARTS: 'rb_parts',
    WEIGHTS: 'rb_weights',
    // BL-parts：Bricklink 目录表（方法一「BG型号+颜色名→CODENAME」的桥接表）
    BL_PARTS: 'rb_bl_parts',
    // 零件别名映射表（来自 Gitee part_aliases.csv，别名→RB标准型号）
    PART_ALIASES: 'rb_part_aliases'
};

const RB_STORE_KEYS = {
    'rb_colors': 'colors',
    'rb_parts': 'parts',
    'rb_part_categories': 'part_categories',
    'rb_elements': 'elements',
    'rb_inventory_parts': 'inventory_parts',
    'rb_part_relationships': 'part_relationships',
    'rb_weights': 'weights',
    'rb_bl_parts': 'bl_parts',
    'rb_part_aliases': 'part_aliases'
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
            if (!db.objectStoreNames.contains(RB_STORES.WEIGHTS)) {
                db.createObjectStore(RB_STORES.WEIGHTS, { keyPath: 'part_num' });
            }
            // BL-parts：Bricklink 目录桥接表（方法一「BG型号+颜色名→CODENAME」）
            // 仅作查询桥接，无需主键唯一（CODENAME 存在重复），用自增主键避免导入冲突
            if (!db.objectStoreNames.contains(RB_STORES.BL_PARTS)) {
                db.createObjectStore(RB_STORES.BL_PARTS, { autoIncrement: true });
            }
            // 零件别名映射表：keyPath 为别名型号（alias_part_num），值列 rb_part_num
            if (!db.objectStoreNames.contains(RB_STORES.PART_ALIASES)) {
                db.createObjectStore(RB_STORES.PART_ALIASES, { keyPath: 'alias_part_num' });
            }
        };

        request.onsuccess = (event) => {
            rbDbInstance = event.target.result;
            resolve(rbDbInstance);
        };
    });
}

async function clearStore(storeName) {
    await openRBDatabase();
    return new Promise((resolve, reject) => {
        const db = rbDbInstance;
        if (!db) {
            reject(new Error('RB数据库未初始化'));
            return;
        }
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

// 分批插入 - 避免大数据量导致浏览器崩溃
async function batchInsertChunks(storeName, data, chunkSize = 5000) {
    await openRBDatabase();
    if (!rbDbInstance) {
        throw new Error('RB数据库未初始化');
    }
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

async function getAll(storeName) {
    const db = await openRBDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function getByKey(storeName, key) {
    const db = await openRBDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function countRecords(storeName) {
    const db = await openRBDatabase();
    return new Promise((resolve, reject) => {
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
        const storeMapping = {
            'rb_colors': RB_STORES.COLORS,
            'rb_parts': RB_STORES.PARTS,
            'rb_part_categories': RB_STORES.PART_CATEGORIES,
            'rb_elements': RB_STORES.ELEMENTS,
            'rb_inventory_parts': RB_STORES.INVENTORY_PARTS,
            'rb_part_relationships': RB_STORES.PART_RELATIONSHIPS,
            'rb_weights': RB_STORES.WEIGHTS,
            'rb_bl_parts': RB_STORES.BL_PARTS,
            'rb_part_aliases': RB_STORES.PART_ALIASES
        };
        for (const [key, storeName] of Object.entries(storeMapping)) {
            stats[key] = await countRecords(storeName);
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

// 获取所有颜色
async function getAllColors() {
    try {
        const db = await openRBDatabase();
        return await getAll(RB_STORES.COLORS);
    } catch (error) {
        console.error('获取所有颜色失败:', error);
        return [];
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
                p.name.toLowerCase().replace(/\s*x\s*/g, 'x').includes(q.replace(/\s*x\s*/g, 'x'))
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

// 从 JSON 对象批量导入所有 RB 数据
async function importRBDatabaseFromJSON(jsonData, onProgress) {
    const storeMapping = {
        'colors': RB_STORES.COLORS,
        'parts': RB_STORES.PARTS,
        'part_categories': RB_STORES.PART_CATEGORIES,
        'elements': RB_STORES.ELEMENTS,
        'inventory_parts': RB_STORES.INVENTORY_PARTS,
        'part_relationships': RB_STORES.PART_RELATIONSHIPS,
        'weights': RB_STORES.WEIGHTS,
        'bl_parts': RB_STORES.BL_PARTS,
        'part_aliases': RB_STORES.PART_ALIASES
    };
    
    const results = {};
    const keys = Object.keys(storeMapping);
    
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const storeName = storeMapping[key];
        const data = jsonData[key];
        
        if (!data || !Array.isArray(data)) {
            results[key] = { success: false, count: 0, error: '数据不存在' };
            continue;
        }
        
        try {
            if (onProgress) {
                onProgress(i / keys.length, `导入 ${key} 数据 (${data.length}条)...`);
            }
            await importRBData(storeName, data);
            results[key] = { success: true, count: data.length };
        } catch (error) {
            console.error(`导入 ${key} 失败:`, error);
            results[key] = { success: false, count: data.length, error: error.message };
        }
    }
    
    if (onProgress) {
        onProgress(1, '导入完成');
    }
    
    return results;
}

// 导出所有 RB 数据为 JSON 对象
async function exportRBDatabaseToJSON() {
    await openRBDatabase();
    const jsonData = {};
    const storeMapping = {
        'colors': RB_STORES.COLORS,
        'parts': RB_STORES.PARTS,
        'part_categories': RB_STORES.PART_CATEGORIES,
        'elements': RB_STORES.ELEMENTS,
        'inventory_parts': RB_STORES.INVENTORY_PARTS,
        'part_relationships': RB_STORES.PART_RELATIONSHIPS,
        'weights': RB_STORES.WEIGHTS,
        'bl_parts': RB_STORES.BL_PARTS,
        'part_aliases': RB_STORES.PART_ALIASES
    };
    
    for (const [key, storeName] of Object.entries(storeMapping)) {
        try {
            const data = await getAll(storeName);
            jsonData[key] = data;
        } catch (error) {
            console.error(`导出 ${key} (${storeName}) 失败:`, error);
            jsonData[key] = [];
        }
    }
    
    return jsonData;
}

// 检查本地 RB 数据库是否有数据
async function hasLocalRBData() {
    try {
        const db = await openRBDatabase();
        const stats = await getRBStats();
        const totalRecords = Object.values(stats).reduce((sum, v) => sum + v, 0);
        return totalRecords > 0;
    } catch (error) {
        return false;
    }
}

// 零件名称缓存
let partNamesCache = null;
let partNamesCacheTime = 0;
// 注：CACHE_EXPIRY 已在 api.js 中定义

// 获取所有零件名称（带缓存）
async function getAllPartNames() {
    const now = Date.now();
    if (partNamesCache && (now - partNamesCacheTime) < CACHE_EXPIRY) {
        return partNamesCache;
    }
    
    try {
        const parts = await getAll(RB_STORES.PARTS);
        partNamesCache = parts.map(p => p.name).filter(n => n && n.trim());
        partNamesCacheTime = now;
        return partNamesCache;
    } catch (error) {
        console.error('获取零件名称列表失败:', error);
        return [];
    }
}

// 清除零件名称缓存
function clearPartNamesCache() {
    partNamesCache = null;
    partNamesCacheTime = 0;
}

// 智能分词函数
function smartTokenize(text) {
    if (!text) return [];
    
    const safeText = text.length > 100 ? text.substring(0, 100) : text;
    const tokens = safeText.split(/\s+/).filter(t => t);
    const result = [];
    
    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];
        
        // 检查是否是 "数字 x 数字" 格式
        if (i + 2 < tokens.length && 
            !isNaN(parseInt(token)) && 
            tokens[i + 1].toLowerCase() === 'x' && 
            !isNaN(parseInt(tokens[i + 2]))) {
            result.push(`${token} ${tokens[i + 1]} ${tokens[i + 2]}`);
            i += 3;
        } else if (!isNaN(parseInt(token))) {
            // 检查连续数字
            const numberTokens = [token];
            let j = i + 1;
            while (j < tokens.length && !isNaN(parseInt(tokens[j]))) {
                numberTokens.push(tokens[j]);
                j++;
            }
            if (numberTokens.length > 1) {
                result.push(numberTokens.join(' '));
                i = j;
            } else {
                result.push(token);
                i++;
            }
        } else {
            result.push(token);
            i++;
        }
    }
    
    // 处理分词结果，前4个分词独立显示，后面的所有词联合成一个
    const processedResult = [];
    const firstFour = result.slice(0, 4);
    processedResult.push(...firstFour);
    
    if (result.length > 4) {
        const remaining = result.slice(4);
        processedResult.push(remaining.join(' '));
    }
    
    return processedResult;
}

// 搜索零件型号联想（返回型号+名称）
async function searchPartsByNumber(query, limit = 30) {
    try {
        const db = await openRBDatabase();
        const parts = await getAll(RB_STORES.PARTS);
        const q = query.toLowerCase().trim();
        
        if (!q) return [];
        
        return parts
            .filter(p => p.part_num && p.part_num.toLowerCase().includes(q))
            .slice(0, limit)
            .map(p => ({
                part_num: p.part_num,
                name: p.name || '',
                color_count: 0
            }));
    } catch (error) {
        console.error('搜索零件型号失败:', error);
        return [];
    }
}

// 获取零件名称联想建议
async function getPartNameSuggestions(searchText, wordIndex = 0, previousWords = [], limit = 30) {
    try {
        const allNames = await getAllPartNames();
        if (!allNames || allNames.length === 0) return [];
        
        const safeSearchText = searchText.length > 50 ? searchText.substring(0, 50) : searchText;
        const uniqueWords = new Set();
        
        for (const name of allNames) {
            if (!name) continue;
            
            const words = smartTokenize(name);
            
            // 检查是否匹配之前输入的所有单词
            let matchesPrevious = true;
            for (let i = 0; i < previousWords.length; i++) {
                if (i >= words.length) {
                    matchesPrevious = false;
                    break;
                }
                if (!words[i].toLowerCase().startsWith(previousWords[i].toLowerCase())) {
                    matchesPrevious = false;
                    break;
                }
            }
            
            if (!matchesPrevious) continue;
            
            // 确保单词索引有效
            if (wordIndex < words.length) {
                const targetWord = words[wordIndex];
                
                // 检查单词是否以前缀匹配搜索文本
                if (targetWord.toLowerCase().startsWith(safeSearchText.toLowerCase())) {
                    uniqueWords.add(targetWord);
                }
                
                // 对于数字搜索，额外检查
                if (safeSearchText.search(/\d/) !== -1) {
                    if (targetWord.includes(safeSearchText)) {
                        uniqueWords.add(targetWord);
                    }
                }
            }
        }
        
        // 如果没有匹配结果且搜索文本为空，返回默认的数字单词建议
        if (uniqueWords.size === 0 && safeSearchText.trim() === '') {
            for (const name of allNames) {
                if (!name) continue;
                const words = smartTokenize(name);
                if (wordIndex < words.length) {
                    const targetWord = words[wordIndex];
                    if (targetWord.search(/\d/) !== -1) {
                        uniqueWords.add(targetWord);
                    }
                }
            }
        }
        
        // 排序并限制数量
        const result = Array.from(uniqueWords);
        result.sort(compareSuggestionWords);
        
        return result.slice(0, limit);
    } catch (error) {
        console.error('获取零件名称建议失败:', error);
        return [];
    }
}

// 比较建议单词排序
function compareSuggestionWords(word1, word2) {
    // 首先按长度排序
    if (word1.length !== word2.length) {
        return word1.length < word2.length;
    }
    
    // 检查是否包含数字
    const word1HasNumber = /\d/.test(word1);
    const word2HasNumber = /\d/.test(word2);
    
    // 数字单词优先
    if (word1HasNumber !== word2HasNumber) {
        return word1HasNumber;
    }
    
    // 都是数字或都不是，按字典序排序
    return word1 < word2;
}

// 根据零件名称匹配零件型号
async function matchPartNumberFromName(partName) {
    try {
        const db = await openRBDatabase();
        const parts = await getAll(RB_STORES.PARTS);
        const cleanName = partName.trim();
        
        if (!cleanName) return null;
        
        // 精确匹配
        const exactMatch = parts.find(p => p.name && p.name.trim() === cleanName);
        if (exactMatch) {
            return exactMatch.part_num;
        }
        
        // 不区分大小写匹配
        const caseInsensitiveMatch = parts.find(p => p.name && p.name.toLowerCase().trim() === cleanName.toLowerCase());
        if (caseInsensitiveMatch) {
            return caseInsensitiveMatch.part_num;
        }
        
        return null;
    } catch (error) {
        console.error('匹配零件型号失败:', error);
        return null;
    }
}

// 获取零件的颜色列表（用于联想显示可用颜色数）
async function getPartColorCount(partNum) {
    try {
        const elements = await getAll(RB_STORES.ELEMENTS);
        return elements.filter(e => e.part_num === partNum).length;
    } catch (error) {
        return 0;
    }
}

// ===== 零件图片缓存机制 =====
// v2: 修复 data URL 被存为字符串导致 Service Worker 返回后浏览器无法解析为 JPEG 二进制的问题
const PART_IMAGE_CACHE_NAME = 'part-images-cache-v2';

// 构造 Gitee Parts-img 仓库中的零件图片地址
function buildPartsImgUrl(partNum, colorId) {
    return `${GITEE_IMG_URL}parts/${partNum}_${colorId}.jpg`;
}

// 将 data URL 转换为 Blob（修复 Service Worker 缓存优先策略下，data URL 字符串被当作图片二进制返回导致加载失败的问题）
function dataURLToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bytes = atob(parts[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        arr[i] = bytes.charCodeAt(i);
    }
    return new Blob([arr], { type: mime || 'image/jpeg' });
}

// 根据图片魔数判断真实图片 MIME（不依赖 Content-Type，兼容图床把 .jpg 返回为 application/octet-stream 等情况）
function guessImageMime(bytes) {
    if (bytes.length < 4) return null;
    // JPEG：FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
    // PNG：89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    // GIF：47 49 46 38
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
    // WebP：RIFF .... WEBP
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
        const s = String.fromCharCode(bytes[8] || 0, bytes[9] || 0, bytes[10] || 0, bytes[11] || 0);
        if (s === 'WEBP') return 'image/webp';
    }
    return null;
}

// 将图片字节统一转为 JPEG（离线缓存命名规则为 型号_颜色ID.jpg，非 JPG 需转换）
// 解码/绘制失败（如极少数格式或浏览器不支持）时回退返回原始字节，保证图片仍可用
async function convertImageBytesToJpeg(bytes, mime) {
    try {
        if (mime === 'image/jpeg' || mime === 'image/jpg') return { bytes, mime: 'image/jpeg' };
        const blob = new Blob([bytes], { type: mime });
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        if (typeof bmp.close === 'function') bmp.close();
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        // data URL → Uint8Array（base64 解码）
        const b64 = dataUrl.split(',')[1];
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return { bytes: out, mime: 'image/jpeg' };
    } catch (e) {
        // 转换失败：保留原字节（已通过魔数校验，仍是可渲染图片）
        return { bytes, mime };
    }
}

// 保存图片到浏览器离线缓存（Cache Storage，key 与 Parts-img 地址一致）
// 注意：data URL 必须转为 Blob 再存储，否则 Service Worker 缓存优先策略下，
// 浏览器会把 data URL 字符串当作图片二进制返回，导致 onerror 加载失败
async function savePartImageToOfflineCache(partNum, colorId, imageData) {
    try {
        const cache = await caches.open(PART_IMAGE_CACHE_NAME);
        let response;
        if (imageData instanceof Response) {
            // no-cors 抓取得到的不透明响应（status 0，例如 RB cdn.rebrickable.com 无 CORS 头）：
            // 无法读取其状态/头信息，但调用方（autoCachePartImage）只在 <img> onload 成功后才触发缓存，
            // 即它一定是一张能被渲染的真实图片，直接存入即可（Service Worker 缓存优先时可按图片重放）。
            if (imageData.type === 'opaque') {
                response = imageData;
            } else if (!imageData.ok) {
                // 显式非成功状态码（4xx/5xx）可能返回错误页，拒收避免污染缓存
                console.warn('拒绝缓存状态码非成功的图片响应:', imageData.status);
                return false;
            } else {
                // 基本/跨域响应：按图片魔数清真实图片字节，再重建一个干净的 Response 存入，
                // 兼容图床返回 application/octet-stream 等非 image/* 的 Content-Type，
                // 并按离线命名规则统一转为 JPEG（转换失败保留原字节）
                const cloned = imageData.clone();
                const bytes = new Uint8Array(await cloned.arrayBuffer());
                const mime = guessImageMime(bytes);
                if (!mime) {
                    console.warn('拒绝缓存非图片字节响应:', imageData.status, imageData.type);
                    return false;
                }
                const jpeg = await convertImageBytesToJpeg(bytes, mime);
                response = new Response(jpeg.bytes, { headers: { 'Content-Type': jpeg.mime } });
            }
        } else if (typeof imageData === 'string' && imageData.startsWith('data:')) {
            const blob = dataURLToBlob(imageData);
            response = new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } });
        } else {
            response = new Response(imageData, { headers: { 'Content-Type': 'image/jpeg' } });
        }
        const url = buildPartsImgUrl(partNum, colorId);
        await cache.put(url, response);
        // 清理旧 v1 缓存中的同 key 条目（避免 Service Worker 缓存优先时取到 v1 中的 data URL 字符串）
        try {
            const oldCache = await caches.open('part-images-cache-v1');
            const oldEntry = await oldCache.match(url);
            if (oldEntry) {
                await oldCache.delete(url);
                console.log('已清理旧 v1 缓存条目:', url);
            }
        } catch (_) { /* 忽略 */ }
        return true;
    } catch (error) {
        console.error('保存零件图片到离线缓存失败:', error);
        return false;
    }
}

// 会话内存中使用过的校验结果（避免列表渲染时对每个图片都重复读字节）
const _usableEntryCache = new Map();

// 判断离线缓存条目是否确为可渲染的图片（自愈用）
// 不透明/非成功/内容并非真实图片字节（含被误存为字符串的 data URL、HTML/JSON 错误页）都视为坏图
async function isUsableImageEntry(url, entry) {
    if (!entry) return false;
    // no-cors 存储的不透明条目无法读取 body/状态，但既然它来自某次 onload 成功的图片，
    // 又只在离线缓存命中时无可用校验数据，这里直接信任，避免把已缓存的 RB 图片误删导致回退网络
    if (entry.type === 'opaque') return true;
    if (!entry.ok) return false;
    if (_usableEntryCache.has(url)) return true; // 本次会话已校验可用
    try {
        const buf = new Uint8Array(await entry.clone().arrayBuffer());
        const text = String.fromCharCode(...buf.subarray(0, 12));
        let valid = buf.length > 0;
        if (valid) {
            if (text.startsWith('data:')) valid = false;              // 误存为字符串的 data URL
            else if (text.startsWith('\xFF\xD8')) valid = true;       // JPEG
            else if (text.startsWith('\x89PNG')) valid = true;        // PNG
            else if (text.startsWith('GIF8')) valid = true;           // GIF
            else if (text.startsWith('RIFF') && text.includes('WEBP')) valid = true; // WebP
            else valid = false;
        }
        if (valid) _usableEntryCache.set(url, true);
        return valid;
    } catch (_) {
        return false;
    }
}

// 从浏览器离线缓存读取零件图片
async function getPartImageFromOfflineCache(partNum, colorId) {
    try {
        const cache = await caches.open(PART_IMAGE_CACHE_NAME);
        const url = buildPartsImgUrl(partNum, colorId);
        const entry = await cache.match(url);
        // 自愈：若缓存条目不透明/非成功/并非真实图片字节，则删除并返回 null，
        // 让上层回退到 RB 数据库好图（避免 Service Worker 缓存优先持续返回坏图，
        // 导致图片"加载失败/暂无图片"，删除离线图后又复发）
        if (entry && !(await isUsableImageEntry(url, entry))) {
            console.warn('离线缓存条目不可用，删除:', url, entry.type, entry.status);
            await cache.delete(url);
            return null;
        }
        return entry || null;
    } catch (error) {
        return null;
    }
}

// 从浏览器离线缓存删除零件图片
async function deletePartImageFromOfflineCache(partNum, colorId) {
    try {
        const cache = await caches.open(PART_IMAGE_CACHE_NAME);
        return await cache.delete(buildPartsImgUrl(partNum, colorId));
    } catch (error) {
        console.error('删除零件图片离线缓存失败:', error);
        return false;
    }
}

// 检查 Gitee Parts-img 仓库是否存在该零件图片
// 用 API 端点检查：raw URL 302→raw.giteeusercontent.com 无 CORS 头会被浏览器拦截；
// API 端点返回 Access-Control-Allow-Origin:*，文件存在返回 JSON 对象，不存在返回空数组 []
// 注意：必须携带 Token 避免 Gitee API 未认证限流（429）
async function checkPartsImgOnGitee(partNum, colorId) {
    try {
        const filePath = `parts/${partNum}_${colorId}.jpg`;
        const apiUrl = `${GITEE_IMG_API_URL}/${filePath}?ref=${GITEE_IMG_BRANCH}`;
        const token = (typeof localStorage !== 'undefined' ? localStorage.getItem('gitee_token') : null)
            || (typeof DEFAULT_GITEE_TOKEN !== 'undefined' ? DEFAULT_GITEE_TOKEN : null);
        const headers = token ? { 'Authorization': `token ${token}` } : {};
        const response = await fetch(apiUrl, { cache: 'no-store', headers });
        if (!response.ok) return false;
        const data = await response.json();
        return Array.isArray(data) ? data.length > 0 : !!data;
    } catch (error) {
        return false;
    }
}

// 从 RB 数据库查询零件图片URL：通过型号和颜色匹配 inventory_parts 表
// 同一 part+color 可能有多条记录（不同 inventory 或不同 element），返回去重后的 img_url 列表，供弹窗卡片让用户选择
// 若 inventory_parts 无匹配（该 part+color 组合未出现在任何 inventory 中），回退到 elements 表按 element_id 构造 URL
// 注：查询前会解析零件别名（如 4073 → 6141），确保使用 RB 标准型号查询图片
async function getRBPartImageUrls(partNum, colorId) {
    try {
        // 解析别名：如果 partNum 是别名，用 RB 标准型号查询
        const resolvedNum = typeof resolvePartAlias === 'function'
            ? await resolvePartAlias(partNum) : partNum;
        const normPart = String(resolvedNum).trim().toLowerCase();
        const normColor = String(colorId).trim().toLowerCase();
        const inventory = await getAll(RB_STORES.INVENTORY_PARTS);
        const urls = [];
        inventory.forEach(i => {
            if (String(i.part_num).trim().toLowerCase() === normPart &&
                String(i.color_id).trim().toLowerCase() === normColor &&
                i.img_url && !urls.includes(i.img_url)) {
                urls.push(i.img_url);
            }
        });
        // inventory_parts 无匹配时，回退 elements 表（element 级图片，按 part_num+color_id 匹配 element_id）
        if (urls.length === 0) {
            const elements = await getAll(RB_STORES.ELEMENTS);
            elements.forEach(e => {
                if (String(e.part_num).trim().toLowerCase() === normPart &&
                    String(e.color_id).trim().toLowerCase() === normColor &&
                    e.element_id) {
                    const url = `https://cdn.rebrickable.com/media/parts/elements/${e.element_id}.jpg`;
                    if (!urls.includes(url)) {
                        urls.push(url);
                    }
                }
            });
        }
        return urls;
    } catch (error) {
        console.error('查询RB数据库图片URL失败:', error);
        return [];
    }
}

// 取第一条作为默认图片URL（零件卡片/详情图展示用）
async function getRBPartImageUrl(partNum, colorId) {
    const urls = await getRBPartImageUrls(partNum, colorId);
    return urls.length ? urls[0] : null;
}

// 会话内记忆 Gitee 存在性校验结果，避免每次进入页面都对每个零件重复调用 Gitee API（网络慢、易被限流）
const _giteeExistsCache = new Map();
async function memoCheckPartsImgOnGitee(partNum, colorId) {
    const key = `${String(partNum)}_${colorId}`;
    if (_giteeExistsCache.has(key)) return _giteeExistsCache.get(key);
    const result = await checkPartsImgOnGitee(partNum, colorId);
    // 只记忆"存在"的结果；"不存在"可能是网络失败/限流的误判，下次再重试
    if (result) {
        _giteeExistsCache.set(key, true);
        if (_giteeExistsCache.size > 500) {
            const firstKey = _giteeExistsCache.keys().next().value;
            if (firstKey) _giteeExistsCache.delete(firstKey);
        }
    }
    return result;
}

// 根据 part_num 和 color_id 查询图片URL（按统一加载顺序：① 离线缓存 → ② RB 图片URL → ③ Gitee Parts-img → ④ 暂无）
// 注：离线缓存 key 与 Gitee 图片共用 gitee 地址（命名：parts/{partNum}_{colorId}.jpg），无论图源是 RB 还是 Gitee，
//     首次加载成功后都会回写离线缓存，后续直接命中 ①；
//     RB 数据库查询前解析别名（如 4073 → 6141），用 RB 标准型号获取图片 URL；缓存命名则始终用传入的原始型号
async function getPartImageUrl(partNum, colorId) {
    // ① 先查离线缓存（本地最快，命中即返回，无需网络，也无须再查 RB/Gitee）
    if (await getPartImageFromOfflineCache(partNum, colorId)) {
        return buildPartsImgUrl(partNum, colorId);
    }
    // ② 再查 RB 数据库图片 URL（会解析别名）
    const resolvedNum = typeof resolvePartAlias === 'function'
        ? await resolvePartAlias(partNum) : partNum;
    const rbUrl = await getRBPartImageUrl(resolvedNum, colorId);
    if (rbUrl) return rbUrl;
    // ③ 最后查 Gitee Parts-img（首次命中会成为离线缓存候选，下次直接走 ①）
    if (await memoCheckPartsImgOnGitee(partNum, colorId)) {
        return buildPartsImgUrl(partNum, colorId);
    }
    // ④ 都没有：返回 null，调用方显示“暂无图片”
    return null;
}

// 清除 RB 数据库中该零件的图片记录（删除图片时调用，避免 getPartImageUrl 回退到 RB 数据库旧图）
// 将 inventory_parts 中匹配记录（优先 part_num+color_id 精确匹配，否则 part_num 匹配）的 img_url 置 null
async function clearPartImageUrlInRB(partNum, colorId) {
    try {
        const db = await openRBDatabase();
        const normPart = String(partNum).trim().toLowerCase();
        const normColor = String(colorId).trim().toLowerCase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(RB_STORES.INVENTORY_PARTS, 'readwrite');
            const store = transaction.objectStore(RB_STORES.INVENTORY_PARTS);
            const cursorRequest = store.openCursor();
            let updated = false;
            let exactMatch = null;
            let fallbackMatch = null;

            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    // 优先清除精确匹配（part_num + color_id），否则清除 part_num 匹配
                    const target = exactMatch || fallbackMatch;
                    if (target && target.record.img_url) {
                        target.cursor.update({ ...target.record, img_url: null });
                        updated = true;
                    }
                    resolve(updated);
                    return;
                }
                const record = cursor.value;
                if (String(record.part_num).trim().toLowerCase() === normPart) {
                    if (String(record.color_id).trim().toLowerCase() === normColor) {
                        if (!exactMatch) exactMatch = { record, cursor };
                    } else if (!fallbackMatch) {
                        fallbackMatch = { record, cursor };
                    }
                }
                cursor.continue();
            };
            cursorRequest.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error('清除RB数据库零件图片URL失败:', error);
        return false;
    }
}

// 根据 part_num 查询离线重量（克），返回 number 或 null
async function getPartWeightByNum(partNum) {
    try {
        const cleanNum = String(partNum).replace(/[^a-zA-Z0-9]/g, '');
        if (!cleanNum) return null;
        const record = await getByKey(RB_STORES.WEIGHTS, cleanNum);
        if (record && typeof record.weight === 'number' && record.weight > 0) {
            return record.weight;
        }
        return null;
    } catch (error) {
        console.error('查询离线零件重量失败:', error);
        return null;
    }
}

// 从 weights.json 对象导入到 rb_weights store
// weightsJson 格式: { "3001": 2.32, ... }
async function importWeightsFromJSON(weightsJson, onProgress) {
    try {
        if (!weightsJson || typeof weightsJson !== 'object') {
            throw new Error('weights.json 数据无效');
        }
        const data = [];
        for (const [partNum, weight] of Object.entries(weightsJson)) {
            const num = String(partNum).replace(/[^a-zA-Z0-9]/g, '');
            const w = parseFloat(weight);
            if (num && !isNaN(w) && w > 0) {
                data.push({ part_num: num, weight: w });
            }
        }
        if (onProgress) onProgress(0.5, `导入重量数据 (${data.length}条)...`);
        await importRBData(RB_STORES.WEIGHTS, data);
        if (onProgress) onProgress(1, '重量数据导入完成');
        return { success: true, count: data.length };
    } catch (error) {
        console.error('导入重量数据失败:', error);
        return { success: false, count: 0, error: error.message };
    }
}
