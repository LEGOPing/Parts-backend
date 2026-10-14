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
    """初始化 CSV 文件（带 BOM，Excel 能直接打开）"""
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
            f = open(csv_path, 'wb')
            # 写 BOM
            f.write('\ufeff'.encode('utf-8'))
            f.close()
            # 写表头
            f = open(csv_path, 'a', encoding='utf-8')
            writer = csv.writer(f)
            writer.writerow(headers)
            f.close()
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
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    items.append(row)
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
        print("[保存] ✅ 成功")
    except Exception as e:
        print(f"[保存] ❌ 失败: {e}")
        import traceback
        traceback.print_exc()
        raise


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

        self.btn_list_name = self.make_button("📋 新建清单 / 切换清单", '#007aff')
        self.btn_list_name.action = self.on_choose_or_switch
        self.add_subview(self.btn_list_name)

        self.btn_add = self.make_button("➕ 添加玩具信息", '#34c759')
        self.btn_add.action = self.on_add_item
        self.add_subview(self.btn_add)

        self.btn_view = self.make_button("📄 查看当前清单", '#ff9500')
        self.btn_view.action = self.on_view_list
        self.add_subview(self.btn_view)

        self.btn_export = self.make_button("📤 导出 CSV", '#5856d6')
        self.btn_export.action = self.on_export_csv
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

    def make_button(self, title, color):
        btn = ui.Button()
        btn.title = title
        btn.font = ('Helvetica', 17)
        btn.tint_color = 'white'
        btn.background_color = color
        btn.corner_radius = 10
        btn.height = 50
        return btn

    def layout(self):
        w = self.width
        self.title_label.frame = (20, 60, w - 40, 40)
        self.list_name_label.frame = (20, 105, w - 40, 40)
        btn_w = min(w - 40, 320)
        x = (w - btn_w) / 2
        self.btn_list_name.frame = (x, 155, btn_w, 50)
        self.btn_add.frame = (x, 220, btn_w, 50)
        self.btn_view.frame = (x, 285, btn_w, 50)
        self.btn_export.frame = (x, 350, btn_w, 50)
        self.btn_show_folder.frame = (x, 415, btn_w, 50)
        self.stats_label.frame = (20, 480, w - 40, 140)

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

    def on_new_list(self):
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

    def on_switch_list(self):
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

    def on_export_csv(self, sender=None):
        if not self.current_list_name:
            dialogs.alert("提示", "请先选择清单")
            return
        csv_path = get_csv_path(self.current_list_name)
        if os.path.exists(csv_path):
            try:
                import share
                share.share_file(csv_path)
            except Exception:
                dialogs.alert("CSV 文件位置", csv_path)
        else:
            dialogs.alert("提示", "清单文件不存在")

    def on_show_folder(self, sender=None):
        """显示文件夹位置，并尝试打开"""
        if not self.current_list_name:
            dialogs.alert("提示", "请先选择清单")
            return
        folder = get_list_folder(self.current_list_name)
        csv_path = get_csv_path(self.current_list_name)
        base = os.path.expanduser("~")
        print(f"[打开文件夹] {folder}")
        print(f"[打开文件夹] 存在: {os.path.exists(folder)}")
        # 列出文件夹里的内容
        contents = []
        try:
            for f in sorted(os.listdir(folder)):
                fp = os.path.join(folder, f)
                size = os.path.getsize(fp)
                contents.append(f"{f}  ({size} bytes)")
        except Exception as e:
            contents.append(f"读取失败: {e}")
        content_text = "\n".join(contents) if contents else "(文件夹是空的)"
        # 对话框显示
        msg = (f"📁 子文件夹已存在：\n{folder}\n\n"
               f"📄 CSV文件：{'存在 ✅' if os.path.exists(csv_path) else '不存在 ❌'}\n\n"
               f"📂 文件夹内容：\n{content_text}")
        try:
            import share
            # share.share_file 仅支持文件，不支持文件夹，这里仅提示
        except Exception:
            pass
        dialogs.alert("📁 子文件夹位置", msg)



