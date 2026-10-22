# -*- coding: utf-8 -*-
"""
玩具寄售清单 - Pythonista iOS 应用
功能：逐个输入玩具信息、拍照、保存CSV清单
"""

import ui
import dialogs
import os
import csv
import json
import photos
import webbrowser
import io
from datetime import datetime

# Pythonista ObjC bridge（PIL → ui.Image 必须走这条路）
try:
    import objc_util
    _HAS_OBJC = True
except ImportError:
    _HAS_OBJC = False

# ============ 配置常量 ============
# 主存储：JSON（天然支持数组字段、任意换行、key 契约不依赖列位置）
JSON_FILENAME = "寄售清单.json"
# 兼容：旧 CSV 只在迁移时读一次，之后不再写
CSV_FILENAME = "寄售清单.csv"
CONFIG_FILENAME = ".app_config.json"

# JSON 格式版本（未来升级时用来判断是否需要迁移）
STORAGE_VERSION = 1

# 单选 / 多选选项（不变）
SEAL_OPTIONS = ["原封未拆", "已拆未砌", "已拆已砌"]

# 外盒状态（多选）
BOX_CONDITION_OPTIONS = ["完好", "角损", "压痕", "裂痕", "破口", "封条破损", "湿水", "污渍", "其他"]

# 本体状态（多选）
ITEM_CONDITION_OPTIONS = ["完好", "松动", "污渍", "霉点", "裂痕", "褪色", "厚尘", "其他"]

# 配件状态（多选）
ACCESSORY_OPTIONS = ["齐全", "缺零件", "缺贴纸", "缺说明书", "零件袋破损", "其他"]


# ============ 路径工具（全用 Pythonista 兼容写法） ============
def get_script_dir():
    """脚本当前所在文件夹 — Pythonista 里 cwd 就是脚本目录"""
    cwd = os.getcwd()
    if cwd and os.path.exists(cwd):
        print(f"[路径] os.getcwd(): {cwd}")
        return cwd
    try:
        d = os.path.dirname(os.path.abspath(__file__))
        if d and os.path.exists(d):
            print(f"[路径] __file__: {d}")
            return d
    except Exception as e:
        print(f"[路径] __file__ 不可用: {e}")
    fallback = os.path.expanduser("~")
    print(f"[路径] 兜底 Documents: {fallback}")
    return fallback



def get_list_folder(list_name):
    """脚本目录/清单名/ — CSV 和照片在同一位置"""
    script_dir = get_script_dir()
    folder_path = os.path.join(script_dir, list_name)
    try:
        os.makedirs(folder_path, exist_ok=True)
        print(f"[路径] 脚本: {script_dir}")
        print(f"[路径] 清单: {folder_path}")
    except Exception as e:
        dialogs.alert("错误", f"无法创建文件夹：\n{folder_path}\n\n原因：{e}")
    return folder_path


def get_json_path(list_name):
    """获取 JSON 主存储文件完整路径"""
    return os.path.join(get_list_folder(list_name), JSON_FILENAME)


def get_csv_path(list_name):
    """获取 CSV 旧文件路径（仅迁移时用，之后不再读写）"""
    return os.path.join(get_list_folder(list_name), CSV_FILENAME)


def get_config_path():
    """获取配置文件路径"""
    return os.path.join(os.path.expanduser("~"), CONFIG_FILENAME)


# ============ 配置读写 ============
def save_config(config):
    try:
        path = get_config_path()
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        print(f"[配置] 已保存: {path}")
    except Exception as e:
        print(f"保存配置失败: {e}")


def load_config():
    try:
        path = get_config_path()
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"加载配置失败: {e}")
    return {}


# ============ JSON 主存储层 ============
# 数据契约：
#   items 是 list[dict]，每条 dict 的字段：
#     序号: int, 型号: str, 数量: int, 参考价: str
#     拆封状态: str (单选)
#     外盒状态/本体状态/配件状态: list[str] (多选数组)
#     外盒其他/本体其他/配件其他: str
#     其他瑕疵或说明: str (可含任意 \n)
#     照片文件: list[str]
#     录入时间: str "YYYY-MM-DD HH:MM:SS"
#
# JSON 文件整体结构：
#   { "清单名": "...", "版本": 1, "items": [...] }

def _str_to_list(s):
    """CSV 字符串 → JSON 数组。兼容三种来源：
    - None / 空 → []
    - 已是 list → 过滤空后返回
    - "a|b|c" → ["a","b","c"]
    """
    if isinstance(s, list):
        return [str(x).strip() for x in s if str(x).strip()]
    if not s:
        return []
    parts = [p.strip() for p in str(s).split("|") if p.strip()]
    return parts


def _int_or_zero(v):
    """安全转 int，转不了返回 0"""
    try:
        return int(str(v).strip())
    except (ValueError, TypeError):
        return 0


def _item_from_csv_row(row):
    """把 CSV 的一行 dict 转成 JSON 的一条 item dict。
    row 来自 csv.DictReader，字段值全是 str。"""
    return {
        "序号": _int_or_zero(row.get("序号")),
        "型号": str(row.get("型号", "")).strip(),
        "数量": _int_or_zero(row.get("数量", "1")) or 1,
        "参考价": str(row.get("参考价", "")).strip(),
        "拆封状态": str(row.get("拆封状态", "")).strip(),
        "外盒状态": _str_to_list(row.get("外盒状态")),
        "外盒其他": str(row.get("外盒其他", "")).strip(),
        "本体状态": _str_to_list(row.get("本体状态")),
        "本体其他": str(row.get("本体其他", "")).strip(),
        "配件状态": _str_to_list(row.get("配件状态")),
        "配件其他": str(row.get("配件其他", "")).strip(),
        "其他瑕疵或说明": str(row.get("其他瑕疵或说明", "")).strip(),
        "照片文件": _str_to_list(row.get("照片文件")),
        "录入时间": str(row.get("录入时间", "")).strip(),
    }


def _item_from_form(form_data):
    """把表单 collect_condition_data() 拼出来的 dict 转成标准 JSON item。
    form_data 里多选字段已经是 list[str]（InputForm 已改）。"""
    return {
        "序号": _int_or_zero(form_data.get("序号")),
        "型号": str(form_data.get("型号", "")).strip(),
        "数量": _int_or_zero(form_data.get("数量", "1")) or 1,
        "参考价": str(form_data.get("参考价", "")).strip(),
        "拆封状态": str(form_data.get("拆封状态", "")).strip(),
        "外盒状态": _str_to_list(form_data.get("外盒状态")),
        "外盒其他": str(form_data.get("外盒其他", "")).strip(),
        "本体状态": _str_to_list(form_data.get("本体状态")),
        "本体其他": str(form_data.get("本体其他", "")).strip(),
        "配件状态": _str_to_list(form_data.get("配件状态")),
        "配件其他": str(form_data.get("配件其他", "")).strip(),
        "其他瑕疵或说明": str(form_data.get("其他瑕疵或说明", "")).strip(),
        "照片文件": _str_to_list(form_data.get("照片文件")),
        "录入时间": str(form_data.get("录入时间", "")).strip(),
    }


def _save_json(list_name, items):
    """写 JSON 文件（原子写：先 .tmp 再 replace，防中途断电坏文件）"""
    json_path = get_json_path(list_name)
    data = {
        "清单名": list_name,
        "版本": STORAGE_VERSION,
        "items": items,
    }
    tmp = json_path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, json_path)
    print(f"[JSON] ✅ 已保存 {len(items)} 条 → {json_path}")


def _load_json(list_name):
    """读 JSON 文件，返回 items 列表。文件不存在或损坏返回 None。"""
    json_path = get_json_path(list_name)
    if not os.path.exists(json_path):
        return None
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        items = data.get("items", [])
        print(f"[JSON] 读入 {len(items)} 条 ← {json_path}")
        return items
    except Exception as e:
        print(f"[JSON] ❌ 读取失败: {e}")
        import traceback; traceback.print_exc()
        return None


def _migrate_csv_to_json(list_name):
    """旧 CSV 自动迁移 → JSON。只在 init_json 时发现 JSON 不存在但 CSV 存在时触发。
    
    流程：
    1. 先调用 CSV 修复函数（处理历史坏数据）
    2. 用 csv.DictReader 读
    3. 每行转成 JSON item（多选字段从 "a|b" → ["a","b"]）
    4. 写 JSON，CSV 留着不删（用户备份用）
    """
    csv_path = get_csv_path(list_name)
    if not os.path.exists(csv_path):
        print(f"[迁移] 没有旧 CSV，跳过")
        return None

    print(f"[迁移] 发现旧 CSV → 尝试迁移")
    
    # 先跑两层 CSV 修复（以防坏数据）
    _try_fix_broken_csv(csv_path, CSV_HEADERS)
    _fix_misaligned_rows(csv_path, CSV_HEADERS)

    # 读修复后的 CSV
    items = []
    try:
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                cleaned = {k.lstrip('\ufeff') if k else k: v for k, v in row.items()}
                items.append(_item_from_csv_row(cleaned))
    except Exception as e:
        print(f"[迁移] ❌ 读 CSV 失败: {e}")
        import traceback; traceback.print_exc()
        return None

    if not items:
        print(f"[迁移] CSV 里是空的，不写 JSON")
        return None

    # 写 JSON
    _save_json(list_name, items)
    print(f"[迁移] ✅ {len(items)} 条已从 CSV 迁到 JSON（旧 CSV 保留未删除）")
    return items


def init_json(list_name):
    """初始化 JSON 主存储文件。
    - JSON 已存在 → 直接返回路径
    - JSON 不存在但 CSV 存在 → 自动迁移
    - 都不存在 → 新建空 JSON
    """
    json_path = get_json_path(list_name)
    
    if os.path.exists(json_path):
        print(f"[JSON] 已存在 → {json_path}")
        return json_path
    
    # 尝试迁移旧 CSV
    migrated = _migrate_csv_to_json(list_name)
    if migrated is not None:
        return json_path  # 迁移时已经写好了
    
    # 全新清单
    _save_json(list_name, [])
    return json_path


# ============ 兼容层：保留旧 CSV 初始化函数（迁移时会被上面调用） ============
# 下面两个函数只在迁移 / 极端兜底时用，正常运行不再调用
def _legacy_init_csv(list_name):
    """仅用于迁移时确保 CSV 文件存在（可能已被上面的修复函数处理）"""
    csv_path = get_csv_path(list_name)
    if not os.path.exists(csv_path):
        headers = CSV_HEADERS
        with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f, lineterminator='\n')
            w.writerow(headers)
    return csv_path


