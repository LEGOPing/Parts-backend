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

    // 1. 先从 Gitee 加载
    const giteeAliases = await fetchPartAliasesFromGitee();
    if (giteeAliases && Object.keys(giteeAliases).length > 0) {
        cachedAliases = giteeAliases;
    } else {
        // 回退到本地嵌入数据
        cachedAliases = { ...DEFAULT_PART_ALIASES };
    }

    // 2. 再从后端 Supabase part_aliases 表加载（兑底匹配自动建立的别名）
    //    这些别名是用户通过「拍照识别 → 兑底匹配」生成的，优先级高于 Gitee/本地数据
    try {
        const supabaseAliases = await supabaseRequest('part_aliases', {
            select: 'alias_part_num,rb_part_num',
        });
        if (Array.isArray(supabaseAliases)) {
            for (const row of supabaseAliases) {
                if (row.alias_part_num && row.rb_part_num) {
                    cachedAliases[String(row.alias_part_num)] = String(row.rb_part_num);
                }
            }
        }
    } catch (e) {
        console.warn('[别名]从后端加载别名失败:', e.message);
    }

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

// 保存别名映射到后端 Supabase part_aliases 表
// 同时更新前端本地别名缓存，本次会话立即生效
async function savePartAlias(aliasPartNum, rbPartNum) {
    if (!aliasPartNum || !rbPartNum || aliasPartNum === rbPartNum) return;
    // 1) 持久化到后端 Supabase part_aliases 表
    try {
        await supabaseRequest('part_aliases', {
            method: 'POST',
            headers: { 'Prefer': 'return=minimal' },
            body: {
                alias_part_num: String(aliasPartNum),
                rb_part_num: String(rbPartNum),
                remark: 'BG识别兑底匹配自动建立'
            }
        });
        console.log(`[兑底]别名已写入后端: ${aliasPartNum} → ${rbPartNum}`);
    } catch (e) {
        console.warn('[兑底]写入后端别名失败:', e.message);
    }
    // 2) 刷新/注入前端本地别名缓存（本次会话立即生效）
    try {
        const aliases = await getAllPartAliases();
        if (aliases) aliases[String(aliasPartNum)] = String(rbPartNum);
    } catch (e) {
        console.warn('[兑底]刷新前端别名缓存失败:', e.message);
    }
}

// 检查并确保别名映射已持久化到线上（Supabase）
// 如果线上不存在该别名映射，则保存；已存在则跳过
async function ensureAliasPersisted(aliasPartNum, rbPartNum) {
    if (!aliasPartNum || !rbPartNum || aliasPartNum === rbPartNum) return;
    try {
        // 查询线上是否已存在该别名映射
        const existing = await supabaseRequest('part_aliases', {
            select: 'id',
            filters: { alias_part_num: `eq.${String(aliasPartNum)}` },
        });
        // 如果线上已有记录（数组非空），无需重复保存
        if (Array.isArray(existing) && existing.length > 0) {
            console.log(`[别名]线上已存在映射: ${aliasPartNum} → ${rbPartNum}`);
            return;
        }
    } catch (e) {
        console.warn('[别名]查询线上别名失败，将尝试重新保存:', e.message);
    }
    // 线上不存在或查询失败，尝试保存
    await savePartAlias(aliasPartNum, rbPartNum);
}