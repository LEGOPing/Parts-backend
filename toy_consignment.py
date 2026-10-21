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
from datetime import datetime

# ============ 配置常量 ============
CSV_FILENAME = "寄售清单.csv"
CONFIG_FILENAME = ".app_config.json"

# 拆封状态（单选）
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


def get_csv_path(list_name):
    """获取 CSV 文件完整路径"""
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


# ============ CSV 读写（简化写法，确保 Pythonista 兼容） ============
def init_csv(list_name):
    """初始化 CSV 文件（用 utf-8-sig 自动处理 BOM）"""
    csv_path = get_csv_path(list_name)
    print(f"[CSV] 初始化检查: {csv_path}")
    if not os.path.exists(csv_path):
        print(f"[CSV] 文件不存在，创建...")
        headers = [
            "序号", "型号", "数量", "参考价",
            "拆封状态", "外盒状态", "外盒其他",
            "本体状态", "本体其他",
            "配件状态", "配件其他",
            "其他瑕疵或说明", "照片文件", "录入时间"
        ]
        try:
            with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
                writer = csv.writer(f, lineterminator='\n')
                writer.writerow(headers)
            print(f"[CSV] 初始化成功")
        except Exception as e:
            print(f"[CSV] 初始化失败: {e}")
            dialogs.alert("CSV 初始化失败", str(e))
    return csv_path


