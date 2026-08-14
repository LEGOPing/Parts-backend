const RB_DB_NAME = 'RB_Database';
const RB_DB_VERSION = 2;

const RB_STORES = {
    COLORS: 'rb_colors',
    ELEMENTS: 'rb_elements',
    INVENTORY_PARTS: 'rb_inventory_parts',
    PART_CATEGORIES: 'rb_part_categories',
    PART_RELATIONSHIPS: 'rb_part_relationships',
    PARTS: 'rb_parts',
    WEIGHTS: 'rb_weights'
};

const RB_STORE_KEYS = {
    'rb_colors': 'colors',
    'rb_parts': 'parts',
    'rb_part_categories': 'part_categories',
    'rb_elements': 'elements',
    'rb_inventory_parts': 'inventory_parts',
    'rb_part_relationships': 'part_relationships',
    'rb_weights': 'weights'
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
            'rb_weights': RB_STORES.WEIGHTS
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

// 从 JSON 对象批量导入所有 RB 数据
async function importRBDatabaseFromJSON(jsonData, onProgress) {
    const storeMapping = {
        'colors': RB_STORES.COLORS,
        'parts': RB_STORES.PARTS,
        'part_categories': RB_STORES.PART_CATEGORIES,
        'elements': RB_STORES.ELEMENTS,
        'inventory_parts': RB_STORES.INVENTORY_PARTS,
        'part_relationships': RB_STORES.PART_RELATIONSHIPS,
        'weights': RB_STORES.WEIGHTS
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
        'weights': RB_STORES.WEIGHTS
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
const PART_IMAGE_CACHE_NAME = 'part-images-cache-v1';

// 构造 Gitee Parts-img 仓库中的零件图片地址
function buildPartsImgUrl(partNum, colorId) {
    return `${GITEE_IMG_URL}parts/${partNum}_${colorId}.jpg`;
}

// 保存图片到浏览器离线缓存（Cache Storage，key 与 Parts-img 地址一致）
async function savePartImageToOfflineCache(partNum, colorId, imageData) {
    try {
        const cache = await caches.open(PART_IMAGE_CACHE_NAME);
        const response = imageData instanceof Response
            ? imageData
            : new Response(imageData, { headers: { 'Content-Type': 'image/jpeg' } });
        await cache.put(buildPartsImgUrl(partNum, colorId), response);
        return true;
    } catch (error) {
        console.error('保存零件图片到离线缓存失败:', error);
        return false;
    }
}

// 从浏览器离线缓存读取零件图片
async function getPartImageFromOfflineCache(partNum, colorId) {
    try {
        const cache = await caches.open(PART_IMAGE_CACHE_NAME);
        return await cache.match(buildPartsImgUrl(partNum, colorId));
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
async function checkPartsImgOnGitee(partNum, colorId) {
    try {
        const response = await fetch(buildPartsImgUrl(partNum, colorId), { cache: 'no-store' });
        return response.ok;
    } catch (error) {
        return false;
    }
}

// 从 RB 数据库查询零件图片URL：通过型号和颜色精确匹配 inventory_parts 表
// 同一 part+color 可能有多条记录（不同 inventory 或不同 element），返回去重后的 img_url 列表，供弹窗卡片让用户选择
// 无匹配或 img_url 为空（暂时失效）时按暂无图片处理，返回空列表
async function getRBPartImageUrls(partNum, colorId) {
    try {
        const normPart = String(partNum).trim().toLowerCase();
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
        return urls;
    } catch (error) {
        console.error('查询RB数据库图片URL失败:', error);
        return [];
    }
}

// 取第一条作为默认图片URL（零件卡片/详情图展示用）
// confirmOnMultiple=true 时，若 inventory_parts 精确匹配到多个不同URL，弹窗让用户确认选择
async function getRBPartImageUrl(partNum, colorId, confirmOnMultiple) {
    const urls = await getRBPartImageUrls(partNum, colorId);
    if (!urls.length) return null;
    if (confirmOnMultiple && urls.length > 1) {
        return await confirmChooseRBImageUrl(partNum, colorId, urls);
    }
    return urls[0];
}

// 匹配到多个RB图片URL时，弹窗让用户确认选择（返回用户选中的URL）
function confirmChooseRBImageUrl(partNum, colorId, urls) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        const sheet = document.createElement('div');
        sheet.className = 'modal-content';
        sheet.style.maxWidth = '350px';
        sheet.innerHTML = `
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <span class="modal-title" style="font-size:16px;font-weight:600;">选择图片</span>
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove();resolve(null)" style="background:#f44336;color:white;padding:6px 14px;font-size:13px;border:none;border-radius:4px;cursor:pointer;">取消</button>
            </div>
            <div class="modal-body">
                <div style="font-size:13px;color:#666;margin-bottom:8px;">型号：${partNum}　颜色ID：${colorId}　匹配到 ${urls.length} 条图片，请选择：</div>
                ${urls.map(u => `
                <div onclick="this.closest('.modal-overlay').remove();resolve('${u.replace(/'/g, "\\'")}')" style="word-break:break-all;background:#FFF8E1;border:1px solid #FFE082;border-radius:6px;padding:8px;font-size:12px;color:#795548;margin-bottom:6px;cursor:pointer;">${u}</div>`).join('')}
            </div>
        `;
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    });
}

// 根据 part_num 和 color_id 查询图片URL（三级读取：① 浏览器离线缓存 → ② Gitee Parts-img → ③ RB数据库）
// confirmOnMultiple=true 时，RB数据库匹配到多个不同URL会弹窗让用户确认
async function getPartImageUrl(partNum, colorId, confirmOnMultiple) {
    // ① 浏览器离线缓存（人工添加的图片优先）
    const cached = await getPartImageFromOfflineCache(partNum, colorId);
    if (cached) {
        return buildPartsImgUrl(partNum, colorId);
    }
    // ② Gitee Parts-img 仓库
    if (await checkPartsImgOnGitee(partNum, colorId)) {
        return buildPartsImgUrl(partNum, colorId);
    }
    // ③ RB数据库（inventory_parts 表按型号+颜色匹配）
    return await getRBPartImageUrl(partNum, colorId, confirmOnMultiple);
}

// 清除 RB 数据库中该零件的图片记录（删除图片时调用，避免 getPartImageUrl 回退到 RB 数据库旧图）
// 将 inventory_parts 中所有 part_num+color_id 精确匹配记录的 img_url 置 null
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

            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    resolve(updated);
                    return;
                }
                const record = cursor.value;
                if (String(record.part_num).trim().toLowerCase() === normPart &&
                    String(record.color_id).trim().toLowerCase() === normColor) {
                    if (record.img_url) {
                        cursor.update({ ...record, img_url: null });
                        updated = true;
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

// 直接更新 RB 数据库中该零件（part_num+color_id 精确匹配）的所有 img_url 记录
// 用于"图片URL变更"功能：不下载图片，直接把 inventory_parts 的 img_url 改写为用户输入的URL
async function updateRBPartImageUrl(partNum, colorId, newUrl) {
    try {
        const db = await openRBDatabase();
        const normPart = String(partNum).trim().toLowerCase();
        const normColor = String(colorId).trim().toLowerCase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(RB_STORES.INVENTORY_PARTS, 'readwrite');
            const store = transaction.objectStore(RB_STORES.INVENTORY_PARTS);
            const cursorRequest = store.openCursor();
            let updated = 0;

            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    resolve(updated);
                    return;
                }
                const record = cursor.value;
                if (String(record.part_num).trim().toLowerCase() === normPart &&
                    String(record.color_id).trim().toLowerCase() === normColor) {
                    cursor.update({ ...record, img_url: newUrl });
                    updated++;
                }
                cursor.continue();
            };
            cursorRequest.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error('更新RB数据库零件图片URL失败:', error);
        return 0;
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
