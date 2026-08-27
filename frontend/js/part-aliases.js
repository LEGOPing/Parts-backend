// ==================== 零件别名数据表 ====================
// 用于解决 BG（Brickognize）返回的零件型号在 RB（Rebrickable）数据库中
// 匹配不到的问题。例如：BG 返回 4073，但 RB 数据库中该零件编号为 6141，
// 两者是同一个零件，通过别名表可以将 4073 映射到 6141。
//
// 别名数据来源：Gitee parts-rb 仓库的 part_aliases.json（在线优先）
// 本地嵌入的数据作为离线回退。

const PART_ALIASES_FILE = 'part_aliases.json';

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
    "3040": "3040b",
    // 3063b 和 85080 是外表相同的零件，这里不做别名映射，而是通过同名零件消歧处理
};

// 从 Gitee 零件别名 JSON 文件加载别名数据
// 用 Gitee API + Token 获取（与 fetchRBFile 相同的方式）
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
                    const json = JSON.parse(text);
                    // 支持两种格式：数组 [{alias, rb}] 或对象 {alias: rb}
                    if (Array.isArray(json)) {
                        const map = {};
                        json.forEach(item => {
                            map[item.alias_part_num || item.alias] = item.rb_part_num || item.rb;
                        });
                        return map;
                    }
                    return json;
                }
            }
        }
    } catch (error) {
        console.warn('从Gitee加载别名数据失败，使用本地数据:', error.message);
    }
    return null;
}

// 获取完整的别名映射表（在线优先，离线回退本地）
let cachedAliases = null;

async function getAllPartAliases() {
    if (cachedAliases) return cachedAliases;

    // 先从 Gitee 加载
    const giteeAliases = await fetchPartAliasesFromGitee();
    if (giteeAliases && Object.keys(giteeAliases).length > 0) {
        cachedAliases = giteeAliases;
        return cachedAliases;
    }

    // 回退到本地嵌入数据
    cachedAliases = { ...DEFAULT_PART_ALIASES };
    return cachedAliases;
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