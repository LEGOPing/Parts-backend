// ==================== 零件别名数据表 ====================
// 用于解决 BG（Brickognize）返回的零件型号在 RB（Rebrickable）数据库中
// 匹配不到的问题。例如：BG 返回 4073，但 RB 数据库中该零件编号为 6141，
// 两者是同一个零件，通过别名表可以将 4073 映射到 6141。
//
// 别名数据来源：Gitee parts-rb 仓库的 part_aliases.csv（在线共享文件）
//   · 系统加载 / 更新 RB 时，将 part_aliases.csv 加载到 RB 离线数据库（rb_part_aliases 表）
//   · 别名映射的所有流程都读取 RB 离线数据库
//   · 别名映射更新时，同时写回 RB 离线数据库 + Gitee part_aliases.csv
//   · 本地嵌入数据作为离线回退。

const PART_ALIASES_FILE = 'part_aliases.csv';

// 本地嵌入的默认别名数据（离线回退）
// 格式：{ "alias_part_num": "rb_part_num" }
// 注意：键是别名（BG返回的型号），值是RB数据库中的标准型号
const DEFAULT_PART_ALIASES = {
    "4073": "6141",
    "4085b": "4085",
    "3004old": "3004",
    "3001old": "3001",
    "3020old": "3020",
    "3039old": "3039",
    // 3063b 和 85080 是外表相同的零件，这里不做别名映射，而是通过同名零件消歧处理
};

// 将 CSV 文本解析为 { alias_part_num: rb_part_num } 映射
// 表头：alias_part_num,rb_part_num,remark（首行忽略）
function parsePartAliasesCSV(csvText) {
    const map = {};
    if (!csvText) return map;
    const lines = String(csvText).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        const alias = (parts[0] || '').trim();
        const rb = (parts[1] || '').trim();
        if (alias && rb) map[alias] = rb;
    }
    return map;
}

