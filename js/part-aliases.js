// ==================== 零件别名数据表 ====================
// 用于解决 BG（Brickognize）返回的零件型号在 RB（Rebrickable）数据库中
// 匹配不到的问题。例如：BG 返回 4073，但 RB 数据库中该零件编号为 6141，
// 两者是同一个零件，通过别名表可以将 4073 映射到 6141。
//
// 别名数据来源：Gitee parts-rb 仓库的 part_aliases.csv（可在系统外编辑）
// 系统在"加载/更新 RB 数据库"时把 part_aliases.csv 写入本地 RB 离线库（rb_aliases 表），
// 别名解析优先读取 RB 离线库，不依赖 Supabase 系统数据库。
// 本地嵌入的数据 + localStorage 仅作离线 / 跨设备回退。

const PART_ALIASES_CSV = 'part_aliases.csv';

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

// 从 Gitee parts-rb 仓库读取 part_aliases.csv（用 Gitee API + Token，与 fetchRBFile 相同的方式），
// 解析为 { alias_part_num: rb_part_num }。文件不存在或解析失败返回 null。
async function fetchPartAliasesCsvFromGitee() {
    const csvText = await fetchRBFile(PART_ALIASES_CSV);
    if (!csvText) return null;
    try {
        const { data } = parseRBCSV(csvText);
        const map = {};
        (data || []).forEach(r => {
            if (r.alias_part_num && r.rb_part_num) {
                map[String(r.alias_part_num).trim()] = String(r.rb_part_num).trim();
            }
        });
        return Object.keys(map).length ? map : null;
    } catch (error) {
        console.warn('解析 part_aliases.csv 失败:', error.message);
        return null;
    }
}

// 获取完整的别名映射表（RB 离线库优先 + 本地缺省表 + localStorage 兜底）
let cachedAliases = null;

// ==================== 本地持久化（localStorage）====================
// BG兑底/BL匹配自动建立的别名会写入 localStorage，实现跨浏览器会话（重启）可靠持久化，
// 即使 RB 离线库尚未加载/更新，本机别名也不会丢失（如 2431p52 → 2431pr0017）。
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

// 将一条别名写入 localStorage（BG兑底/BL匹配建立的别名，优先级最高）
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

async function getAllPartAliases() {
    if (cachedAliases) return cachedAliases;

    const map = {};
    // 1. RB 离线库（来自 Gitee part_aliases.csv，随"加载/更新RB"写入 rb_aliases 表）
    const rbAliases = await getAllPartAliasesFromRB();
    if (rbAliases && Object.keys(rbAliases).length > 0) Object.assign(map, rbAliases);
    // 2. 本地嵌入缺省表（离线兜底）
    Object.assign(map, DEFAULT_PART_ALIASES);
    // 3. localStorage 本机别名（BG兑底/BL匹配自动建立，优先级最高）
    const localMap = getLocalAliasMap();
    if (localMap && Object.keys(localMap).length > 0) Object.assign(map, localMap);

    cachedAliases = map;
    return cachedAliases;
}

// 清除别名缓存（RB 离线库更新时调用，使新别名立即生效）
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

// 将单条别名持久化到 Gitee parts-rb 仓库的 part_aliases.csv（共享、可在系统外编辑）
// 按 alias_part_num 去重：已存在则更新该行，否则追加。返回 { success } 或 { success:false, error }。
async function savePartAliasToGiteeCsv(aliasPartNum, rbPartNum) {
    const token = localStorage.getItem('gitee_token') || DEFAULT_GITEE_TOKEN;
    if (!token) return { success: false, error: '缺少 Gitee Token' };
    const apiUrl = `${GITEE_JSON_API_URL.replace('/Parts-json/contents', '/parts-rb/contents')}/${PART_ALIASES_CSV}`;
    const alias = String(aliasPartNum).trim();
    const rb = String(rbPartNum).trim();

    const csvEscape = (v) => (v && (v.includes(',') || v.includes('"') || v.includes('\n')))
        ? '"' + v.replace(/"/g, '""') + '"' : v;

    try {
        // 1) 读取现有 CSV 与 SHA
        let text = 'alias_part_num,rb_part_num,remark\n';
        let sha = null;
        const checkResp = await fetch(`${apiUrl}?ref=main`, { headers: { 'Authorization': `token ${token}` } });
        if (checkResp.ok) {
            const existing = await checkResp.json();
            sha = existing.sha;
            if (existing.content) {
                const bin = atob(existing.content);
                text = new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
            }
        }

        // 2) 按 alias_part_num 去重：已存在则更新该行，否则追加新行
        let found = false;
        const lines = text.split(/\r?\n/);
        const headerIdx = lines.findIndex(l => l.trim().toLowerCase().startsWith('alias_part_num'));
        for (let i = headerIdx + 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            if (parseRBCSVLine(lines[i])[0].trim() === alias) {
                lines[i] = `${csvEscape(alias)},${csvEscape(rb)},BG识别兑底匹配自动建立`;
                found = true;
                break;
            }
        }
        if (!found) {
            lines.push(`${csvEscape(alias)},${csvEscape(rb)},BG识别兑底匹配自动建立`);
        }
        const newText = lines.join('\n');

        // 3) 编码并推送（POST 新建 / PUT 更新）
        const contentB64 = btoa(unescape(encodeURIComponent(newText)));
        const body = {
            message: `feat: 添加零件别名 ${alias} → ${rb} [skip ci]`,
            content: contentB64,
            branch: 'main'
        };
        if (sha) body.sha = sha;
        const resp = await fetch(apiUrl, {
            method: sha ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `token ${token}` },
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        console.log(`[别名]已写入 Gitee part_aliases.csv: ${alias} → ${rb}`);
        return { success: true };
    } catch (e) {
        console.warn('[别名]写入 Gitee part_aliases.csv 失败:', e.message);
        return { success: false, error: e.message };
    }
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