# ============ 数据输入表单（内嵌盒况）============
class InputForm(ui.View):
    """玩具信息输入表单 — 盒况直接内嵌在页面上"""

    @classmethod
    def open(cls, list_name, seq, parent=None):
        form = cls(list_name, seq, parent)
        form.present(style='sheet', hide_title_bar=False)

    def __init__(self, list_name, initial_seq, parent=None):
        super().__init__()
        self.list_name = list_name
        self.parent_controller = parent
        self.photo_files = []
        self.condition_data = {}

        self.background_color = '#f2f2f7'

        # 外层：主视图（有标题栏）
        # 内层：ScrollView 容器（装所有表单控件，能滚动）
        self.scroll = ui.ScrollView()
        self.scroll.frame = (0, 0, self.width, self.height)
        self.scroll.scroll_enabled = True
        self.scroll.content_size = (400, 1400)
        self.add_subview(self.scroll)

        y = 20  # 相对 scroll 的 y 坐标

        # ===== 第1行：序号 + 拍照按钮 + 保存按钮 =====
        def small_lbl(t):
            l = ui.Label()
            l.text = t; l.font = ('Helvetica', 15); l.text_color = '#333'
            return l

        # 序号 label
        lbl = small_lbl("序号")
        lbl.frame = (20, y, 50, 34)
        self.scroll.add_subview(lbl)

        # 序号输入框（比之前短，右边还要放两个按钮）
        self.txt_seq = ui.TextField()
        self.txt_seq.frame = (72, y - 2, 80, 34)
        self.txt_seq.border_width = 1; self.txt_seq.border_color = '#ccc'
        self.txt_seq.corner_radius = 6
        self.txt_seq.text = str(initial_seq)
        self.scroll.add_subview(self.txt_seq)

        # 拍照按钮（右边）
        self.btn_photo = ui.Button()
        self.btn_photo.title = "📷拍照"
        self.btn_photo.font = ('Helvetica', 13); self.btn_photo.tint_color = 'white'
        self.btn_photo.background_color = '#007aff'; self.btn_photo.corner_radius = 6
        self.btn_photo.frame = (160, y - 2, 75, 34)
        self.btn_photo.action = self.on_take_photos
        self.scroll.add_subview(self.btn_photo)

        # 保存按钮（更右边）
        self.btn_save = ui.Button()
        self.btn_save.title = "💾保存"
        self.btn_save.font = ('Helvetica', 13); self.btn_save.tint_color = 'white'
        self.btn_save.background_color = '#34c759'; self.btn_save.corner_radius = 6
        self.btn_save.frame = (238, y - 2, 75, 34)
        self.btn_save.action = self.on_save
        self.scroll.add_subview(self.btn_save)

        self.lbl_photo_status = ui.Label()
        self.lbl_photo_status.text = ""
        self.lbl_photo_status.font = ('Helvetica', 11); self.lbl_photo_status.text_alignment = ui.ALIGN_CENTER
        self.lbl_photo_status.text_color = '#666'
        self.lbl_photo_status.frame = (318, y - 2, 50, 34)
        self.scroll.add_subview(self.lbl_photo_status)

        y += 50

        # ===== 第2行：型号 =====
        lbl = small_lbl("型号"); lbl.frame = (20, y, 50, 30)
        self.scroll.add_subview(lbl)
        self.txt_model = ui.TextField()
        self.txt_model.frame = (72, y - 2, 280, 34)
        self.txt_model.border_width = 1; self.txt_model.border_color = '#ccc'
        self.txt_model.corner_radius = 6
        self.txt_model.placeholder = "例如：MG Freedom 2.0"
        self.scroll.add_subview(self.txt_model)
        y += 42

        # ===== 第3行：数量 + 参考价（同一行）=====
        lbl = small_lbl("数量"); lbl.frame = (20, y, 50, 30)
        self.scroll.add_subview(lbl)
        self.txt_qty = ui.TextField()
        self.txt_qty.frame = (72, y - 2, 70, 34)
        self.txt_qty.border_width = 1; self.txt_qty.border_color = '#ccc'
        self.txt_qty.corner_radius = 6; self.txt_qty.keyboard_type = ui.KEYBOARD_NUMBER_PAD
        self.txt_qty.text = "1"
        self.scroll.add_subview(self.txt_qty)

        lbl = small_lbl("参考价"); lbl.frame = (150, y, 60, 30)
        self.scroll.add_subview(lbl)
        self.txt_price = ui.TextField()
        self.txt_price.frame = (212, y - 2, 140, 34)
        self.txt_price.border_width = 1; self.txt_price.border_color = '#ccc'
        self.txt_price.corner_radius = 6; self.txt_price.keyboard_type = ui.KEYBOARD_DECIMAL_PAD
        self.txt_price.placeholder = "例如：280"
        self.scroll.add_subview(self.txt_price)
        y += 52

        # ============================================================
        # 盒况信息 —— 全部内嵌，直接显示在页面上
        # ============================================================

        def section(t):
            """标题 + 分隔线"""
            lbl = ui.Label()
            lbl.text = t
            lbl.font = ('Helvetica-Bold', 13); lbl.text_color = '#1a1a1a'
            lbl.frame = (16, y, 340, 22)
            self.scroll.add_subview(lbl)
            line = ui.View()
            line.background_color = '#e0e0e0'
            line.frame = (16, y + 24, 340, 0.5)
            self.scroll.add_subview(line)
            return y + 30

        def make_checkbox(text, cx, cy):
            """在指定坐标创建 ☑/☐ 勾选按钮 + 标签（同一行）"""
            cb = ui.Button()
            cb.title = "☐"; cb.font = ('Helvetica', 14); cb.tint_color = '#333'
            cb.frame = (cx, cy - 3, 26, 24)
            def toggle(sender, b=cb):
                b.title = "☑" if b.title == "☐" else "☐"
            cb.action = toggle
            self.scroll.add_subview(cb)
            lbl = ui.Label()
            lbl.text = text; lbl.font = ('Helvetica', 13)
            lbl.frame = (cx + 26, cy, 64, 24)
            self.scroll.add_subview(lbl)
            return cb

        # ---- 拆封状态（SegmentedControl 小圆点单选）----
        y = section("拆封状态（单选）")
        self.seal_seg = ui.SegmentedControl()
        self.seal_seg.segments = SEAL_OPTIONS
        self.seal_seg.selected_index = 0
        self.seal_seg.frame = (16, y, 340, 36)
        self.scroll.add_subview(self.seal_seg)
        y += 44

        # ---- 外盒状态：2列网格 + 其他输入框 ----
        y = section("外盒状态（可多选）")
        self.box_checks = []
        non_other = [o for o in BOX_CONDITION_OPTIONS if o != "其他"]
        for i, opt in enumerate(non_other):
            col = i % 4
            row_idx = i // 2
            x_pos = 16 + col * 90
            row_y = y + row_idx * 30
            cb = make_checkbox(opt, x_pos, row_y)
            self.box_checks.append((opt, cb))
        y += ((len(non_other) + 3) // 4) * 32 + 6
        # "其他" + 输入框 同一行
        cb_other = make_checkbox("其他", 16, y)
        self.box_checks.append(("其他", cb_other))
        self.txt_box_other = ui.TextField()
        self.txt_box_other.frame = (78, y - 3, 278, 28)
        self.txt_box_other.border_width = 1; self.txt_box_other.border_color = '#ddd'
        self.txt_box_other.corner_radius = 4
        self.scroll.add_subview(self.txt_box_other)
        y += 36

        # ---- 本体状态：2列网格 + 其他输入框 ----
        y = section("本体状态（可多选）")
        self.item_checks = []
        non_other = [o for o in ITEM_CONDITION_OPTIONS if o != "其他"]
        for i, opt in enumerate(non_other):
            col = i % 4
            row_idx = i // 2
            x_pos = 16 + col * 90
            row_y = y + row_idx * 30
            cb = make_checkbox(opt, x_pos, row_y)
            self.item_checks.append((opt, cb))
        y += ((len(non_other) + 3) // 4) * 32 + 6
        cb_other = make_checkbox("其他", 16, y)
        self.item_checks.append(("其他", cb_other))
        self.txt_item_other = ui.TextField()
        self.txt_item_other.frame = (78, y - 3, 278, 28)
        self.txt_item_other.border_width = 1; self.txt_item_other.border_color = '#ddd'
        self.txt_item_other.corner_radius = 4
        self.scroll.add_subview(self.txt_item_other)
        y += 36

        # ---- 配件状态：2列网格 + 其他输入框 ----
        y = section("配件状态（可多选）")
        self.acc_checks = []
        non_other = [o for o in ACCESSORY_OPTIONS if o != "其他"]
        for i, opt in enumerate(non_other):
            col = i % 4
            row_idx = i // 2
            x_pos = 16 + col * 90
            row_y = y + row_idx * 30
            cb = make_checkbox(opt, x_pos, row_y)
            self.acc_checks.append((opt, cb))
        y += ((len(non_other) + 3) // 4) * 32 + 6
        cb_other = make_checkbox("其他", 16, y)
        self.acc_checks.append(("其他", cb_other))
        self.txt_acc_other = ui.TextField()
        self.txt_acc_other.frame = (78, y - 3, 278, 28)
        self.txt_acc_other.border_width = 1; self.txt_acc_other.border_color = '#ddd'
        self.txt_acc_other.corner_radius = 4
        self.scroll.add_subview(self.txt_acc_other)
        y += 36

        # ---- 其他瑕疵 ----
        y = section("其他瑕疵或说明")
        self.txt_other = ui.TextView()
        self.txt_other.frame = (16, y, 340, 90)
        self.txt_other.border_width = 1; self.txt_other.border_color = '#ddd'
        self.txt_other.corner_radius = 4
        self.scroll.add_subview(self.txt_other)
        y += 100

        # 把最终 y 存起来，供 layout 和 content_size 用
        self._form_bottom_y = y

        # ---- 返回按钮（底部）----
        y_back = max(self._form_bottom_y + 20, 1150)
        self.btn_cancel = ui.Button()
        self.btn_cancel.title = "返回"
        self.btn_cancel.font = ('Helvetica', 15); self.btn_cancel.tint_color = '#007aff'
        self.btn_cancel.frame = (20, y_back, 340, 44)
        self.btn_cancel.action = self.on_cancel
        self.scroll.add_subview(self.btn_cancel)

        # 设置 ScrollView 内容高度 — 用实际 y
        final_y = getattr(self, '_form_bottom_y', y + 40)
        self.scroll.content_size = (400, final_y + 50)

    # ========= 回调方法 =========
    def on_take_photos(self, sender):
        seq = self.txt_seq.text.strip()
        model = self.txt_model.text.strip()
        if not model:
            dialogs.alert("提示", "请先填写型号")
            return
        if not seq:
            dialogs.alert("提示", "请填写序号")
            return
        photos_list = take_photos(self.list_name, seq, model)
        self.photo_files = photos_list
        if photos_list:
            self.lbl_photo_status.text = f"{len(photos_list)}张"
            self.lbl_photo_status.text_color = '#34c759'
        else:
            self.lbl_photo_status.text = ""
            self.lbl_photo_status.text_color = '#666'

    def collect_condition_data(self):
        """从内嵌控件收集盒况数据 —— checkbox 按钮用 title 判断"""
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

    def on_save(self, sender):
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

        # 重复检查
        try:
            if check_duplicate_seq(self.list_name, int(seq)):
                result = dialogs.alert("序号重复", f"序号 {seq} 已存在，\n要覆盖吗？",
                                     "覆盖", "返回", hide_cancel_button=True)
                if result == 2:  # button2 = 返回
                    return
        except ValueError:
            pass

        item_data = {"序号": seq, "型号": model, "数量": qty, "参考价": price}
        item_data.update(self.collect_condition_data())
        item_data["照片文件"] = ";".join(self.photo_files)

        try:
            append_item_to_csv(self.list_name, item_data)
            if self.parent_controller:
                self.parent_controller.update_info()
            dialogs.alert("成功", f"已保存：\n{seq} - {model}")
            self.close()
        except Exception as e:
            import traceback
            traceback.print_exc()
            dialogs.alert("保存失败", str(e))

    def on_cancel(self, sender):
        self.close()

    def layout(self):
        # 让内部 ScrollView 跟随外层 View 大小
        self.scroll.frame = (0, 0, self.width, self.height)


# ============ 清单查看器 ============
class ListViewer(ui.View):

    @classmethod
    def open(cls, list_name):
        viewer = cls(list_name)
        viewer.present(style='sheet', hide_title_bar=False)

    def __init__(self, list_name):
        super().__init__()
        self.list_name = list_name
        self.background_color = 'white'

        # 标题（第一行，16号黑体）
        self.title_label = ui.Label()
        self.title_label.text = "附件：寄售玩具清单"
        self.title_label.font = ('Helvetica-Bold', 16)
        self.title_label.text_alignment = ui.ALIGN_CENTER
        self.title_label.text_color = 'black'
        self.title_label.frame = (20, 80, self.width - 40, 24)
        self.add_subview(self.title_label)

        # 第二行说明（10号字）
        self.subtitle_label = ui.Label()
        self.subtitle_label.text = "（本清单一式两份，双方各执一份；随附交接照片和视频）"
        self.subtitle_label.font = ('Helvetica', 10)
        self.subtitle_label.text_alignment = ui.ALIGN_CENTER
        self.subtitle_label.text_color = '#666'
        self.subtitle_label.frame = (20, 108, self.width - 40, 18)
        self.subtitle_label.number_of_lines = 0
        self.add_subview(self.subtitle_label)

        self.list_name_label = ui.Label()
        self.list_name_label.text = f"清单：{list_name}"
        self.list_name_label.font = ('Helvetica-Bold', 14)
        self.list_name_label.text_alignment = ui.ALIGN_CENTER
        self.list_name_label.text_color = '#007aff'
        self.list_name_label.frame = (20, 135, self.width - 40, 22)
        self.add_subview(self.list_name_label)

        self.table_view = ui.TextView()
        self.table_view.frame = (10, 165, self.width - 20, self.height - 260)
        self.table_view.font = ('Menlo', 12)
        self.table_view.editable = False
        self.table_view.background_color = '#f9f9f9'
        self.add_subview(self.table_view)

        self.btn_close = ui.Button()
        self.btn_close.title = "返回"
        self.btn_close.font = ('Helvetica', 15)
        self.btn_close.tint_color = '#007aff'
        self.btn_close.frame = (20, self.height - 80, self.width - 40, 44)
        self.btn_close.action = lambda s: self.close()
        self.add_subview(self.btn_close)

        self.load_data()

    def load_data(self):
        items = read_all_items(self.list_name)
        if not items:
            self.table_view.text = "（暂无记录）"
            return
        lines = ["序号  型号                    数量  参考价  盒况备注",
                 "--------------------------------------------------"]
        for it in items:
            seq = it.get("序号", "")
            model = (it.get("型号", "") or "")[:14]
            qty = it.get("数量", "")
            price = it.get("参考价", "")
            cond_parts = []
            if it.get("拆封状态"):
                cond_parts.append(it["拆封状态"])
            if it.get("外盒状态"):
                cond_parts.append("盒:" + it["外盒状态"].split("|")[0])
            cond = "/".join(cond_parts)[:16]
            lines.append(f"{seq:<4}  {model:<20}  {qty:<4}  {price:<8}  {cond}")
        self.table_view.text = "\n".join(lines)

    def layout(self):
        self.table_view.frame = (10, 165, self.width - 20, self.height - 260)
        self.btn_close.frame = (20, self.height - 80, self.width - 40, 44)


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