// 从 Gitee parts-rb 仓库加载 part_aliases.csv（在线优先）
async function fetchPartAliasesFromGitee() {
    try {
        const token = localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
        if (token) {
            const apiUrl = `${GITEE_JSON_API_URL.replace('/Parts-json/contents', '/parts-rb/contents')}/${PART_ALIASES_FILE}?ref=main`;
            const response = await fetch(apiUrl, {
                headers: { 'Authorization': `token ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.content) {
                    const binaryString = atob(data.content);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const text = new TextDecoder('utf-8').decode(bytes);
                    return parsePartAliasesCSV(text);
                }
            }
        }
    } catch (error) {
        console.warn('从Gitee加载别名CSV失败，使用本地数据:', error.message);
    }
    return null;
}

// ==================== 本地持久化（localStorage）====================
// 历史遗留：早期别名写 localStorage，实现跨浏览器会话（重启）可靠持久化。
// 现 RB 离线数据库（rb_part_aliases）已作为主存储，localStorage 仍在加载时并入，
// 避免早期记录的别名丢失。
const ALIAS_LOCAL_STORAGE_KEY = 'bl_alias_map';

// 从 localStorage 读取本地别名映射 { aliasPartNum: rbPartNum }
function getLocalAliasMap() {
    try {
        const raw = localStorage.getItem(ALIAS_LOCAL_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

// 将一条别名写入 localStorage（兜底）
function persistAliasToLocal(aliasPartNum, rbPartNum) {
    try {
        const map = getLocalAliasMap();
        map[String(aliasPartNum)] = String(rbPartNum);
        localStorage.setItem(ALIAS_LOCAL_STORAGE_KEY, JSON.stringify(map));
        return true;
    } catch (e) {
        console.warn('[别名]写入本地存储失败:', e.message);
        return false;
    }
}

// 获取完整的别名映射表（从 RB 离线数据库读取）
let cachedAliases = null;

// 从 RB 离线数据库 rb_part_aliases 表读取别名
async function getAliasesFromRBDB() {
    try {
        const rows = await getAll(RB_STORES.PART_ALIASES);
        const map = {};
        if (Array.isArray(rows)) {
            rows.forEach(r => {
                if (r && r.alias_part_num && r.rb_part_num) {
                    map[String(r.alias_part_num)] = String(r.rb_part_num);
                }
            });
        }
        return map;
    } catch (error) {
        console.warn('[别名]读取RB离线数据库别名失败:', error.message);
        return {};
    }
}

// 将别名映射表全量写入 RB 离线数据库 rb_part_aliases 表（先清空再写入，保证与 map 一致）
async function saveAliasesToRBDB(map) {
    const data = Object.entries(map || {}).map(([alias, rb]) => ({
        alias_part_num: String(alias).trim(),
        rb_part_num: String(rb).trim()
    })).filter(r => r.alias_part_num && r.rb_part_num);
    await importRBData(RB_STORES.PART_ALIASES, data);
    return data.length;
}

// 将 Gitee part_aliases.csv 加载到 RB 离线数据库（系统加载 / 更新RB时调用）
// 同时并入 localStorage 中的历史别名，避免旧数据丢失。
async function loadPartAliasesFromGiteeToRBDB() {
    const map = await fetchPartAliasesFromGitee();
    const effective = { ...DEFAULT_PART_ALIASES };
    if (map && Object.keys(map).length > 0) {
        Object.assign(effective, map);
    }
    // 并入历史 localStorage 别名
    const localMap = getLocalAliasMap();
    if (localMap && Object.keys(localMap).length > 0) {
        Object.assign(effective, localMap);
    }
    await saveAliasesToRBDB(effective);
    cachedAliases = { ...effective };
    return effective;
}

async function getAllPartAliases() {
    if (cachedAliases) return cachedAliases;

    // 1. 从 RB 离线数据库读取（主存储）
    const fromDB = await getAliasesFromRBDB();
    if (Object.keys(fromDB).length > 0) {
        cachedAliases = { ...DEFAULT_PART_ALIASES, ...fromDB };
        return cachedAliases;
    }

    // 2. 离线库为空 → 从 Gitee CSV 加载到离线库（并入历史 localStorage）
    try {
        cachedAliases = await loadPartAliasesFromGiteeToRBDB();
        return cachedAliases;
    } catch (error) {
        console.warn('[别名]加载失败，使用默认别名:', error.message);
    }

    // 3. 回退到本地嵌入数据
    cachedAliases = { ...DEFAULT_PART_ALIASES };
    return cachedAliases;
}

// 统一持久化一条别名：写 RB 离线数据库 + Gitee part_aliases.csv + localStorage
// 全量写回，保证 RB库 与 CSV 一致。
// 返回 { ok, rbOK, giteeOK, skipped }
async function persistPartAlias(aliasPartNum, rbPartNum) {
    const alias = String(aliasPartNum).trim();
    const rb = String(rbPartNum).trim();
    if (!alias || !rb || alias === rb) {
        return { ok: true, skipped: true };
    }

    // 1. 汇总当前完整别名表（以 RB 库现有记录为准，确保多次重配累积不丢）
    const map = { ...DEFAULT_PART_ALIASES, ...(await getAliasesFromRBDB()) };
    Object.assign(map, getLocalAliasMap());
    map[alias] = rb;

    // 2. 更新 localStorage（兜底）
    persistAliasToLocal(alias, rb);

    // 3. 写入 RB 离线数据库（全量）
    let rbOK = true;
    try {
        await saveAliasesToRBDB(map);
    } catch (e) {
        rbOK = false;
        console.warn('[别名]写RB离线库失败:', e.message);
    }

    // 4. 写回 Gitee part_aliases.csv（全量）
    let giteeOK = true;
    if (typeof updatePartAliasesCSV === 'function') {
        try {
            await updatePartAliasesCSV(map);
        } catch (e) {
            giteeOK = false;
            console.warn('[别名]写回Gitee CSV失败:', e.message);
        }
    }

    // 5. 刷新内存缓存
    cachedAliases = { ...map };

    return { ok: rbOK && giteeOK, rbOK, giteeOK, skipped: false };
}

// 删除一条别名映射：写 RB 离线数据库 + Gitee part_aliases.csv + localStorage
// 与 persistPartAlias 对称，用于"直接匹配RB（不使用别名）"时需要移除旧别名记录。
// 返回 { ok, rbOK, giteeOK, skipped }（skipped=true 表示本就不存在该别名）
async function deletePartAlias(aliasPartNum) {
    const alias = String(aliasPartNum).trim();
    if (!alias) {
        return { ok: true, skipped: true };
    }

    // 1. 汇总当前完整别名表（以 RB 库现有记录为准）
    const map = { ...DEFAULT_PART_ALIASES, ...(await getAliasesFromRBDB()) };
    Object.assign(map, getLocalAliasMap());
    const existed = Object.prototype.hasOwnProperty.call(map, alias);
    delete map[alias];

    // 2. 更新 localStorage（兜底，同样移除该键，而非写入"空映射"）
    try {
        const localMap = getLocalAliasMap();
        delete localMap[alias];
        localStorage.setItem(ALIAS_LOCAL_STORAGE_KEY, JSON.stringify(localMap));
    } catch (e) {
        console.warn('[别名]写本地存储失败:', e.message);
    }

    // 3. 写入 RB 离线数据库（全量）
    let rbOK = true;
    try {
        await saveAliasesToRBDB(map);
    } catch (e) {
        rbOK = false;
        console.warn('[别名]写RB离线库失败:', e.message);
    }

    // 4. 写回 Gitee part_aliases.csv（全量）
    let giteeOK = true;
    if (typeof updatePartAliasesCSV === 'function') {
        try {
            await updatePartAliasesCSV(map);
        } catch (e) {
            giteeOK = false;
            console.warn('[别名]写回Gitee CSV失败:', e.message);
        }
    }

    // 5. 刷新内存缓存
    cachedAliases = { ...map };

    return { ok: rbOK && giteeOK, rbOK, giteeOK, skipped: !existed };
}

// 清除别名缓存（当Gitee数据更新时调用）
function clearPartAliasesCache() {
    cachedAliases = null;
}

// 根据别名查询 RB 标准零件型号
// 例如：resolvePartAlias("4073") → "6141"
// 如果找不到别名映射，返回原值
async function resolvePartAlias(partNum) {
    if (!partNum) return partNum;
    const cleanNum = String(partNum).trim();
    try {
        const aliases = await getAllPartAliases();
        return aliases[cleanNum] || cleanNum;
    } catch (error) {
        console.warn('查询零件别名失败:', error.message);
        return cleanNum;
    }
}

// 反向查询：某个 RB 标准型号有哪些别名
// 例如：getAliasesForRBPart("6141") → ["4073"]
async function getAliasesForRBPart(rbPartNum) {
    if (!rbPartNum) return [];
    const cleanNum = String(rbPartNum).trim();
    const results = [];
    try {
        const aliases = await getAllPartAliases();
        for (const [alias, rb] of Object.entries(aliases)) {
            if (rb === cleanNum) {
                results.push(alias);
            }
        }
    } catch (error) {
        console.warn('查询RB零件别名失败:', error.message);
    }
    return results;
}

// ==================== 颜色名称 → 颜色ID 匹配 ====================
// BG 返回的颜色是名称（如 "Red", "Black"），需要匹配到 RB 数据库的颜色 ID
// 颜色名称标准化映射：将各种可能的颜色名称变体映射到标准名称

const COLOR_NAME_NORMALIZATION = {
    // 常见颜色名称标准化
    "black": "Black",
    "blue": "Blue",
    "green": "Green",
    "red": "Red",
    "white": "White",
    "yellow": "Yellow",
    "orange": "Orange",
    "purple": "Purple",
    "brown": "Brown",
    "pink": "Pink",
    "grey": "Light Bluish Gray",
    "gray": "Light Bluish Gray",
    "dark grey": "Dark Bluish Gray",
    "dark gray": "Dark Bluish Gray",
    "light grey": "Light Bluish Gray",
    "light gray": "Light Bluish Gray",
    "dark blue": "Dark Blue",
    "light blue": "Light Blue",
    "dark green": "Dark Green",
    "light green": "Light Green",
    "dark red": "Dark Red",
    "dark brown": "Dark Brown",
    "dark pink": "Dark Pink",
    "light pink": "Light Pink",
    "dark purple": "Dark Purple",
    "light purple": "Light Purple",
    "dark orange": "Dark Orange",
    "light orange": "Light Orange",
    "dark yellow": "Dark Yellow",
    "light yellow": "Light Yellow",
    "dark tan": "Dark Tan",
    "tan": "Tan",
    "transparent": "Transparent",
    "clear": "Transparent",
    "trans": "Transparent",
    "chrome": "Chrome",
    "gold": "Gold",
    "silver": "Silver",
    "metallic": "Metallic Silver",
    "pearl": "Pearl Gold",
    "copper": "Copper",
    "glow": "Glow In Dark White",
    "glow in dark": "Glow In Dark White",
    "neon": "Neon Yellow",
    "lime": "Lime",
    "teal": "Teal",
    "turquoise": "Turquoise",
    "indigo": "Indigo",
    "violet": "Violet",
    "magenta": "Magenta",
    "coral": "Coral",
    "salmon": "Salmon",
    "beige": "Beige",
    "cream": "Cream",
    "mint": "Mint",
    "lavender": "Lavender",
    "maroon": "Maroon",
    "navy": "Navy Blue",
    "olive": "Olive Green",
    "rust": "Rust",
    "sand": "Sand Green",
    "sky blue": "Sky Blue",
    "stone": "Dark Stone Gray",
    "brick": "Reddish Brown",
    "dark bluish gray": "Dark Bluish Gray",
    "light bluish gray": "Light Bluish Gray",
    "medium blue": "Medium Blue",
    "medium green": "Medium Green",
    "medium orange": "Medium Orange",
    "medium lavender": "Medium Lavender",
    "dark azure": "Dark Azure",
    "medium azure": "Medium Azure",
    "bright green": "Bright Green",
    "bright blue": "Bright Blue",
    "bright red": "Bright Red",
    "bright yellow": "Bright Yellow",
    "bright orange": "Bright Orange",
    "earth green": "Earth Green",
    "earth blue": "Earth Blue",
    "dark flesh": "Dark Flesh",
    "flesh": "Flesh",
    "light flesh": "Light Flesh",
};

// 根据颜色名称查询 RB 颜色 ID
// 返回匹配的颜色对象 { id, name, rgb } 或 null
async function matchColorNameToId(colorName) {
    if (!colorName) return null;
    const cleanName = String(colorName).trim().toLowerCase();
    if (!cleanName) return null;

    // 1. 标准化名称
    const normalizedName = COLOR_NAME_NORMALIZATION[cleanName] || colorName.trim();

    // 2. 从 RB 数据库查询所有颜色
    try {
        const allColors = await getAllColors();
        if (!allColors || allColors.length === 0) return null;

        // 3. 精确匹配（标准化后的名称）
        let match = allColors.find(c => c.name && c.name.toLowerCase() === normalizedName.toLowerCase());
        if (match) return match;

        // 4. 不区分大小写匹配
        match = allColors.find(c => c.name && c.name.toLowerCase() === colorName.trim().toLowerCase());
        if (match) return match;

        // 5. 部分匹配（颜色名称包含关键词）
        match = allColors.find(c => c.name && c.name.toLowerCase().includes(cleanName));
        if (match) return match;

        // 6. 反向部分匹配（关键词包含颜色名称）
        match = allColors.find(c => c.name && cleanName.includes(c.name.toLowerCase()));
        if (match) return match;

        // 7. 模糊匹配：取最接近的
        let bestScore = 0;
        let bestMatch = null;
        for (const c of allColors) {
            if (!c.name) continue;
            const cName = c.name.toLowerCase();
            // 计算共同子串长度
            let score = 0;
            for (let i = 0; i < cleanName.length && i < cName.length; i++) {
                if (cleanName[i] === cName[i]) score++;
                else break;
            }
            if (score > bestScore) {
                bestScore = score;
                bestMatch = c;
            }
        }
        if (bestScore >= 3) return bestMatch;

    } catch (error) {
        console.warn('匹配颜色名称失败:', error.message);
    }

    return null;
}

// 获取颜色名称对应的颜色 ID
// 如果匹配不到，返回 null
async function getColorIdByName(colorName) {
    const color = await matchColorNameToId(colorName);
    return color ? color.id : null;
}