def read_all_items(list_name):
    csv_path = get_csv_path(list_name)
    items = []
    if os.path.exists(csv_path):
        try:
            with open(csv_path, 'r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # 清理可能残留的 BOM header key
                    cleaned = {}
                    for k, v in row.items():
                        k = k.lstrip('\ufeff') if k else k
                        cleaned[k] = v
                    items.append(cleaned)
        except Exception as e:
            print(f"读取 CSV 失败: {e}")
    return items


def get_next_sequence(list_name):
    items = read_all_items(list_name)
    if not items:
        return 1
    max_seq = 0
    for item in items:
        try:
            seq = int(item.get("序号", 0))
            if seq > max_seq:
                max_seq = seq
        except (ValueError, TypeError):
            pass
    return max_seq + 1


def check_duplicate_seq(list_name, seq_num):
    items = read_all_items(list_name)
    for item in items:
        try:
            if int(item.get("序号", 0)) == int(seq_num):
                return True
        except (ValueError, TypeError):
            pass
    return False


def append_item_to_csv(list_name, item_data):
    """追加一条记录到 CSV（简单 open-write 方式，避免 Pythonista newline 兼容问题）"""
    csv_path = init_csv(list_name)
    print(f"[保存] 追加到: {csv_path}")
    print(f"[保存] 数据: {item_data}")
    try:
        row = [
            str(item_data.get("序号", "")),
            str(item_data.get("型号", "")),
            str(item_data.get("数量", "")),
            str(item_data.get("参考价", "")),
            str(item_data.get("拆封状态", "")),
            str(item_data.get("外盒状态", "")),
            str(item_data.get("外盒其他", "")),
            str(item_data.get("本体状态", "")),
            str(item_data.get("本体其他", "")),
            str(item_data.get("配件状态", "")),
            str(item_data.get("配件其他", "")),
            str(item_data.get("其他瑕疵或说明", "")),
            str(item_data.get("照片文件", "")),
            datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ]
        # 用 open + csv.writer 方式
        with open(csv_path, 'a', encoding='utf-8') as f:
            writer = csv.writer(f, lineterminator='\n')
            writer.writerow(row)
            writer.writerow(row)
        print("[保存] ✅ 成功")
    except Exception as e:
        print(f"[保存] ❌ 失败: {e}")
        import traceback
        traceback.print_exc()
        raise


CSV_HEADERS = [
    "序号", "型号", "数量", "参考价",
    "拆封状态", "外盒状态", "外盒其他",
    "本体状态", "本体其他",
    "配件状态", "配件其他",
    "其他瑕疵或说明", "照片文件", "录入时间"
]


def update_item_in_csv(list_name, seq, item_data):
    """按序号更新 CSV 中已有的行"""
    csv_path = init_csv(list_name)
    rows = []
    found = False
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                if str(row.get("序号", "")) == str(seq):
                    # 更新这一行
                    new_row = {h: str(item_data.get(h, row.get(h, ""))) for h in CSV_HEADERS}
                    if not new_row.get("录入时间"):
                        new_row["录入时间"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    rows.append(new_row)
                    found = True
                else:
                    rows.append(row)
            except Exception as e:
                print(f"[更新] 跳过一行: {e}")
                rows.append(row)
    if not found:
        return False
    # 重写 CSV
    tmp_path = csv_path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS, lineterminator='')
        writer.writeheader()
        for r in rows:
            writer.writerow({h: r.get(h, "") for h in CSV_HEADERS})
    os.replace(tmp_path, csv_path)
    print(f"[更新] ✅ 序号 {seq} 已更新")
    return True


def sanitize_filename(name):
    invalid = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
    for ch in invalid:
        name = name.replace(ch, '_')
    return name.strip()


# ============ 拍照功能（简化版，确保 Pythonista 兼容） ============
def take_photos(list_name, seq, model):
    """多角度拍照，文件名：序号-型号-N.jpg"""
    folder = get_list_folder(list_name)
    photo_paths = []
    angle = 1
    safe_model = sanitize_filename(model) if model else "未知型号"

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
        filename = f"{seq}-{safe_model}-{angle}.jpg"
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
    """按型号自然排序，重编序号，写回 CSV"""
    import re
    csv_path = init_csv(list_name)
    items = read_all_items(list_name)
    if len(items) < 2:
        return 0  # 无需排序

    def natural_key(s):
        """自然排序键：数字段按数值比，字符串段按字典序"""
        s = str(s or "")
        parts = re.split(r'(\d+)', s)
        return [int(p) if p.isdigit() else p.lower() for p in parts]

    items.sort(key=lambda r: natural_key(r.get("型号", "")))

    # 重编序号
    for i, row in enumerate(items, 1):
        row["序号"] = str(i)

    # 写回 CSV（带 BOM）
    with open(csv_path, 'w', encoding='utf-8') as f:
        f.write('﻿')
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS, lineterminator='\n')
        writer.writeheader()
        writer.writerows(items)

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
            csv_path = get_csv_path(self.current_list_name)
            items = read_all_items(self.current_list_name)
            self.list_name_label.text = f"当前清单：{self.current_list_name}"
            # 显示详细状态和路径
            base = os.path.expanduser("~")
            folder_short = folder.replace(base, "~")
            self.stats_label.text = (
                f"📂 共 {len(items)} 项\n"
                f"📄 {folder_short}/寄售清单.csv\n"
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

            # 创建 CSV
            csv_path = init_csv(list_name)
            print(f"[新建] CSV: {csv_path}, 存在: {os.path.exists(csv_path)}")

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
            csv_path = get_csv_path(self.current_list_name)
            if os.path.exists(csv_path):
                _share.share_file(csv_path) if _share else dialogs.alert("CSV 位置", csv_path)
            else:
                dialogs.alert("提示", "清单文件不存在")
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
        csv_path = get_csv_path(self.current_list_name)
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
        parts.append(f"📄 CSV 清单：{'✅' if os.path.exists(csv_path) else '❌'}")
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
            if it.get("外盒状态"): cp.append("盒:"+it["外盒状态"].replace("|", "、"))
            if it.get("本体状态"): cp.append("本:"+it["本体状态"].replace("|", "、"))
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
            if it.get("外盒状态"): cp.append("盒:" + it["外盒状态"].replace("|", "、"))
            if it.get("本体状态"): cp.append("本:" + it["本体状态"].replace("|", "、"))
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
            if it.get("外盒状态"): cp.append("盒:"+it["外盒状态"].replace("|", "、"))
            if it.get("本体状态"): cp.append("本:"+it["本体状态"].replace("|", "、"))
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
def _safe_image_from_file(path):
    """兼容中文路径的图片加载 (PIL → ui.Image)"""
    import PIL.Image as PILImage
    if not path or not os.path.exists(path):
        return None
    try:
        return ui.Image.from_file(path)
    except Exception:
        pass
    try:
        pil_img = PILImage.open(path)
        pil_img.load()
        return ui.Image.from_pil_image(pil_img)
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
        """渲染图片缩略图网格 — 4列正方形"""
        # 清除旧的
        for v in list(self.thumb_container.subviews):
            self.thumb_container.remove_subview(v)
        self._thumb_views = []

        photo_dir = self._get_photo_folder()
        n = len(self.photo_files)
        print(f"[缩略图] photo_dir={photo_dir}")
        print(f"[缩略图] photo_files={self.photo_files}")

        thumb_size = 78       # 正方形缩略图大小
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
            # 路径处理：如果 fname 已经是绝对路径，直接用；否则拼 photo_dir
            if os.path.isabs(fname):
                fp = fname
            else:
                fp = os.path.join(photo_dir, fname)
            print(f"[缩略图] #{idx} fname={fname!r} → fp={fp!r} exists={os.path.exists(fp)}")

            col = idx % cols
            row = idx // cols
            x = col * (thumb_size + gap)
            y = row * (thumb_size + gap)

            btn = ui.Button()
            btn.frame = (x, y, thumb_size, thumb_size)
            btn.corner_radius = 6
            btn.border_width = 1
            btn.border_color = '#ddd'
            btn.background_color = '#f5f5f5'

            # 加载图片 (用兼容中文路径的 helper)
            img = _safe_image_from_file(fp)
            if img:
                btn.image = img
            else:
                if os.path.exists(fp):
                    btn.title = "🖼"  # 文件存在但无法解码
                else:
                    btn.title = "❓"  # 文件不存在
                btn.font = ('Helvetica', 24)
                btn.tint_color = '#999'

            def make_handler(path=fp, name=fname, i=idx):
                def handler(sender):
                    self._show_large_image(path, name)
                return handler
            btn.action = make_handler()
            self.thumb_container.add_subview(btn)
            self._thumb_views.append(btn)

    def _show_large_image(self, img_path, fname):
        """全屏弹窗显示大图"""
        mask = ui.View(frame=(0, 0, ui.get_screen_size().width, ui.get_screen_size().height))
        mask.background_color = (0, 0, 0, 0.9)
        mask.flex = 'WH'

        # 图片 (同样用兼容中文路径的 helper)
        img_view = ui.ImageView()
        img_view.image = _safe_image_from_file(img_path)
        print(f"[大图] path={img_path!r} exists={os.path.exists(img_path)} loaded={img_view.image is not None}")
        img_view.content_mode = ui.CONTENT_SCALE_ASPECT_FIT
        img_view.flex = 'WH'
        mask.add_subview(img_view)

        # 文件名 label (顶部)
        lbl = ui.Label()
        lbl.text = fname
        lbl.text_color = '#fff'
        lbl.font = ('Helvetica', 12)
        lbl.alignment = ui.ALIGN_CENTER
        lbl.flex = 'TB'
        lbl.height = 30
        mask.add_subview(lbl)

        # 关闭按钮
        close = ui.Button()
        close.title = "✕ 关闭"
        close.tint_color = '#fff'
        close.font = ('Helvetica', 14)
        close.action = lambda s: mask.close()
        close.flex = 'TB'
        close.height = 50
        mask.add_subview(close)

        mask.present('sheet')

    # ========= 加载已有货品 =========
    def _load_item(self, idx):
        """从 CSV 加载第 idx 行到表单"""
        if idx < 0 or idx >= len(self.items):
            return
        self.current_idx = idx
        item = self.items[idx]

        self.txt_seq.text = item.get("序号", "")
        self.txt_model.text = item.get("型号", "")
        self.txt_qty.text = item.get("数量", "1") or "1"
        self.txt_price.text = item.get("参考价", "")

        # 拆封单选
        seal = item.get("拆封状态", "")
        if seal in SEAL_OPTIONS:
            self.seal_seg.selected_index = SEAL_OPTIONS.index(seal)
        else:
            self.seal_seg.selected_index = 0

        # 外盒多选
        box = set(item.get("外盒状态", "").split("|"))
        for opt, cb in self.box_checks:
            cb.title = "☑" if opt in box else "☐"
        self.txt_box_other.text = item.get("外盒其他", "")

        # 本体多选
        itm = set(item.get("本体状态", "").split("|"))
        for opt, cb in self.item_checks:
            cb.title = "☑" if opt in itm else "☐"
        self.txt_item_other.text = item.get("本体其他", "")

        # 配件多选
        acc = set(item.get("配件状态", "").split("|"))
        for opt, cb in self.acc_checks:
            cb.title = "☑" if opt in acc else "☐"
        self.txt_acc_other.text = item.get("配件其他", "")

        self.txt_other.text = item.get("其他瑕疵或说明", "")

        # 图片
        self.photo_files = [f for f in item.get("照片文件", "").split(";") if f]
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
        items_data["序号"] = seq
        items_data["型号"] = model
        items_data["数量"] = self.txt_qty.text.strip() or "1"
        items_data["参考价"] = self.txt_price.text.strip()
        items_data["照片文件"] = ";".join(self.photo_files)
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
        data["外盒状态"] = "|".join(o for o, b in self.box_checks if is_checked(b))
        data["外盒其他"] = self.txt_box_other.text.strip()
        data["本体状态"] = "|".join(o for o, b in self.item_checks if is_checked(b))
        data["本体其他"] = self.txt_item_other.text.strip()
        data["配件状态"] = "|".join(o for o, b in self.acc_checks if is_checked(b))
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
        item_data["照片文件"] = ";".join(self.photo_files)

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
        """从 CSV 删掉序号为 seq 的行"""
        csv_path = get_csv_path(self.list_name)
        rows = []
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if str(row.get("序号", "")) != str(seq):
                    rows.append(row)
        tmp_path = csv_path + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=CSV_HEADERS, lineterminator=chr(10))
            writer.writeheader()
            for r in rows:
                writer.writerow({h: r.get(h, "") for h in CSV_HEADERS})
        os.replace(tmp_path, csv_path)

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

        self.load_data()

    def _build_html(self):
        import html as _hm
        items = read_all_items(self.list_name)

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
                cond_parts.append("盒:" + it["外盒状态"].replace("|", "、"))
            if it.get("本体状态"):
                cond_parts.append("本:" + it["本体状态"].replace("|", "、"))
            if it.get("配件状态"):
                cond_parts.append("配:" + it["配件状态"].replace("|", "、"))
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