def _try_fix_broken_csv(csv_path, headers):
    """当 CSV 只有一行（无换行、两条数据之间也无分隔符）时，自动修复
    
    根因：之前 lineterminator='' 把 CSV 搞成 header+所有数据 粘成一行，
    两条数据的交接处变成 "2026-10-21 09:002"（录入时间+序号粘在一起）。
    修复：先用 csv.reader 粗解析，再把 "时间戳+序号" 粘在一起的值拆回去，
    最后按 header 列数切出每一行。
    """
    import re
    try:
        with open(csv_path, 'rb') as f:
            raw = f.read()
        if raw.startswith(b'\xef\xbb\xbf'):
            raw = raw[3:]
        # 已经有换行 → 不是 broken CSV，跳过
        if b'\n' in raw or b'\r' in raw:
            return False
        # 必须包含 "序号" 才是有效 CSV
        if b'\xe5\xba\x8f\xe5\x8f\xb7' not in raw:
            return False

        text = raw.decode('utf-8', errors='replace')
        header_str = ','.join(headers)
        if not text.startswith(header_str):
            return False

        data_part = text[len(header_str):]
        if not data_part.strip():
            return False

        # Step 1: csv.reader 粗暴解析（会把粘在一起的时间戳+序号当成一个值）
        all_values = next(csv.reader([data_part]))
        print(f"[CSV修复] csv.reader 解析出 {len(all_values)} 个原始值")

        # Step 2: 拆分 "时间戳+序号" 粘在一起的值
        # 录入时间格式：YYYY-MM-DD HH:MM[:SS]；序号是纯数字
        ts_pattern = re.compile(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)(\d+)$')
        fixed_values = []
        split_count = 0
        for v in all_values:
            m = ts_pattern.match(v)
            if m:
                fixed_values.append(m.group(1))  # 时间戳
                fixed_values.append(m.group(2))  # 序号
                split_count += 1
                print(f"  拆分: {repr(v)} → {repr(m.group(1))} + {repr(m.group(2))}")
            else:
                fixed_values.append(v)

        if split_count == 0:
            # 没有粘在一起的值，那直接切行就行
            pass

        # Step 3: 补齐到 header 列数的倍数
        n_cols = len(headers)
        while len(fixed_values) % n_cols != 0:
            fixed_values.append('')

        # Step 4: 按 n_cols 切行
        rows = []
        for i in range(0, len(fixed_values), n_cols):
            chunk = fixed_values[i:i + n_cols]
            if any(v.strip() for v in chunk):
                rows.append(chunk)

        if not rows:
            return False

        print(f"[CSV修复] 检测到坏 CSV，修复 {split_count} 处粘连，切出 {len(rows)} 条数据")

        # Step 5: 写回正确格式
        tmp_path = csv_path + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f, lineterminator='\n')
            w.writerow(headers)
            for row in rows:
                w.writerow(row)
        os.replace(tmp_path, csv_path)
        print(f"[CSV修复] ✅ 已修复")
        return True
    except Exception as e:
        print(f"[CSV修复] ❌ 尝试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def _fix_misaligned_rows(csv_path, headers):
    """当 CSV 有换行但字段错位/含裸换行时，用时间戳锚点逆向切分恢复。
    
    根因（多种）：
    1. 历史 lineterminator='' 时期搞坏的无换行 CSV → 第一层修
    2. 字段值里有裸换行（用户用文件 App 打开编辑，破坏了 csv.writer 加的引号）
       → csv.reader 会把一条记录拆成多行，每行列数不一致
    3. 时间戳+序号粘在一起（如 "2026-10-21 09:002"）
    
    修复策略：
    - 录入时间列（最后一列）是唯一锚点：每条记录有且只有一个
    - 逆向扫描时间戳，从后往前用 N_COLS 个值切一条记录
    - 锚点之间值多了 → 多余的合并进「其他瑕疵或说明」列（数据不丢）
    - 锚点之间值少了 → 补空
    - 写回时主动清洗所有字段里的换行符
    """
    import re
    try:
        n_cols = len(headers)
        ts_seq_pattern = re.compile(
            r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)(\d+)$')
        ts_pattern = re.compile(
            r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$')

        # Step 1: csv.reader 平铺所有值
        all_values = []
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.reader(f)
            for i, row in enumerate(reader):
                if i == 0:
                    continue
                for v in row:
                    all_values.append(v.strip())

        if not all_values:
            return False

        print(f"[CSV修复-2] 收集到 {len(all_values)} 个原始值")

        # Step 2: 拆分 "时间戳+序号" 粘在一起的值
        fixed = []
        split_count = 0
        for v in all_values:
            m = ts_seq_pattern.match(v)
            if m:
                fixed.append(m.group(1))
                fixed.append(m.group(2))
                split_count += 1
            else:
                fixed.append(v)
        all_values = fixed
        print(f"[CSV修复-2] 拆分 {split_count} 处时间戳粘连")

        # Step 3: 找所有时间戳锚点在值列表中的索引
        ts_indices = [i for i, v in enumerate(all_values) if ts_pattern.match(v)]
        if len(ts_indices) == 0:
            print("[CSV修复-2] ❌ 没有时间戳锚点，无法修复")
            return False
        print(f"[CSV修复-2] 找到 {len(ts_indices)} 个录入时间锚点")

        n_rows = len(ts_indices)
        ideal_total = n_rows * n_cols
        extra_count = len(all_values) - ideal_total
        print(f"[CSV修复-2] 理想值数={ideal_total}, 实际={len(all_values)}, 多余={extra_count}")

        # Step 4: 逆向遍历每个时间戳，切出 N_COLS 个值
        rows = []
        pos = 0  # 当前处理到 all_values 的位置
        
        for ts_idx in ts_indices:
            # 这条记录应该从 pos 开始，到 ts_idx（含）结束
            expected_end = pos + n_cols
            actual_end = ts_idx + 1  # 包含 ts_idx 本身
            
            if actual_end == expected_end:
                # 完美对齐：正好 n_cols 个值
                row_vals = all_values[pos:actual_end]
            elif actual_end < expected_end:
                # 时间戳位置比预期早 —— 前面有空洞，补空在前面
                row_vals = [''] * (expected_end - actual_end) + all_values[pos:actual_end]
            else:
                # actual_end > expected_end —— 中间有多余值（裸换行拆开的字段）
                # 把多余的值合并进「其他瑕疵或说明」列（索引 11）
                chunk = all_values[pos:actual_end]
                last_two = chunk[-2:]  # 最后两个：照片文件、录入时间
                front = chunk[:-2]     # 前面的所有值
                # 前 11 个是正常列（序号 ~ 配件其他），后面的合并进「其他瑕疵或说明」
                normal = front[:11]
                rest = front[11:]  # 多余的值 → 合并
                merged_other = ' '.join(v for v in rest if v)
                # 补齐 normal 到 11 个（防止实际少了）
                while len(normal) < 11:
                    normal.append('')
                row_vals = normal + [merged_other] + last_two
            
            # 保险：如果 row_vals 长度不对，强制截断/补齐
            if len(row_vals) > n_cols:
                row_vals = row_vals[-n_cols:]
            while len(row_vals) < n_cols:
                row_vals.append('')
            
            rows.append(row_vals)
            pos = actual_end

        print(f"[CSV修复-2] 切出 {len(rows)} 条完整记录")

        # Step 5: 写回（主动清洗所有字段的换行符）
        tmp_path = csv_path + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f, lineterminator='\n')
            w.writerow(headers)
            for row in rows:
                clean = [_sanitize_field(v) for v in row]
                w.writerow(clean)
        os.replace(tmp_path, csv_path)
        print(f"[CSV修复-2] ✅ 已修复，写回 {len(rows)} 条记录")
        return True
    except Exception as e:
        print(f"[CSV修复-2] ❌ 失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def read_all_items(list_name):
    """读清单。优先走 JSON 主存储；JSON 不存在自动从旧 CSV 迁移。
    返回 list[dict]，每条 dict 的多选字段都是 list[str]（不是 CSV 的 "a|b" 字符串）。
    """
    # 触发迁移（JSON 不存在但 CSV 存在时自动迁）
    init_json(list_name)

    items = _load_json(list_name)
    if items is None:
        print(f"[读JSON] ❌ 文件不存在或损坏，返回空列表")
        items = []
    
    # 保险：每条都强制标准化（防损坏/老版本字段）
    normalized = []
    for it in items:
        if not isinstance(it, dict):
            continue
        normalized.append({
            "序号": _int_or_zero(it.get("序号")),
            "型号": str(it.get("型号", "")).strip(),
            "数量": _int_or_zero(it.get("数量", "1")) or 1,
            "参考价": str(it.get("参考价", "")).strip(),
            "拆封状态": str(it.get("拆封状态", "")).strip(),
            "外盒状态": _str_to_list(it.get("外盒状态")),
            "外盒其他": str(it.get("外盒其他", "")).strip(),
            "本体状态": _str_to_list(it.get("本体状态")),
            "本体其他": str(it.get("本体其他", "")).strip(),
            "配件状态": _str_to_list(it.get("配件状态")),
            "配件其他": str(it.get("配件其他", "")).strip(),
            "其他瑕疵或说明": str(it.get("其他瑕疵或说明", "")).strip(),
            "照片文件": _str_to_list(it.get("照片文件")),
            "录入时间": str(it.get("录入时间", "")).strip(),
        })
    
    print(f"[读JSON] ✅ {len(normalized)} 条有效记录")
    return normalized


def get_next_sequence(list_name):
    items = read_all_items(list_name)
    if not items:
        return 1
    max_seq = 0
    for item in items:
        seq = _int_or_zero(item.get("序号"))
        if seq > max_seq:
            max_seq = seq
    return max_seq + 1


def check_duplicate_seq(list_name, seq_num):
    target = _int_or_zero(seq_num)
    items = read_all_items(list_name)
    return any(_int_or_zero(it.get("序号")) == target for it in items)


def append_item_to_csv(list_name, item_data):
    """追加一条新记录到 JSON。item_data 是 InputForm.collect_condition_data() 的结果。"""
    # 初始化 + 自动迁移
    init_json(list_name)
    
    items = read_all_items(list_name)
    
    # 构建标准 item
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    item = _item_from_form(item_data)
    if not item.get("录入时间"):
        item["录入时间"] = now_str
    
    items.append(item)
    _save_json(list_name, items)
    print(f"[保存] ✅ 已追加 序={item['序号']} 型={item['型号']}")
    return True


# CSV_HEADERS 常量保留 —— 迁移函数 _try_fix_broken_csv 和 _fix_misaligned_rows 用
CSV_HEADERS = [
    "序号", "型号", "数量", "参考价",
    "拆封状态", "外盒状态", "外盒其他",
    "本体状态", "本体其他",
    "配件状态", "配件其他",
    "其他瑕疵或说明", "照片文件", "录入时间"
]


def update_item_in_csv(list_name, seq, item_data):
    """按序号更新 JSON 中已有的记录。函数名保留旧名只是为了 InputForm.on_save 调用不变。"""
    init_json(list_name)
    target_seq = _int_or_zero(seq)
    items = read_all_items(list_name)
    found = False
    
    for i, it in enumerate(items):
        if _int_or_zero(it.get("序号")) == target_seq:
            # 用表单数据覆盖
            new_item = _item_from_form(item_data)
            # 保留原有录入时间（如果表单没给新的）
            if not new_item.get("录入时间"):
                new_item["录入时间"] = it.get("录入时间") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            items[i] = new_item
            found = True
            break
    
    if not found:
        print(f"[更新] ❌ 没找到序号 {seq}")
        return False
    
    _save_json(list_name, items)
    print(f"[更新] ✅ 序号 {seq} 已更新")
    return True


def sanitize_filename(name):
    invalid = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
    for ch in invalid:
        name = name.replace(ch, '_')
    return name.strip()


# ============ 拍照功能（简化版，确保 Pythonista 兼容） ============
def take_photos(list_name, seq, model):
    """多角度拍照，文件名：型号-N.jpg"""
    folder = get_list_folder(list_name)
    photo_paths = []
    safe_model = sanitize_filename(model) if model else "未知型号"

    # 扫描已有同型号图片，从最大序号+1 开始（避免覆盖）
    import re as _re
    angle = 1
    try:
        existing = os.listdir(folder) if os.path.exists(folder) else []
        pat = _re.compile(rf'^{_re.escape(safe_model)}-(\d+)\.jpg$')
        max_n = 0
        for fn in existing:
            m = pat.match(fn)
            if m:
                max_n = max(max_n, int(m.group(1)))
        angle = max_n + 1
        if max_n > 0:
            print(f"[拍照] 已有 {max_n} 张，从 -{angle}.jpg 开始")
    except Exception as e:
        print(f"[拍照] 扫描旧文件失败: {e}")

    # 第一次提示来源
    choice = dialogs.list_dialog(
        "添加照片",
        ["📷 调用相机拍照", "🖼️ 从相册选图"]
    )
    if choice is None:
        return photo_paths

    while True:
        img = None

        if "相机" in choice:
            # 相机 — Pythonista 正确 API：photos.capture_image()
            try:
                img = photos.capture_image()
            except Exception as e:
                print(f"[拍照] 相机不可用: {e}, 尝试相册...")
                try:
                    img = photos.pick_image(show_albums=True)
                except Exception as e2:
                    print(f"[拍照] 相册也不可用: {e2}")

        elif "相册" in choice:
            # 相册
            try:
                img = photos.pick_image(show_albums=True)
            except Exception as e:
                print(f"[拍照] 相册选择失败: {e}")

        if img is None:
            if photo_paths:
                break
            else:
                return photo_paths

        # 保存图片（用 PIL Image 标准方式）
        filename = f"{safe_model}-{angle}.jpg"
        filepath = os.path.join(folder, filename)
        print(f"[拍照] 保存: {filepath}")

        try:
            # Pythonista photos / camera 返回的都是 PIL Image
            # 但不能用 quality 关键字（Pythonista PIL 版本老）
            if hasattr(img, 'save'):
                # 先转 RGB（处理可能带 alpha 的 RGBA）
                try:
                    rgb_img = img.convert('RGB')
                    rgb_img.save(filepath, 'JPEG')
                except Exception:
                    # 兜底直接保存
                    img.save(filepath)
            else:
                dialogs.alert("错误", "无法保存图片对象")
                angle -= 1

            if os.path.exists(filepath):
                print(f"[拍照] ✅ 已保存 {os.path.getsize(filepath)} 字节")
                photo_paths.append(filename)
                angle += 1
            else:
                print("[拍照] 文件没生成")

            # console.alert 返回: button1=继续(1), button2=完成(2)
            result = dialogs.alert("拍照", f"已保存 {filename}\n继续拍？", "继续", "完成", hide_cancel_button=True)
            if result == 2:  # button2 = 完成
                break

        except Exception as e:
            print(f"[拍照] 保存异常: {e}")
            import traceback
            traceback.print_exc()
            dialogs.alert("保存图片失败", str(e))
            break

    return photo_paths


def sort_items_by_model(list_name):
    """按型号自然排序，重编序号，写回 JSON"""
    import re
    init_json(list_name)
    items = read_all_items(list_name)
    if len(items) < 2:
        return 0  # 无需排序

    def natural_key(s):
        """自然排序键：数字段按数值比，字符串段按字典序"""
        s = str(s or "")
        parts = re.split(r'(\d+)', s)
        return [int(p) if p.isdigit() else p.lower() for p in parts]

    items.sort(key=lambda r: natural_key(r.get("型号", "")))

    # 重编序号（int 类型）
    for i, row in enumerate(items, 1):
        row["序号"] = i

    _save_json(list_name, items)
    print(f"[排序] ✅ 按型号排序完成，共 {len(items)} 项，序号重编为 1..{len(items)}")
    return len(items)


# ============ 主界面 ============
class MainViewController(ui.View):
    """主控制界面"""

    def __init__(self):
        super().__init__()
        self.current_list_name = None
        self._app_ready = False
        self.setup_ui()

    def setup_ui(self):
        self.background_color = '#f2f2f7'

        self.title_label = ui.Label()
        self.title_label.text = "玩具寄售清单"
        self.title_label.font = ('Helvetica-Bold', 22)
        self.title_label.text_alignment = ui.ALIGN_CENTER
        self.title_label.text_color = '#1a1a1a'
        self.add_subview(self.title_label)

        self.list_name_label = ui.Label()
        self.list_name_label.text = "点击下方按钮新建或打开清单"
        self.list_name_label.font = ('Helvetica', 14)
        self.list_name_label.text_alignment = ui.ALIGN_CENTER
        self.list_name_label.text_color = '#666'
        self.list_name_label.number_of_lines = 0
        self.add_subview(self.list_name_label)

        # 第一行小按钮: 直接用 Button.title（Button 默认居中渲染）
        self.btn_new_list = ui.Button()
        self.btn_new_list.title = "📋 新建清单"
        self.btn_new_list.font = ('Helvetica', 17)
        self.btn_new_list.tint_color = 'white'
        self.btn_new_list.background_color = '#007aff'
        self.btn_new_list.corner_radius = 10
        self.btn_new_list.height = 50
        self.btn_new_list.action = self.on_new_list
        self.add_subview(self.btn_new_list)

        self.btn_open_list = ui.Button()
        self.btn_open_list.title = "📂 打开清单"
        self.btn_open_list.font = ('Helvetica', 17)
        self.btn_open_list.tint_color = 'white'
        self.btn_open_list.background_color = '#007aff'
        self.btn_open_list.corner_radius = 10
        self.btn_open_list.height = 50
        self.btn_open_list.action = self.on_switch_list
        self.add_subview(self.btn_open_list)

        self.btn_add = self.make_button("➕ 添加玩具信息", '#34c759')
        self.btn_add.action = self.on_add_item
        self.add_subview(self.btn_add)

        self.btn_view = self.make_button("📄 查看当前清单", '#ff9500')
        self.btn_view.action = self.on_view_list
        self.add_subview(self.btn_view)

        self.btn_sort = self.make_button("🔀 按型号排序", '#ff6b00')
        self.btn_sort.action = self.on_sort_items
        self.add_subview(self.btn_sort)

        self.btn_export = self.make_button("📤 导出清单", '#5856d6')
        self.btn_export.action = self.on_export
        self.add_subview(self.btn_export)

        self.btn_show_folder = self.make_button("📂 打开文件夹位置", '#4caf50')
        self.btn_show_folder.action = self.on_show_folder
        self.add_subview(self.btn_show_folder)

        self.stats_label = ui.Label()
        self.stats_label.text = ""
        self.stats_label.font = ('Helvetica', 12)
        self.stats_label.text_alignment = ui.ALIGN_CENTER
        self.stats_label.text_color = '#888'
        self.stats_label.number_of_lines = 0
        self.add_subview(self.stats_label)

    def make_button(self, title, color, left_pad=True):
        """
        创建按钮: ui.Button 壳 + 左对齐 ui.Label 子视图
        - Label 左对齐 + 4 个全角空格前缀（= 4 个中文字宽），emoji 起始位置统一
        - left_pad=True  → 加前缀空格（第二行起大按钮）
        - left_pad=False → 不加前缀（第一行并排小按钮）
        """
        btn = ui.Button()
        btn.title = ""
        btn.background_color = color
        btn.corner_radius = 10
        btn.height = 50
        # Label 子视图
        lbl = ui.Label()
        # 4 个全角空格前缀（U+3000）= 4 个中文字宽度
        lbl.text = ('　　　　　' if left_pad else '') + title
        lbl.font = ('Helvetica', 17)
        lbl.text_color = 'white'
        lbl.text_alignment = ui.ALIGN_LEFT
        btn.add_subview(lbl)
        btn._label = lbl
        return btn

    def layout(self):
        w = self.width
        self.title_label.frame = (20, 60, w - 40, 40)
        self.list_name_label.frame = (20, 105, w - 40, 40)

        # 第一行：两个按钮并排，总宽 = btn_w（跟下面按钮左右对齐）
        btn_w = min(w - 40, 320)
        x = (w - btn_w) / 2
        half_w = (btn_w - 10) / 2    # 中间 10pt gap
        self.btn_new_list.frame  = (x,            155, half_w, 50)
        self.btn_open_list.frame = (x + half_w + 10, 155, half_w, 50)


        # 第二行起：单个全宽按钮
        btn_w = min(w - 40, 320)
        x = (w - btn_w) / 2
        self.btn_add.frame        = (x, 220, btn_w, 50)
        self.btn_view.frame       = (x, 285, btn_w, 50)
        self.btn_sort.frame       = (x, 350, btn_w, 50)
        self.btn_export.frame     = (x, 415, btn_w, 50)
        self.btn_show_folder.frame = (x, 480, btn_w, 50)
        # 同步 label frame
        for b in (self.btn_add, self.btn_view, self.btn_sort,
                  self.btn_export, self.btn_show_folder):
            if hasattr(b, '_label') and hasattr(b, 'width'):
                b._label.frame = (0, 0, b.width, b.height)
        self.stats_label.frame = (20, 545, w - 40, 140)



    def on_view_appear(self):
        """主视图显示后再让 dialog 弹出，避免界面卡住"""
        if not self._app_ready:
            self._app_ready = True
            ui.delay(0.2, self.load_initial_list)

    def load_initial_list(self):
        cfg = load_config()
        last_list = cfg.get("last_list")
        if last_list:
            # 验证文件夹确实存在
            list_folder = os.path.join(get_script_dir(), last_list)
            if os.path.exists(list_folder):
                self.current_list_name = last_list
                self.update_info()
                return
        # 首次使用，提示创建
        self.on_new_list()

    def update_info(self):
        if self.current_list_name:
            folder = get_list_folder(self.current_list_name)
            json_path = get_json_path(self.current_list_name)
            items = read_all_items(self.current_list_name)
            self.list_name_label.text = f"当前清单：{self.current_list_name}"
            # 显示详细状态和路径
            base = os.path.expanduser("~")
            folder_short = folder.replace(base, "~")
            self.stats_label.text = (
                f"📂 共 {len(items)} 项\n"
                f"📄 {folder_short}/寄售清单.json\n"
                f"📸 {folder_short}/\n\n"
                f"完整路径: {folder}"
            )
            print(f"[主界面] 当前清单: {self.current_list_name}, 项目数: {len(items)}")
            print(f"[主界面] 子文件夹: {folder}, 存在: {os.path.exists(folder)}")
        else:
            self.list_name_label.text = "点击下方按钮新建或打开清单"
            self.stats_label.text = ""

    def on_choose_or_switch(self, sender=None):
        """新建 or 切换 — console.alert 返回: button1=1, button2=2"""
        btn = dialogs.alert("清单操作", "选择要做什么？", "新建清单", "切换清单", hide_cancel_button=True)
        if btn == 1:
            self.on_new_list()
        elif btn == 2:
            self.on_switch_list()

    def on_new_list(self, sender=None):
        text = dialogs.input_alert("新建清单", "请输入清单名称：", "例如：2026年10月寄售")
        if text and text.strip():
            list_name = sanitize_filename(text.strip())
            print(f"[新建] 清单名: {list_name}")
            self.current_list_name = list_name

            # 创建文件夹
            folder = get_list_folder(list_name)
            print(f"[新建] 文件夹: {folder}, 存在: {os.path.exists(folder)}")

            # 创建 JSON 存储（空文件）
            json_path = init_json(list_name)
            print(f"[新建] JSON: {json_path}, 存在: {os.path.exists(json_path)}")

            save_config({"last_list": list_name})
            self.update_info()
            folder = get_list_folder(list_name)
            dialogs.alert("成功", f"已创建清单：\n{list_name}\n\n📁 {folder}")

    def on_switch_list(self, sender=None):
        base = get_script_dir()
        folders = [d for d in os.listdir(base)
                   if os.path.isdir(os.path.join(base, d)) and not d.startswith('.')]
        if not folders:
            dialogs.alert("提示", "暂无已有清单，先新建一个吧")
            self.on_new_list()
            return
        selected = dialogs.list_dialog("选择清单", folders)
        if selected is not None:
            self.current_list_name = selected
            save_config({"last_list": self.current_list_name})
            self.update_info()

    def on_add_item(self, sender=None):
        if not self.current_list_name:
            dialogs.alert("提示", "请先新建或选择一个清单")
            return
        seq = get_next_sequence(self.current_list_name)
        InputForm.open(self.current_list_name, seq, parent=self)

    def on_view_list(self, sender=None):
        if not self.current_list_name:
            dialogs.alert("提示", "请先选择清单")
            return
        ListViewer.open(self.current_list_name)

    def on_sort_items(self, sender=None):
        """按型号排序 + 重编序号"""
        if not self.current_list_name:
            dialogs.alert("提示", "请先新建或选择一个清单")
            return
        items = read_all_items(self.current_list_name)
        if len(items) < 2:
            dialogs.alert("提示", "只有 1 项，无需排序")
            return
        confirm = dialogs.alert(
            "🔀 按型号排序",
            f"共 {len(items)} 项，将按型号自然排序并重新编号。\n此操作不可撤销。",
            "取消", "确认排序", hide_cancel_button=False
        )
        if confirm == 2:
            try:
                n = sort_items_by_model(self.current_list_name)
                dialogs.alert("✅ 排序完成", f"已排序 {n} 项，序号重编为 1..{n}")
                self.update_info()
            except Exception as e:
                import traceback; traceback.print_exc()
                dialogs.alert("❌ 排序失败", str(e))


    def on_export(self, sender=None):
        if not self.current_list_name:
            dialogs.alert("提示", "请先选择清单")
            return
        choice = dialogs.list_dialog("选择导出格式", ["📄 CSV 表格", "📝 Word 文档 (.rtf)", "📕 PDF 文档"])
        if choice is None:
            return
        items = read_all_items(self.current_list_name)
        folder = get_list_folder(self.current_list_name)
        os.makedirs(folder, exist_ok=True)
        safe = self.current_list_name.replace("/", "_").replace("\\", "_")
        try:
            import share as _share
        except Exception:
            _share = None
        if "CSV" in choice:
            # 从 JSON items 生成一个临时 CSV 文件再分享
            csv_path = os.path.join(folder, safe + '_清单.csv')
            with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
                w = csv.writer(f, lineterminator='\n')
                w.writerow(CSV_HEADERS)
                for it in items:
                    row = [
                        it.get("序号", ""),
                        it.get("型号", ""),
                        it.get("数量", ""),
                        it.get("参考价", ""),
                        it.get("拆封状态", ""),
                        "|".join(_str_to_list(it.get("外盒状态"))),
                        it.get("外盒其他", ""),
                        "|".join(_str_to_list(it.get("本体状态"))),
                        it.get("本体其他", ""),
                        "|".join(_str_to_list(it.get("配件状态"))),
                        it.get("配件其他", ""),
                        it.get("其他瑕疵或说明", ""),
                        ";".join(_str_to_list(it.get("照片文件"))),
                        it.get("录入时间", ""),
                    ]
                    w.writerow(row)
            _share.share_file(csv_path) if _share else dialogs.alert("CSV 已生成", csv_path)
        elif "Word" in choice:
            self._export_rtf(folder, safe, items, _share)
        elif "PDF" in choice:
            self._export_pdf(folder, safe, items, _share)

    @staticmethod
    def _fmt_size(n):
        """字节数 → 人类可读"""
        if n < 1024: return f"{n} B"
        if n < 1024*1024: return f"{n/1024:.1f} KB"
        return f"{n/1024/1024:.1f} MB"

    def on_show_folder(self, sender=None):
        """显示文件夹位置（精简版）"""
        if not self.current_list_name:
            dialogs.alert("提示", "请先选择清单")
            return
        folder = get_list_folder(self.current_list_name)
        json_path = get_json_path(self.current_list_name)
        list_name = self.current_list_name  # e.g. "例如：2026年10月寄售"
        # 路径缩短: /private/var/...  →  ~/Documents/玩具寄售/例如：2026年10月寄售
        short_folder = folder.replace(os.path.expanduser("~"), "~")
        # 如果路径里还有"玩具寄售/"前缀再简化
        # 分组: 导出文件 vs 图片
        exports = []   # CSV, RTF, PDF, HTML
        images = []    # jpg, png, heic
        other = []
        try:
            for fname in sorted(os.listdir(folder)):
                fp = os.path.join(folder, fname)
                size = self._fmt_size(os.path.getsize(fp))
                ext = os.path.splitext(fname)[1].lower()
                # 去掉冗余前缀 (文件名 = 清单名_类型.ext)
                display = fname
                prefix = list_name + "_"
                if display.startswith(prefix):
                    display = display[len(prefix):]
                # 主存储的 .json 显示在上面，不放到 exports 分组
                if display == JSON_FILENAME:
                    continue
                if ext in ('.csv', '.rtf', '.pdf', '.html', '.htm', '.doc', '.docx'):
                    exports.append(f"  {display}  ({size})")
                elif ext in ('.jpg', '.jpeg', '.png', '.heic', '.gif'):
                    images.append(f"  {display}  ({size})")
                else:
                    other.append(f"  {display}  ({size})")
        except Exception as e:
            dialogs.alert("错误", f"读取文件夹失败: {e}")
            return
        parts = []
        parts.append(f"📁 {short_folder}")
        parts.append(f"")
        parts.append(f"📄 JSON 主存储：{'✅' if os.path.exists(json_path) else '❌'}")
        if exports:
            parts.append(f"")
            parts.append(f"📊 导出文件 ({len(exports)}):")
            parts.extend(exports)
        if images:
            parts.append(f"")
            parts.append(f"📷 交接照片 ({len(images)}):")
            parts.extend(images)
        if other:
            parts.append(f"")
            parts.append(f"📦 其他 ({len(other)}):")
            parts.extend(other)
        if not exports and not images and not other:
            parts.append(f"")
            parts.append("(文件夹是空的)")
        # 加完整路径方便定位（折叠在下方）
        parts.append("")
        parts.append(f"── 完整路径 ──")
        parts.append(folder)
        self._show_folder_popup("📂 文件夹内容", "\n".join(parts))

    def _show_folder_popup(self, title, body):
        """自定义弹窗: 标题居中, 内容左对齐"""
        import ui
        # 遮罩层 (半透明黑)
        mask = ui.View(frame=(0, 0, ui.get_screen_size().width, ui.get_screen_size().height))
        mask.background_color = (0, 0, 0, 0.45)
        mask.flex = 'WH'
        # 卡片
        card = ui.View()
        card.corner_radius = 14
        card.background_color = (1, 1, 1, 1)
        # 标题
        lb = ui.Label()
        lb.text = title
        lb.text_color = '#333333'
        lb.font = ('Helvetica-Bold', 17)
        lb.alignment = ui.ALIGN_CENTER  # 居中
        # 内容
        tv = ui.TextView()
        tv.text = body
        tv.editable = False
        tv.selectable = True
        tv.text_color = '#222222'
        tv.font = ('Menlo', 13)
        tv.alignment = ui.ALIGN_LEFT   # 左对齐
        tv.background_color = (0, 0, 0, 0)
        # 关闭按钮
        close = ui.Button()
        close.title = "关闭"
        close.tint_color = '#007aff'
        close.action = lambda s: mask.close()
        # 布局
        card.add_subview(lb)
        card.add_subview(tv)
        card.add_subview(close)
        mask.add_subview(card)
        def layout():
            w, h = ui.get_screen_size()
            # 卡片尺寸
            cw = min(340, w - 48)
            ch = min(480, h - 120)
            cx = (w - cw) / 2
            cy = (h - ch) / 2
            card.frame = (cx, cy, cw, ch)
            # 标题
            lb.frame = (16, 14, cw - 32, 28)
            # 内容区
            tv.frame = (16, 48, cw - 32, ch - 100)
            # 关闭按钮
            btn_h = 44
            close.frame = (16, ch - btn_h - 8, cw - 32, btn_h)
        mask.present('sheet')
        layout()
    def _export_rtf(self, folder, safe, items, _share):
        """导出 .rtf 格式（Pages/Word/WPS 全原生支持，零依赖）"""
        R = []
        R.append(r'{\rtf1\ansi\ansicpg936\deff0')
        R.append(r'{\fonttbl{\f0\fnil\fcharset134 SimSun;}}')
        R.append(r'\viewkind4\uc1')
        R.append(r'\pard\qc\fs32 附件：寄售玩具清单\par')
        R.append(r'\pard\qc\fs20\cf80（本清单一式两份，双方各执一份；随附交接照片和视频）\par')
        R.append('\\pard\\qc\\fs26\\cf18 清单：' + self.current_list_name + '\\par')
        R.append(r'\par')
        R.append(r'\trowd\trgaph108')
        R.append(r'\cellx850\cellx2211\cellx3062\cellx4414\cellx9866')
        R.append(r'\ql\b 序号\cell')
        R.append(r'\ql\b 型号\cell')
        R.append(r'\ql\b 数量\cell')
        R.append(r'\qr\b 参考价\cell')
        R.append(r'\ql\b 盒况备注\cell')
        R.append(r'\row')
        for it in items:
            cp = []
            if it.get("拆封状态"): cp.append(it["拆封状态"])
            if it.get("外盒状态"): cp.append("盒:"+"、".join(_str_to_list(it.get("外盒状态"))))
            if it.get("本体状态"): cp.append("本:"+"、".join(_str_to_list(it.get("本体状态"))))
            cond = " ".join(cp)
            R.append('\\ql ' + str(it.get("序号","")) + '\\cell')
            R.append('\\ql ' + str(it.get("型号","")) + '\\cell')
            R.append('\\ql ' + str(it.get("数量","")) + '\\cell')
            R.append('\\qr ' + str(it.get("参考价","")) + '\\cell')
            R.append('\\ql ' + cond + '\\cell')
            R.append(r'\row')
        R.append(r'\pard\sa480\fs20 双方签字确认：________________________\par')
        R.append(r'}')
        out_path = os.path.join(folder, safe + '_清单.rtf')
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(''.join(R))
        _share.share_file(out_path) if _share else dialogs.alert("Word 已导出 (.rtf)", out_path)

    # ============ 导出 PDF（iOS WebView 优先，reportlab 兜底）============
    # iOS 上 reportlab 从 PingFang/STHeiti .ttc 加载数字的 advance width 度量有 bug，
    # 导致多位数型号（如 60011、10181）数字互相重叠 —— 所以用 iOS 系统自己的
    # WKWebView 渲染 → PDF 才是正解，reportlab 只在非 iOS 环境或 WebView 不可用时使用。

    def _build_pdf_html(self, items):
        """生成清单 PDF 的 HTML 源码（WKWebView 和 reportlab 兜底都复用）"""
        import html as _hm
        # 序号/型号/数量 居中，参考价 右对齐，盒况备注 左对齐
        th = (
            '<table border="1" cellspacing="0" cellpadding="6" '
            'style="border-collapse:collapse;width:100%;'
            'font-size:11pt;font-family:PingFang SC,Helvetica,sans-serif;">'
            '<tr bgcolor="#f0f0f0">'
            '<th align="center">序号</th><th align="center">型号</th>'
            '<th align="center">数量</th><th align="center">参考价</th>'
            '<th align="center">盒况备注</th></tr>'
        )
        for it in items:
            cp = []
            if it.get("拆封状态"): cp.append(it["拆封状态"])
            if it.get("外盒状态"): cp.append("盒:" + "、".join(_str_to_list(it.get("外盒状态"))))
            if it.get("本体状态"): cp.append("本:" + "、".join(_str_to_list(it.get("本体状态"))))
            cond = " ".join(cp)
            th += (
                f'<tr>'
                f'<td align="center">{_hm.escape(str(it.get("序号", "")))}</td>'
                f'<td align="center">{_hm.escape(str(it.get("型号", "")))}</td>'
                f'<td align="center">{_hm.escape(str(it.get("数量", "")))}</td>'
                f'<td align="right">{_hm.escape(str(it.get("参考价", "")))}</td>'
                f'<td align="left">{_hm.escape(cond)}</td>'
                f'</tr>'
            )
        th += "</table>"
        html_doc = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
@page {{ margin: 1.5cm; }}
body {{ font-family: "PingFang SC", "Helvetica Neue", sans-serif; }}
h2 {{ text-align: center; margin: 0 0 6pt 0; font-size: 18pt; }}
.sub {{ text-align: center; color: #888; font-size: 9pt; margin: 0 0 6pt 0; }}
.lnm {{ text-align: center; color: #007aff; font-size: 13pt; font-weight: bold; margin: 0 0 12pt 0; }}
</style></head><body>
<h2>附件：寄售玩具清单</h2>
<p class="sub">（本清单一式两份，双方各执一份；随附交接照片和视频）</p>
<p class="lnm">清单：{_hm.escape(self.current_list_name)}</p>
{th}
<p style="margin-top:30pt;font-size:10pt;">双方签字确认：________________________</p>
</body></html>"""
        return html_doc

    def _export_pdf(self, folder, safe, items, _share):
        """优先 iOS WebView → PDF；失败再走 reportlab；最后导出 HTML 让用户手动存。"""
        out_path = os.path.join(folder, safe + '_清单.pdf')
        html_src = self._build_pdf_html(items)

        # ---- 方案 1：iOS WKWebView → PDF（渲染 100% 正确，数字绝对不重叠）----
        if self._try_webview_to_pdf(html_src, out_path):
            _share.share_file(out_path) if _share else dialogs.alert("PDF 已生成", out_path)
            return

        # ---- 方案 2：reportlab（兜底，非 iOS 环境能用）----
        try:
            self._export_pdf_via_reportlab(folder, safe, items, _share, out_path)
            return
        except ImportError:
            print("[PDF] reportlab 未安装")
        except Exception as e:
            import traceback; traceback.print_exc()
            print(f"[reportlab] 失败: {e}")

        # ---- 方案 3：导出 HTML，让用户在 iOS 上手动"打印 → 存 PDF" ----
        self._export_pdf_via_html(folder, safe, html_src, _share)

    def _try_webview_to_pdf(self, html_src, out_path):
        """用 iOS 原生 WKWebView 把 HTML 渲染成 PDF。返回 True 表示成功。

        做法：present 一个全屏 ui.Window 承载 ui.WebView —— WKWebView 必须
        加到 view hierarchy 上才会真正加载 HTML（之前裸 alloc/init 永远
        isLoading=True 就是这个原因），加载完后调私有 API snapshot 成 PDF。
        """
        try:
            import ui, time
            from objc_util import ObjCClass, ObjCInstance, CGRect
        except ImportError:
            print("[PDF] 非 iOS/Pythonista 环境，跳过 WebView 方案")
            return False

        page_w, page_h = 595.28, 841.89  # A4 in points
        paper = CGRect((0, 0), (page_w, page_h))

        win = None
        try:
            print("[PDF] 创建全屏 ui.WebView 加载 HTML ...")

            # 1. 用 Pythonista 的 ui 模块 present 全屏 WebView
            wv = ui.WebView()
            wv.load_html(html_src)
            ui.View.present(wv, 'fullscreen')  # 全屏展示

            # 2. 等待加载（WKWebView 现在真的在 view hierarchy 上了）
            deadline = time.time() + 10
            waited = 0.0
            while time.time() < deadline:
                if not wv.is_loading:
                    break
                time.sleep(0.2)
                waited += 0.2
            print(f"[PDF] WebView 加载: {waited:.1f}s, is_loading={wv.is_loading}")

            if wv.is_loading:
                print("[PDF]   加载超时")
                try: wv.close()
                except: pass
                return False

            # 3. 拿到底层 ObjC WKWebView 并 snapshot
            container = ObjCInstance(wv.objc_instance())
            wk = None
            def _find(v):
                nonlocal wk
                for sub in v.subviews():
                    cls_name = ObjCClass(type(sub).__name__) if hasattr(type(sub), '__name__') else ''
                    # 直接用 respondsToSelector 判断是不是 WKWebView
                    if sub.respondsToSelector_('evaluateJavaScript:completionHandler:'):
                        wk = sub
                        return True
                    if _find(sub): return True
                return False
            _find(container)

            if wk is None:
                # fallback: 取所有 subviews 里最后一个
                subs = container.subviews()
                if subs:
                    wk = subs[-1]
                print(f"[PDF]   WKWebView fallback: 用最后一个 subview")

            if wk is None:
                print("[PDF]   找不到 WKWebView")
                try: wv.close()
                except: pass
                return False

            # 4. snapshot 成 PDF
            sel = '_pdfSnapshotAtFrame:_'
            if not wk.respondsToSelector_(sel):
                print(f"[PDF]   不支持 {sel}")
                try: wv.close()
                except: pass
                return False

            pdf_obj = wk._pdfSnapshotAtFrame_(paper)
            try: wv.close()
            except: pass

            if pdf_obj:
                pdf_data = bytes(ObjCInstance(pdf_obj))
                if pdf_data and len(pdf_data) > 200:
                    with open(out_path, 'wb') as f:
                        f.write(pdf_data)
                    print(f"[PDF] ✅ WKWebView snapshot 成功, "
                          f"{len(pdf_data)} 字节")
                    return True
            print("[PDF]   snapshot 返回空 PDF")
        except Exception as e:
            import traceback; traceback.print_exc()
            print(f"[PDF] WKWebView 方案失败: {e}")
            try: wv.close()
            except: pass

        return False

    def _export_pdf_via_reportlab(self, folder, safe, items, _share, out_path):
        """reportlab 兜底生成 PDF（仅当 iOS WebView 方案不可用时使用）"""
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        fam = self._register_cn_font()
        doc = SimpleDocTemplate(out_path, pagesize=A4,
                                leftMargin=18*mm, rightMargin=18*mm,
                                topMargin=18*mm, bottomMargin=18*mm)
        title_style = ParagraphStyle('title',
                                      fontName=fam, fontSize=20, leading=26,
                                      alignment=1, textColor=colors.black)
        sub_style = ParagraphStyle('sub',
                                    fontName=fam, fontSize=10, leading=14,
                                    alignment=1, textColor=colors.grey)
        lnm_style = ParagraphStyle('lnm',
                                    fontName=fam, fontSize=14, leading=18,
                                    alignment=1, textColor=colors.HexColor('#007aff'))
        body_style = ParagraphStyle('body',
                                     fontName=fam, fontSize=10, leading=14)
        story = []
        story.append(Paragraph('附件：寄售玩具清单', title_style))
        story.append(Spacer(1, 4))
        story.append(Paragraph('（本清单一式两份，双方各执一份；随附交接照片和视频）', sub_style))
        story.append(Spacer(1, 2))
        story.append(Paragraph('清单：' + self.current_list_name, lnm_style))
        story.append(Spacer(1, 10))

        wrap_style = ParagraphStyle('wrap',
                                     fontName=fam, fontSize=10, leading=14)
        # 数字相关列全部用 Helvetica 12pt（reportlab 内置 Type 1 英文字体，
        # 100% 不会有数字重叠问题）
        num_style = ParagraphStyle('num',
                                    fontName='Helvetica', fontSize=12, leading=15,
                                    alignment=1)
        hd = ["序号", "型号", "数量", "参考价", "盒况备注"]
        data = [hd]
        for it in items:
            cp = []
            if it.get("拆封状态"): cp.append(it["拆封状态"])
            if it.get("外盒状态"): cp.append("盒:"+"、".join(_str_to_list(it.get("外盒状态"))))
            if it.get("本体状态"): cp.append("本:"+"、".join(_str_to_list(it.get("本体状态"))))
            cond = " ".join(cp)
            data.append([
                Paragraph(str(it.get("序号","")), num_style),
                Paragraph(str(it.get("型号","")), num_style),
                Paragraph(str(it.get("数量","")), num_style),
                Paragraph(str(it.get("参考价","")), num_style),
                Paragraph(cond, wrap_style),
            ])

        # 型号列用 12pt Helvetica，比其他列大 2 号更醒目；列宽分配也给足
        # A4 可用 174mm (210 - 2*18mm margin)
        # 序号 15 + 型号 40 + 数量 15 + 参考价 24 + 盒况备注 80 = 174 ✓
        col_widths = [15*mm, 40*mm, 15*mm, 24*mm, 80*mm]
        t = Table(data, colWidths=col_widths, repeatRows=1)
        t.setStyle(TableStyle([
            # ⚠️ 字体只设表头行！数据行每个单元格是 Paragraph，
            # 字体由各自 style 控制（型号/序号用 Helvetica，盒况用 fam）
            ('FONTNAME', (0,0), (-1,0), fam),
            ('FONTSIZE', (0,0), (-1,-1), 10),
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f0f0f0')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.black),
            ('ALIGN', (0,0), (-1,0), 'CENTER'),
            # 数据行的对齐由 Paragraph style 控制，TableStyle 不再覆盖
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('GRID', (0,0), (-1,-1), 0.4, colors.grey),
            ('TOPPADDING', (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
            ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ]))
        story.append(t)
        story.append(Spacer(1, 20))
        story.append(Paragraph('双方签字确认：________________________', body_style))
        doc.build(story)
        _share.share_file(out_path) if _share else dialogs.alert("PDF 已生成 (reportlab)", out_path)

    def _register_cn_font(self):
        """给 reportlab 注册字体；返回字体名。

        ⚠️ iOS 上 PingFang/STHeiti 等 .ttc 被 reportlab 解析时数字度量有 bug
           → 相邻数字 advance width 太小 → 打印/PDF 里数字互相重叠！
           所以 **STSong-Light (reportlab 内置 CID)** 设为首选，它的数字是
           Type 1 PostScript 数据，度量绝对精确，绝不会重叠。
        """
        from reportlab.pdfbase import pdfmetrics
        fam = 'Helvetica'

        # ---- 首选：reportlab 自带 CID 字体（数字度量精确，绝无重叠）----
        try:
            from reportlab.pdfbase.cidfonts import UnicodeCIDFont
            pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
            fam = 'STSong-Light'
            print("[PDF] ✅ 首选字体: STSong-Light (CID, 数字度量精确)")
            return fam
        except Exception as e:
            print(f"[PDF] STSong-Light 不可用: {e}")

        # ---- 兜底：iOS 系统 .ttc 字体（可能有数字重叠问题，但中文效果更好）----
        try:
            from reportlab.pdfbase.ttfonts import TTFont
            font_candidates = [
                ('CN', '/System/Library/Fonts/PingFang.ttc', 0),
                ('CN', '/System/Library/Fonts/PingFang.ttc', 4),
                ('CN', '/System/Library/Fonts/STHeiti Light.ttc', 0),
                ('CN', '/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
                ('CN', '/Library/Fonts/Songti.ttc', 0),
            ]
            for _n, _p, _i in font_candidates:
                if os.path.exists(_p):
                    try:
                        pdfmetrics.registerFont(TTFont(_n, _p, subfontIndex=_i))
                        fam = _n
                        print(f"[PDF] ⚠️ 兜底字体: {_n} <- {_p} idx={_i} (可能数字重叠)")
                        break
                    except Exception:
                        pass
        except Exception:
            pass
        return fam

    def _export_pdf_via_html(self, folder, safe, html_src, _share):
        """最后的兜底：导出 HTML 文件，让用户在 iOS 上用系统"打印 → 存 PDF"。"""
        out_html = os.path.join(folder, safe + '_清单.html')
        with open(out_html, 'w', encoding='utf-8') as f:
            f.write(html_src)
        # 也存一个 .pdf 扩展名（内容是 HTML），iOS 分享时用户选择"打印→存 PDF"
        out_path = os.path.join(folder, safe + '_清单.pdf')
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(html_src)
        if _share:
            _share.share_file(out_path)
            dialogs.alert("提示",
                "PDF 自动生成失败，已导出 HTML。\n"
                "在 iOS 上点分享 → 打印 → 左上角'打印' → 存为文件，即可得到真正的 PDF。")
        else:
            dialogs.alert("PDF 生成失败",
                "已导出 PDF 占位文件（内容是 HTML），\n"
                "在 iOS 上打开后用系统分享 → 打印 → 存文件即可。")

# ============ 数据输入表单（内嵌盒况）============
def _pil_to_ui_image(pil_img):
    """把 PIL Image 转成 Pythonista 能吃的 ui.Image（唯一靠谱路径：UIImage bridge）"""
    if not _HAS_OBJC:
        return None
    try:
        buf = io.BytesIO()
        pil_img.save(buf, format='JPEG', quality=90)
        nsdata = objc_util.nsdata(buf.getvalue())
        uiimg = objc_util.UIImage.alloc().initWithData_(nsdata)
        return ui.Image(uiimg)
    except Exception as e:
        print(f"[PIL→ui.Image 转换失败] {e}")
        return None

def _safe_image_from_file(path):
    """从文件加载图片 — 返回 ui.Image（Pythonista 所有 image 控件只认 ui.Image）"""
    import PIL.Image as PILImage
    if not path or not os.path.exists(path):
        return None
    try:
        pil_img = PILImage.open(path)
        pil_img.load()
        return _pil_to_ui_image(pil_img)
    except Exception as e:
        print(f"[图片加载失败] {path}: {e}")
        return None


class InputForm(ui.View):
    """玩具信息输入表单 — 带前/后货品切换 + 图片缩略图网格"""
    @classmethod
    def open(cls, list_name, seq, parent=None, start_idx=-1):
        form = cls(list_name, seq, parent, start_idx)
        form.present(style='sheet', hide_title_bar=False)

    def __init__(self, list_name, initial_seq, parent=None, start_idx=-1):
        super().__init__()
        self.list_name = list_name
        self.parent_controller = parent
        self.photo_files = []       # 当前货品的图片文件名列表
        self.items = []             # CSV 所有行
        self.current_idx = start_idx  # 当前编辑的是第几个
        self._thumb_views = []      # 缩略图按钮列表

        self.background_color = '#f2f2f7'

        # 加载所有货品
        self.items = read_all_items(list_name)

        # 外层 ScrollView
        self.scroll = ui.ScrollView()
        self.scroll.frame = (0, 0, self.width, self.height)
        self.scroll.scroll_enabled = True
        self.scroll.content_size = (400, 1800)
        self.add_subview(self.scroll)

        y = 16  # 相对 scroll 的 y（顶部留白小一点）

        def small_lbl(t):
            l = ui.Label()
            l.text = t; l.font = ('Helvetica', 14); l.text_color = '#333'
            return l

        # ============ 第1行: 序号 + 前/后导航（右对齐） ============
        lbl = small_lbl("序号"); lbl.frame = (20, y, 44, 30)
        self.scroll.add_subview(lbl)

        self.txt_seq = ui.TextField()
        self.txt_seq.frame = (68, y - 2, 68, 32)
        self.txt_seq.border_width = 1; self.txt_seq.border_color = '#ccc'
        self.txt_seq.corner_radius = 5
        self.txt_seq.text = str(initial_seq)
        self.scroll.add_subview(self.txt_seq)

        self.lbl_idx = ui.Label()
        self.lbl_idx.font = ('Helvetica', 10); self.lbl_idx.text_color = '#888'
        self.lbl_idx.frame = (138, y + 4, 100, 22)
        self.scroll.add_subview(self.lbl_idx)

        # 导航按钮右对齐
        self.btn_prev = ui.Button()
        self.btn_prev.title = "◀ 前"
        self.btn_prev.font = ('Helvetica', 13); self.btn_prev.tint_color = '#007aff'
        self.btn_prev.frame = (210, y - 2, 76, 34)
        self.btn_prev.action = self.on_prev_item
        self.scroll.add_subview(self.btn_prev)

        self.btn_next = ui.Button()
        self.btn_next.title = "后 ▶"
        self.btn_next.font = ('Helvetica', 13); self.btn_next.tint_color = '#007aff'
        self.btn_next.frame = (292, y - 2, 76, 34)
        self.btn_next.action = self.on_next_item
        self.scroll.add_subview(self.btn_next)

        y += 40

        # ============ 第2行: 型号 ============
        lbl = small_lbl("型号"); lbl.frame = (20, y, 44, 30)
        self.scroll.add_subview(lbl)
        self.txt_model = ui.TextField()
        self.txt_model.frame = (68, y - 2, 290, 32)
        self.txt_model.border_width = 1; self.txt_model.border_color = '#ccc'
        self.txt_model.corner_radius = 5
        self.txt_model.placeholder = "例如：MG Freedom 2.0"
        self.scroll.add_subview(self.txt_model)
        y += 38

        # ============ 第3行: 数量 + 参考价 ============
        lbl = small_lbl("数量"); lbl.frame = (20, y, 44, 30)
        self.scroll.add_subview(lbl)
        self.txt_qty = ui.TextField()
        self.txt_qty.frame = (68, y - 2, 62, 32)
        self.txt_qty.border_width = 1; self.txt_qty.border_color = '#ccc'
        self.txt_qty.corner_radius = 5; self.txt_qty.keyboard_type = ui.KEYBOARD_NUMBER_PAD
        self.txt_qty.text = "1"
        self.scroll.add_subview(self.txt_qty)

        lbl = small_lbl("参考价"); lbl.frame = (140, y, 58, 30)
        self.scroll.add_subview(lbl)
        self.txt_price = ui.TextField()
        self.txt_price.frame = (202, y - 2, 156, 32)
        self.txt_price.border_width = 1; self.txt_price.border_color = '#ccc'
        self.txt_price.corner_radius = 5; self.txt_price.keyboard_type = ui.KEYBOARD_DECIMAL_PAD
        self.txt_price.placeholder = "例如：280"
        self.scroll.add_subview(self.txt_price)
        y += 40

        # ============ 盒况 ============
        def section_with_side(title, side_view=None):
            """section 标题可带右侧控件（如 SegmentedControl）"""
            lbl = ui.Label()
            lbl.text = title
            lbl.font = ('Helvetica-Bold', 13); lbl.text_color = '#1a1a1a'
            lbl.frame = (16, y, 200, 20)
            self.scroll.add_subview(lbl)
            if side_view:
                side_view.frame = (216, y - 4, 144, 28)
                self.scroll.add_subview(side_view)
            line = ui.View()
            line.background_color = '#e0e0e0'
            line.frame = (16, y + 22, 340, 0.5)
            self.scroll.add_subview(line)
            return y + 26

        def section(t):
            lbl = ui.Label()
            lbl.text = t
            lbl.font = ('Helvetica-Bold', 13); lbl.text_color = '#1a1a1a'
            lbl.frame = (16, y, 340, 20)
            self.scroll.add_subview(lbl)
            line = ui.View()
            line.background_color = '#e0e0e0'
            line.frame = (16, y + 22, 340, 0.5)
            self.scroll.add_subview(line)
            return y + 26

        def make_checkbox(text, cx, cy, col_w=85):
            cb = ui.Button()
            cb.title = "☐"; cb.font = ('Helvetica', 13); cb.tint_color = '#333'
            cb.frame = (cx, cy - 3, 22, 24)
            def toggle(sender, b=cb):
                b.title = "☑" if b.title == "☐" else "☐"
            cb.action = toggle
            self.scroll.add_subview(cb)
            lbl = ui.Label()
            lbl.text = text; lbl.font = ('Helvetica', 13); lbl.text_color = '#222'
            lbl.number_of_lines = 1
            lbl.adjusts_font_size_to_fit = True
            lbl.minimum_font_size = 10
            lbl.frame = (cx + 24, cy - 2, col_w - 28, 24)
            self.scroll.add_subview(lbl)
            return cb

        # 拆封状态 — SegmentedControl 跟标题同一行！
        self.seal_seg = ui.SegmentedControl()
        self.seal_seg.segments = SEAL_OPTIONS
        self.seal_seg.selected_index = 0
        y = section_with_side("拆封状态（单选）", self.seal_seg)
        # SegControl 下面不需要单独一行了，减 y 让 checkbox 紧跟标题行
        y -= 2  # SegControl 已经放在标题同一行，内容直接从标题下面开始

        # 外盒状态
        y = section("外盒状态（可多选）")
        self.box_checks = []
        non_other = [o for o in BOX_CONDITION_OPTIONS if o != "其他"]
        for i, opt in enumerate(non_other):
            col = i % 4; row_idx = i // 4
            x_pos = 16 + col * 85; row_y = y + row_idx * 26
            cb = make_checkbox(opt, x_pos, row_y)
            self.box_checks.append((opt, cb))
        rows_box = (len(non_other) + 3) // 4
        y += rows_box * 26 + 2
        cb_other = make_checkbox("其他", 16, y)
        self.box_checks.append(("其他", cb_other))
        self.txt_box_other = ui.TextField()
        self.txt_box_other.frame = (101, y - 2, 258, 26)
        self.txt_box_other.border_width = 1; self.txt_box_other.border_color = '#ddd'
        self.txt_box_other.corner_radius = 4
        self.scroll.add_subview(self.txt_box_other)
        y += 30

        # 本体状态
        y = section("本体状态（可多选）")
        self.item_checks = []
        non_other = [o for o in ITEM_CONDITION_OPTIONS if o != "其他"]
        for i, opt in enumerate(non_other):
            col = i % 4; row_idx = i // 4
            x_pos = 16 + col * 85; row_y = y + row_idx * 26
            cb = make_checkbox(opt, x_pos, row_y)
            self.item_checks.append((opt, cb))
        rows_item = (len(non_other) + 3) // 4
        y += rows_item * 26 + 2
        cb_other = make_checkbox("其他", 16, y)
        self.item_checks.append(("其他", cb_other))
        self.txt_item_other = ui.TextField()
        self.txt_item_other.frame = (101, y - 2, 258, 26)
        self.txt_item_other.border_width = 1; self.txt_item_other.border_color = '#ddd'
        self.txt_item_other.corner_radius = 4
        self.scroll.add_subview(self.txt_item_other)
        y += 30

        # 配件状态
        y = section("配件状态（可多选）")
        self.acc_checks = []
        non_other = [o for o in ACCESSORY_OPTIONS if o != "其他"]
        for i, opt in enumerate(non_other):
            col = i % 4; row_idx = i // 4
            x_pos = 16 + col * 85; row_y = y + row_idx * 26
            cb = make_checkbox(opt, x_pos, row_y)
            self.acc_checks.append((opt, cb))
        rows_acc = (len(non_other) + 3) // 4
        y += rows_acc * 26 + 2
        cb_other = make_checkbox("其他", 16, y)
        self.acc_checks.append(("其他", cb_other))
        self.txt_acc_other = ui.TextField()
        self.txt_acc_other.frame = (101, y - 2, 258, 26)
        self.txt_acc_other.border_width = 1; self.txt_acc_other.border_color = '#ddd'
        self.txt_acc_other.corner_radius = 4
        self.scroll.add_subview(self.txt_acc_other)
        y += 30

        # 其他瑕疵（压缩高度 + 底部右对齐放拍照/保存按钮）
        y = section("其他瑕疵或说明")
        self.txt_other = ui.TextView()
        self.txt_other.frame = (16, y, 340, 50)
        self.txt_other.border_width = 1; self.txt_other.border_color = '#ddd'
        self.txt_other.corner_radius = 4
        self.scroll.add_subview(self.txt_other)
        y += 56

        # 拍照 + 保存按钮 — 在"其他瑕疵"下方右对齐
        self.btn_photo = ui.Button()
        self.btn_photo.title = "📷拍照"
        self.btn_photo.font = ('Helvetica', 14); self.btn_photo.tint_color = 'white'
        self.btn_photo.background_color = '#007aff'; self.btn_photo.corner_radius = 6
        self.btn_photo.frame = (192, y, 72, 34)
        self.btn_photo.action = self.on_take_photos
        self.scroll.add_subview(self.btn_photo)

        self.lbl_photo_count = ui.Label()
        self.lbl_photo_count.font = ('Helvetica', 11)
        self.lbl_photo_count.text_color = '#34c759'
        self.lbl_photo_count.frame = (120, y, 68, 34)
        self.lbl_photo_count.text_alignment = ui.ALIGN_RIGHT
        self.scroll.add_subview(self.lbl_photo_count)

        self.btn_save_top = ui.Button()
        self.btn_save_top.title = "💾 保存"
        self.btn_save_top.font = ('Helvetica-Bold', 14); self.btn_save_top.tint_color = 'white'
        self.btn_save_top.background_color = '#34c759'; self.btn_save_top.corner_radius = 6
        self.btn_save_top.frame = (272, y, 84, 34)
        self.btn_save_top.action = self.on_save
        self.scroll.add_subview(self.btn_save_top)

        y += 40

        # ============ 图片缩略图区 ============
        y = section("📷 图片（点击缩略图看大图）")
        self.thumb_container = ui.View()
        self.thumb_container.frame = (16, y, 340, 100)  # 初始占位，渲染时动态调整
        self.scroll.add_subview(self.thumb_container)
        y += 100

        # 返回按钮
        self.btn_cancel = ui.Button()
        self.btn_cancel.title = "返回"
        self.btn_cancel.font = ('Helvetica', 14); self.btn_cancel.tint_color = '#007aff'
        self.btn_cancel.frame = (20, y + 6, 340, 40)
        self.btn_cancel.action = self.on_cancel
        self.scroll.add_subview(self.btn_cancel)
        y += 54

        self._form_bottom_y = y
        self.scroll.content_size = (400, y + 20)

        # === 初始化: 加载 start_idx 对应的货品，或新建 ===
        if start_idx >= 0 and start_idx < len(self.items):
            self._load_item(start_idx)
        else:
            self.current_idx = -1  # 新建模式
            self.lbl_idx.text = f"新建 共{len(self.items)}"
            self._render_thumbs()  # 空的缩略图区

    # ========= 缩略图渲染 =========
    def _get_photo_folder(self):
        """图片所在文件夹"""
        return get_list_folder(self.list_name)

    def _render_thumbs(self):
        """渲染图片缩略图网格 — 4列正方形，真实图片缩小版"""
        for v in list(self.thumb_container.subviews):
            self.thumb_container.remove_subview(v)
        self._thumb_views = []

        photo_dir = self._get_photo_folder()
        n = len(self.photo_files)
        print(f"[缩略图] photo_dir={photo_dir}, files={self.photo_files}")

        thumb_size = 78
        gap = 8
        cols = 4
        rows = max((n + cols - 1) // cols, 1)
        container_h = rows * thumb_size + (rows - 1) * gap
        self.thumb_container.height = max(container_h, thumb_size)

        if n == 0:
            empty_lbl = ui.Label()
            empty_lbl.text = "（还没有照片，点击 📷拍照 添加）"
            empty_lbl.font = ('Helvetica', 12)
            empty_lbl.text_color = '#aaa'
            empty_lbl.alignment = ui.ALIGN_CENTER
            empty_lbl.frame = (0, 0, 340, thumb_size)
            self.thumb_container.add_subview(empty_lbl)
            return

        for idx, fname in enumerate(self.photo_files):
            if os.path.isabs(fname):
                fp = fname
            else:
                fp = os.path.join(photo_dir, fname)

            col = idx % cols
            row = idx // cols
            x = col * (thumb_size + gap)
            y = row * (thumb_size + gap)

            # 透明 Button 负责接收点击事件
            btn = ui.Button()
            btn.frame = (x, y, thumb_size, thumb_size)
            btn.background_color = '#f0f0f0'
            btn.corner_radius = 6
            btn.border_width = 1
            btn.border_color = '#ddd'

            # ImageView 显示图片 — PIL Image 直接赋给 ImageView.image
            iv = ui.ImageView()
            iv.frame = btn.bounds
            iv.flex = 'WH'
            iv.content_mode = ui.CONTENT_SCALE_ASPECT_FILL
            iv.corner_radius = 6
            iv.clip_to_bounds = True

            pil_img = _safe_image_from_file(fp)
            if pil_img:
                iv.image = pil_img
            else:
                lbl = ui.Label()
                lbl.text = "🖼" if os.path.exists(fp) else "❓"
                lbl.font = ('Helvetica', 22)
                lbl.text_color = '#bbb'
                lbl.alignment = ui.ALIGN_CENTER
                lbl.frame = btn.bounds
                lbl.flex = 'WH'
                btn.add_subview(lbl)

            btn.add_subview(iv)

            def make_tap(i=idx):
                def tap(sender):
                    self._show_image_viewer(i)
                return tap
            btn.action = make_tap()

            self.thumb_container.add_subview(btn)
            self._thumb_views.append(btn)

    def _show_image_viewer(self, start_idx=0):
        """全屏图片浏览器 — 翻页按钮切换 + 左右滑"""
        screen_w, screen_h = ui.get_screen_size()

        photo_dir = self._get_photo_folder()
        paths = []
        for fn in self.photo_files:
            if os.path.isabs(fn):
                paths.append(fn)
            else:
                paths.append(os.path.join(photo_dir, fn))
        n = len(paths)
        if n == 0:
            return

        # 遮罩
        mask = ui.View(frame=(0, 0, screen_w, screen_h))
        mask.background_color = (0, 0, 0, 0.95)
        mask.flex = 'WH'

        # 顶部页码
        page_lbl = ui.Label()
        page_lbl.text = f"{start_idx + 1}/{n}"
        page_lbl.text_color = '#fff'
        page_lbl.font = ('Helvetica', 16)
        page_lbl.alignment = ui.ALIGN_CENTER
        page_lbl.frame = (0, 0, screen_w, 40)
        page_lbl.flex = 'TB'
        mask.add_subview(page_lbl)

        # 主图片区
        img_area = ui.View(frame=(0, 40, screen_w, screen_h - 40 - 60))
        img_area.flex = 'WH'
        img_view = ui.ImageView(frame=(0, 0, screen_w, img_area.height))
        img_view.content_mode = ui.CONTENT_SCALE_ASPECT_FIT
        img_view.flex = 'WH'
        img_view.image = _safe_image_from_file(paths[start_idx])
        img_area.add_subview(img_view)
        mask.add_subview(img_area)

        # 翻页函数
        def show_page(i):
            i = max(0, min(i, n - 1))
            page_lbl.text = f"{i + 1}/{n}"
            name_lbl.text = self.photo_files[i]
            img_view.image = _safe_image_from_file(paths[i])
            prev_btn.enabled = i > 0
            next_btn.enabled = i < n - 1
            _state['cur'] = i

        _state = {'cur': start_idx}

        # 上一张
        prev_btn = ui.Button()
        prev_btn.title = "‹ 上一张"
        prev_btn.tint_color = '#fff'
        prev_btn.font = ('Helvetica', 14)
        prev_btn.action = lambda s: show_page(_state['cur'] - 1)
        prev_btn.frame = (10, screen_h - 55, 100, 44)
        prev_btn.flex = 'TL'
        prev_btn.enabled = start_idx > 0
        mask.add_subview(prev_btn)

        # 文件名
        name_lbl = ui.Label()
        name_lbl.text = self.photo_files[start_idx]
        name_lbl.text_color = '#bbb'
        name_lbl.font = ('Helvetica', 11)
        name_lbl.alignment = ui.ALIGN_CENTER
        name_lbl.frame = (110, screen_h - 55, screen_w - 290, 20)
        name_lbl.flex = 'TB'
        mask.add_subview(name_lbl)

        # 下一张
        next_btn = ui.Button()
        next_btn.title = "下一张 ›"
        next_btn.tint_color = '#fff'
        next_btn.font = ('Helvetica', 14)
        next_btn.action = lambda s: show_page(_state['cur'] + 1)
        next_btn.frame = (screen_w - 190, screen_h - 55, 100, 44)
        next_btn.flex = 'TR'
        next_btn.enabled = start_idx < n - 1
        mask.add_subview(next_btn)

        # 关闭
        close = ui.Button()
        close.title = "✕ 关闭"
        close.tint_color = '#fff'
        close.font = ('Helvetica', 14)
        close.action = lambda s: mask.close()
        close.frame = (screen_w - 80, screen_h - 55, 70, 44)
        close.flex = 'TR'
        mask.add_subview(close)

        mask.present('sheet')

    # ========= 加载已有货品 =========
    def _load_item(self, idx):
        """从 CSV 加载第 idx 行到表单"""
        if idx < 0 or idx >= len(self.items):
            return
        self.current_idx = idx
        item = self.items[idx]

        self.txt_seq.text = str(item.get("序号", "") or "")
        self.txt_model.text = str(item.get("型号", "") or "")
        self.txt_qty.text = str(item.get("数量", "") or "1")
        self.txt_price.text = str(item.get("参考价", "") or "")

        # 拆封单选
        seal = item.get("拆封状态", "")
        if seal in SEAL_OPTIONS:
            self.seal_seg.selected_index = SEAL_OPTIONS.index(seal)
        else:
            self.seal_seg.selected_index = 0

        # 外盒多选 —— JSON 里已经是 list，直接转 set
        box = set(_str_to_list(item.get("外盒状态")))
        for opt, cb in self.box_checks:
            cb.title = "☑" if opt in box else "☐"
        self.txt_box_other.text = item.get("外盒其他", "")

        # 本体多选
        itm = set(_str_to_list(item.get("本体状态")))
        for opt, cb in self.item_checks:
            cb.title = "☑" if opt in itm else "☐"
        self.txt_item_other.text = item.get("本体其他", "")

        # 配件多选
        acc = set(_str_to_list(item.get("配件状态")))
        for opt, cb in self.acc_checks:
            cb.title = "☑" if opt in acc else "☐"
        self.txt_acc_other.text = item.get("配件其他", "")

        self.txt_other.text = item.get("其他瑕疵或说明", "")

        # 照片 —— JSON 里也是 list
        self.photo_files = _str_to_list(item.get("照片文件"))
        self.lbl_photo_count.text = f"{len(self.photo_files)}张" if self.photo_files else ""
        self.lbl_photo_count.text_color = '#34c759' if self.photo_files else '#666'

        # 标签
        self.lbl_idx.text = f"{idx+1}/{len(self.items)} · 序{item.get('序号','')}"

        self._render_thumbs()
        self._update_nav_buttons()

    def _clear_form(self):
        """清空表单（新建用）"""
        self.current_idx = -1
        self.txt_seq.text = ""
        self.txt_model.text = ""
        self.txt_qty.text = "1"
        self.txt_price.text = ""
        self.seal_seg.selected_index = 0
        for _, cb in self.box_checks: cb.title = "☐"
        for _, cb in self.item_checks: cb.title = "☐"
        for _, cb in self.acc_checks: cb.title = "☐"
        self.txt_box_other.text = ""
        self.txt_item_other.text = ""
        self.txt_acc_other.text = ""
        self.txt_other.text = ""
        self.photo_files = []
        self.lbl_photo_count.text = ""
        self.lbl_idx.text = f"新建 共{len(self.items)}"
        self._render_thumbs()
        self._update_nav_buttons()

    def _update_nav_buttons(self):
        """根据 current_idx 禁用前/后按钮"""
        total = len(self.items)
        editing = self.current_idx >= 0
        self.btn_prev.enabled = editing and self.current_idx > 0
        self.btn_next.enabled = editing and self.current_idx < total - 1

    # ========= 导航 =========
    def on_prev_item(self, sender=None):
        if self.current_idx > 0:
            self._save_current_to_fields()  # 先把表单数据记回 items
            self._load_item(self.current_idx - 1)
        else:
            dialogs.alert("提示", "已经是第一项了")

    def on_next_item(self, sender=None):
        if self.current_idx < len(self.items) - 1:
            self._save_current_to_fields()
            self._load_item(self.current_idx + 1)
        else:
            dialogs.alert("提示", "已经是最后一项了")

    def _save_current_to_fields(self):
        """切换货品前，把当前表单内容先同步回 items 数组"""
        if self.current_idx < 0:
            return
        items_data = self.collect_condition_data()
        seq = self.txt_seq.text.strip()
        model = self.txt_model.text.strip()
        if not seq or not model:
            return  # 不完整的表单不同步
        items_data["序号"] = _int_or_zero(seq)
        items_data["型号"] = model
        items_data["数量"] = _int_or_zero(self.txt_qty.text.strip() or "1") or 1
        items_data["参考价"] = self.txt_price.text.strip()
        # JSON 里照片文件是 list
        items_data["照片文件"] = list(self.photo_files)
        self.items[self.current_idx] = items_data

    # ========= 拍照 =========
    def on_take_photos(self, sender):
        seq = self.txt_seq.text.strip()
        model = self.txt_model.text.strip()
        if not model:
            dialogs.alert("提示", "请先填写型号")
            return
        if not seq:
            dialogs.alert("提示", "请填写序号")
            return
        new_photos = take_photos(self.list_name, seq, model)
        if new_photos:
            # 追加到现有列表（不要覆盖）
            existing = set(self.photo_files)
            for f in new_photos:
                if f not in existing:
                    self.photo_files.append(f)
            self.lbl_photo_count.text = f"{len(self.photo_files)}张"
            self.lbl_photo_count.text_color = '#34c759'
            self._render_thumbs()

    def collect_condition_data(self):
        def is_checked(btn):
            return getattr(btn, 'title', '') == '☑' or getattr(btn, 'selected', False)
        data = {}
        si = self.seal_seg.selected_index
        if 0 <= si < len(SEAL_OPTIONS):
            data["拆封状态"] = SEAL_OPTIONS[si]
        # 多选字段 → 直接用 list（JSON 原生数组，不用 | 分隔字符串）
        data["外盒状态"] = [o for o, b in self.box_checks if is_checked(b)]
        data["外盒其他"] = self.txt_box_other.text.strip()
        data["本体状态"] = [o for o, b in self.item_checks if is_checked(b)]
        data["本体其他"] = self.txt_item_other.text.strip()
        data["配件状态"] = [o for o, b in self.acc_checks if is_checked(b)]
        data["配件其他"] = self.txt_acc_other.text.strip()
        data["其他瑕疵或说明"] = self.txt_other.text.strip()
        return data

    # ========= 保存 =========
    def on_save(self, sender=None):
        seq = self.txt_seq.text.strip()
        model = self.txt_model.text.strip()
        qty = self.txt_qty.text.strip() or "1"
        price = self.txt_price.text.strip()

        if not seq:
            dialogs.alert("提示", "请填写序号")
            return
        if not model:
            dialogs.alert("提示", "请填写型号")
            return

        item_data = {"序号": seq, "型号": model, "数量": qty, "参考价": price}
        item_data.update(self.collect_condition_data())
        # JSON 里照片文件是 list
        item_data["照片文件"] = list(self.photo_files)

        editing = self.current_idx >= 0
        if editing:
            # 编辑模式 — 更新 CSV 已有行
            ok = update_item_in_csv(self.list_name, seq, item_data)
            if not ok:
                # 没找到 → 提示可能序号改了
                try:
                    if check_duplicate_seq(self.list_name, int(seq)):
                        dialogs.alert("序号冲突", f"序号 {seq} 已存在但不是当前项")
                        return
                except ValueError:
                    pass
                # 序号可能改了 → 尝试删除旧行后追加新行
                self._delete_item_from_csv(seq)
                append_item_to_csv(self.list_name, item_data)
                editing = False
        else:
            # 新建模式
            try:
                if check_duplicate_seq(self.list_name, int(seq)):
                    result = dialogs.alert("序号重复", f"序号 {seq} 已存在，要覆盖吗？",
                                         "覆盖", "返回", hide_cancel_button=True)
                    if result == 2:
                        return
                    update_item_in_csv(self.list_name, seq, item_data)
                    editing = True
                else:
                    append_item_to_csv(self.list_name, item_data)
            except ValueError:
                append_item_to_csv(self.list_name, item_data)

        # 重新加载 items
        self.items = read_all_items(self.list_name)

        # 跳转到刚保存的那项
        new_idx = -1
        for i, it in enumerate(self.items):
            if str(it.get("序号", "")) == seq:
                new_idx = i
                break

        if new_idx >= 0:
            self._load_item(new_idx)
            self.current_idx = new_idx
            dialogs.alert("已保存", f"✅ 已保存：{seq} - {model}")
        else:
            # 找不到？可能异常
            dialogs.alert("已保存", f"✅ 已保存：{seq} - {model}")

        if self.parent_controller:
            self.parent_controller.update_info()

    def _delete_item_from_csv(self, seq):
        """从 JSON 删掉序号为 seq 的记录。函数名保留旧名兼容 on_save 调用。"""
        init_json(self.list_name)
        target = _int_or_zero(seq)
        items = read_all_items(self.list_name)
        items = [it for it in items if _int_or_zero(it.get("序号")) != target]
        _save_json(self.list_name, items)
        print(f"[删除] ✅ 序号 {seq} 已删除")

    def on_cancel(self, sender):
        self.close()

    def layout(self):
        self.scroll.frame = (0, 0, self.width, self.height)


class ListViewer(ui.View):
    """清单预览 — 标题+表格都内嵌 HTML，webview 顶到 sheet 顶部"""

    @classmethod
    def open(cls, list_name):
        viewer = cls(list_name)
        viewer.present(style='fullscreen', hide_title_bar=True)
        # present 返回时 layout 已跑完，WebView.frame 已正确设置，直接 load
        viewer.load_data()

    def __init__(self, list_name):
        super().__init__()
        self.list_name = list_name
        self.background_color = 'white'

        self.webview = ui.WebView()
        self.webview.background_color = 'white'
        self.add_subview(self.webview)

        self.btn_close = ui.Button()
        self.btn_close.title = "返回"
        self.btn_close.font = ('Helvetica', 15)
        self.btn_close.tint_color = '#007aff'
        self.btn_close.action = lambda s: self.close()
        self.add_subview(self.btn_close)

        # 不在这里调 load_data() —— WebView frame 还没被 layout 设置，
        # 必须等 present 之后 ui.delay(0.15, ...) 再调

    def _build_html(self):
        import html as _hm
        items = read_all_items(self.list_name)
        print(f"[查看清单] list_name='{self.list_name}', items={len(items)}")

        colgroup = (
            '<colgroup>'
            '<col style="min-width:44px">'
            '<col style="min-width:80px">'
            '<col style="min-width:44px">'
            '<col style="min-width:50px">'
            '<col>'
            '</colgroup>'
        )

        thead = (
            '<thead><tr>'
            '<th style="text-align:center;padding:10px 6px;border-bottom:2px solid #333;background:#f5f5f5;">序号</th>'
            '<th style="text-align:center;padding:10px 6px;border-bottom:2px solid #333;background:#f5f5f5;">型号</th>'
            '<th style="text-align:center;padding:10px 6px;border-bottom:2px solid #333;background:#f5f5f5;">数量</th>'
            '<th style="text-align:center;padding:10px 6px;border-bottom:2px solid #333;background:#f5f5f5;">参考价</th>'
            '<th style="text-align:center;padding:10px 6px;border-bottom:2px solid #333;background:#f5f5f5;">盒况备注</th>'
            '</tr></thead>'
        )

        rows_html = []
        for idx, it in enumerate(items):
            cond_parts = []
            if it.get("拆封状态"):
                cond_parts.append(it["拆封状态"])
            if it.get("外盒状态"):
                cond_parts.append("盒:" + "、".join(_str_to_list(it.get("外盒状态"))))
            if it.get("本体状态"):
                cond_parts.append("本:" + "、".join(_str_to_list(it.get("本体状态"))))
            if it.get("配件状态"):
                cond_parts.append("配:" + "、".join(_str_to_list(it.get("配件状态"))))
            cond = " ".join(cond_parts) or "—"

            bg = '#fafafa' if idx % 2 else '#ffffff'
            row = (
                '<tr style="background:' + bg + '">'
                '<td style="text-align:center;padding:8px 6px;border-bottom:1px solid #ddd;">' + _hm.escape(str(it.get("序号",""))) + '</td>'
                '<td style="text-align:center;padding:8px 6px;border-bottom:1px solid #ddd;">' + _hm.escape(str(it.get("型号",""))) + '</td>'
                '<td style="text-align:center;padding:8px 6px;border-bottom:1px solid #ddd;">' + _hm.escape(str(it.get("数量",""))) + '</td>'
                '<td style="text-align:right;padding:8px 6px;border-bottom:1px solid #ddd;">' + _hm.escape(str(it.get("参考价",""))) + '</td>'
                '<td style="text-align:left;padding:8px 6px;border-bottom:1px solid #ddd;word-break:break-all;">' + _hm.escape(cond) + '</td>'
                '</tr>'
            )
            rows_html.append(row)

        if rows_html:
            tbody = '<tbody>' + ''.join(rows_html) + '</tbody>'
        else:
            tbody = '<tbody><tr><td colspan="5" style="text-align:center;padding:40px;color:#999;">（暂无记录）</td></tr></tbody>'

        title_block = (
            '<h2 style="text-align:center;margin:0 0 4px;font-size:26px;font-weight:bold;color:#111;">附件：寄售玩具清单</h2>'
            '<p style="text-align:center;margin:0 0 6px;font-size:18px;font-weight:bold;color:#444;">（本清单一式两份，双方各执一份；随附交接照片和视频）</p>'
            '<p style="text-align:center;margin:0 0 10px;font-size:22px;font-weight:bold;color:#007aff;">清单：'
            + _hm.escape(self.list_name) + '</p>'
        )

        html_doc = (
            '<!DOCTYPE html><html><head><meta charset="utf-8">'
            '<style>'
            'body{font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;'
            'font-size:16px;margin:0;padding:0;background:white;color:black;}'
            'table{border-collapse:collapse;width:100%;}'
            '</style></head><body>'
            + title_block
            + '<table>' + colgroup + thead + tbody + '</table>'
            '</body></html>'
        )
        return html_doc

    def load_data(self):
        self.webview.load_html(self._build_html())

    def layout(self):
        w = self.width
        # sheet 顶部有系统留白，webview 从 y=60 开始刚好贴到 sheet 内容区顶端
        self.webview.frame = (0, 0, w, self.height - 60)
        self.btn_close.frame = (20, self.height - 48, w - 40, 40)



# ============ 入口 ============
def main():
    print("=" * 40)
    print("  玩具寄售清单 启动中...")
    print("=" * 40)
    main_view = MainViewController()
    main_view.present(style='fullscreen', hide_title_bar=False,
                      title_bar_color='#007aff', title_color='white')


if __name__ == "__main__":
    main()
