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
import time
from datetime import datetime

# ============ 配置常量 ============
BASE_FOLDER_NAME = "清单"
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


# ============ 文件系统工具 ============
def get_base_folder():
    """获取清单根目录"""
    base_path = os.path.join(os.path.expanduser("~"), BASE_FOLDER_NAME)
    if not os.path.exists(base_path):
        os.makedirs(base_path)
    return base_path


def get_list_folder(list_name):
    """获取/创建指定清单的子文件夹"""
    base = get_base_folder()
    folder_path = os.path.join(base, list_name)
    if not os.path.exists(folder_path):
        os.makedirs(folder_path)
    return folder_path


def get_csv_path(list_name):
    """获取CSV文件完整路径"""
    return os.path.join(get_list_folder(list_name), CSV_FILENAME)


def get_config_path():
    """获取配置文件路径"""
    return os.path.join(os.path.expanduser("~"), CONFIG_FILENAME)


def save_config(config):
    """保存应用配置"""
    try:
        with open(get_config_path(), 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("保存配置失败:", e)


def load_config():
    """加载应用配置"""
    try:
        cfg_path = get_config_path()
        if os.path.exists(cfg_path):
            with open(cfg_path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print("加载配置失败:", e)
    return {}


def init_csv(list_name):
    """初始化CSV文件（如果不存在）"""
    csv_path = get_csv_path(list_name)
    if not os.path.exists(csv_path):
        headers = ["序号", "型号", "数量", "参考价",
                   "拆封状态", "外盒状态", "外盒其他",
                   "本体状态", "本体其他",
                   "配件状态", "配件其他",
                   "其他瑕疵或说明", "照片文件", "录入时间"]
        with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f)
            writer.writerow(headers)
    return csv_path


def read_all_items(list_name):
    """读取清单中所有项目"""
    csv_path = get_csv_path(list_name)
    items = []
    if os.path.exists(csv_path):
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                items.append(row)
    return items


def get_next_sequence(list_name):
    """获取下一个可用序号"""
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
    """检查序号是否重复"""
    items = read_all_items(list_name)
    seq_str = str(seq_num)
    for item in items:
        if str(item.get("序号", "")) == seq_str:
            return True
    return False


def append_item_to_csv(list_name, item_data):
    """追加一条记录到CSV"""
    csv_path = init_csv(list_name)
    with open(csv_path, 'a', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        row = [
            item_data.get("序号", ""),
            item_data.get("型号", ""),
            item_data.get("数量", ""),
            item_data.get("参考价", ""),
            item_data.get("拆封状态", ""),
            item_data.get("外盒状态", ""),
            item_data.get("外盒其他", ""),
            item_data.get("本体状态", ""),
            item_data.get("本体其他", ""),
            item_data.get("配件状态", ""),
            item_data.get("配件其他", ""),
            item_data.get("其他瑕疵或说明", ""),
            item_data.get("照片文件", ""),
            item_data.get("录入时间", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        ]
        writer.writerow(row)


def sanitize_filename(name):
    """清理文件名中的非法字符"""
    invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
    for ch in invalid_chars:
        name = name.replace(ch, '_')
    return name.strip()


# ============ 拍照功能 ============
def take_photos(list_name, seq, model):
    """
    多角度拍照，文件名格式：序号-型号-N.jpg
    返回保存的照片路径列表
    """
    folder = get_list_folder(list_name)
    photo_paths = []
    angle = 1
    safe_model = sanitize_filename(model) if model else "未知型号"

    # 第一次：提示从哪里获取图片
    choice = dialogs.list_dialog(
        "添加照片",
        ["📷 拍摄照片（调用相机）", "🖼️ 从相册选择", "📂 两者都用"]
    )
    if choice < 0:
        return photo_paths

    use_camera = choice in (0, 2)
    use_album = choice in (1, 2)

    while True:
        img = None

        if use_camera and angle <= 1:
            # 先用相机
            try:
                import camera
                img = camera.capture_photo()
            except Exception as e:
                print("相机调用失败:", e)
                use_camera = False

        if img is None and use_album:
            # 或从相册选
            try:
                img = photos.pick_image()
            except Exception as e:
                print("相册选择失败:", e)

        if img is None:
            if photo_paths:
                break
            else:
                return photo_paths

        # 保存图片
        filename = f"{seq}-{safe_model}-{angle}.jpg"
        filepath = os.path.join(folder, filename)
        try:
            # 使用PIL Image的save
            if hasattr(img, 'save'):
                img.save(filepath, quality=92)
            else:
                # 尝试转换
                from PIL import Image as PILImage
                if isinstance(img, PILImage.Image):
                    img.save(filepath, quality=92)
                else:
                    dialogs.alert("错误", "无法保存图片对象")
                    angle -= 1

            photo_paths.append(filename)
            angle += 1

            # 询问继续
            result = dialogs.alert("拍照", f"已保存: {filename}\n继续添加下一张？",
                              "继续", "完成", hide_cancel_button=False)
            if result is not None:
                break

        except Exception as e:
            print("保存图片失败:", e)
            dialogs.alert("错误", f"保存图片失败: {e}")
            break

    return photo_paths


# ============ 主界面 ============
class MainViewController(ui.View):
    """主控制界面"""

    def __init__(self):
        super().__init__()
        self.current_list_name = None
        self.setup_ui()
        self.load_initial_list()

    def setup_ui(self):
        self.background_color = '#f2f2f7'

        # 标题
        self.title_label = ui.Label()
        self.title_label.text = "玩具寄售清单"
        self.title_label.font = ('Helvetica-Bold', 22)
        self.title_label.text_alignment = ui.ALIGN_CENTER
        self.title_label.text_color = '#1a1a1a'
        self.add_subview(self.title_label)

        # 当前清单显示
        self.list_name_label = ui.Label()
        self.list_name_label.text = "未选择清单"
        self.list_name_label.font = ('Helvetica', 14)
        self.list_name_label.text_alignment = ui.ALIGN_CENTER
        self.list_name_label.text_color = '#666'
        self.add_subview(self.list_name_label)

        # 按钮：新建/选择清单
        self.btn_list_name = self.make_button("📋 新建或选择清单", '#007aff')
        self.btn_list_name.action = self.on_choose_list
        self.add_subview(self.btn_list_name)

        # 按钮：添加玩具
        self.btn_add = self.make_button("➕ 添加玩具信息", '#34c759')
        self.btn_add.action = self.on_add_item
        self.add_subview(self.btn_add)

        # 按钮：查看清单
        self.btn_view = self.make_button("📄 查看当前清单", '#ff9500')
        self.btn_view.action = self.on_view_list
        self.add_subview(self.btn_view)

        # 按钮：导出CSV
        self.btn_export = self.make_button("📤 导出CSV", '#5856d6')
        self.btn_export.action = self.on_export_csv
        self.add_subview(self.btn_export)

        # 按钮：切换清单
        self.btn_switch = self.make_button("🔄 切换清单", '#007aff')
        self.btn_switch.action = self.on_switch_list
        self.add_subview(self.btn_switch)

        # 项目统计
        self.stats_label = ui.Label()
        self.stats_label.text = ""
        self.stats_label.font = ('Helvetica', 12)
        self.stats_label.text_alignment = ui.ALIGN_CENTER
        self.stats_label.text_color = '#888'
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
        self.list_name_label.frame = (20, 105, w - 40, 24)

        btn_w = min(w - 40, 320)
        x = (w - btn_w) / 2

        self.btn_list_name.frame = (x, 150, btn_w, 50)
        self.btn_add.frame = (x, 215, btn_w, 50)
        self.btn_view.frame = (x, 280, btn_w, 50)
        self.btn_export.frame = (x, 345, btn_w, 50)
        self.btn_switch.frame = (x, 410, btn_w, 50)

        self.stats_label.frame = (20, 480, w - 40, 60)

    def load_initial_list(self):
        """启动时加载上次的清单"""
        cfg = load_config()
        last_list = cfg.get("last_list")
        if last_list:
            list_folder = os.path.join(get_base_folder(), last_list)
            if os.path.exists(list_folder):
                self.current_list_name = last_list
                self.update_info()
                return
        # 没有历史记录，提示创建
        self.on_choose_list()

    def update_info(self):
        if self.current_list_name:
            self.list_name_label.text = f"当前清单：{self.current_list_name}"
            # 更新项目数
            items = read_all_items(self.current_list_name)
            count = len(items)
            self.stats_label.text = f"共 {count} 项\n清单位置：{get_csv_path(self.current_list_name)}"
        else:
            self.list_name_label.text = "未选择清单"
            self.stats_label.text = ""

    def on_choose_list(self, sender=None):
        """创建新清单"""
        text = dialogs.input_dialog("新建清单", "请输入清单名称：", "例如：2026年10月寄售")
        if text and text.strip():
            list_name = text.strip()
            # 清理非法字符
            list_name = sanitize_filename(list_name)
            self.current_list_name = list_name
            get_list_folder(list_name)
            init_csv(list_name)
            save_config({"last_list": list_name})
            self.update_info()
            dialogs.alert("成功", f"已创建清单：{list_name}")

    def on_switch_list(self, sender=None):
        """切换到已有清单"""
        base = get_base_folder()
        folders = [d for d in os.listdir(base)
                   if os.path.isdir(os.path.join(base, d)) and not d.startswith('.')]
        if not folders:
            dialogs.alert("提示", "暂无已有清单，请先新建")
            self.on_choose_list()
            return

        items = list(folders)
        selected = dialogs.list_dialog("选择清单", items)
        if selected >= 0:
            self.current_list_name = items[selected]
            save_config({"last_list": self.current_list_name})
            self.update_info()

    def on_add_item(self, sender=None):
        """添加玩具信息"""
        if not self.current_list_name:
            dialogs.alert("提示", "请先选择或新建清单")
            return

        seq = get_next_sequence(self.current_list_name)
        InputForm.open(self.current_list_name, seq, parent=self)

    def on_view_list(self, sender=None):
        """查看清单"""
        if not self.current_list_name:
            dialogs.alert("提示", "请先选择清单")
            return
        ListViewer.open(self.current_list_name)

    def on_export_csv(self, sender=None):
        """导出CSV"""
        if not self.current_list_name:
            dialogs.alert("提示", "请先选择清单")
            return
        csv_path = get_csv_path(self.current_list_name)
        if os.path.exists(csv_path):
            # 尝试用其他方式打开/分享
            try:
                import share
                share.share_file(csv_path)
            except Exception:
                dialogs.alert("提示", f"CSV文件位置：\n{csv_path}")
        else:
            dialogs.alert("提示", "清单文件不存在")


# ============ 数据输入表单 ============
class InputForm(ui.View):
    """玩具信息输入表单"""

    @classmethod
    def open(cls, list_name, seq, parent=None):
        form = cls(list_name, seq, parent)
        form.present(style='sheet', hide_title_bar=False)

    def __init__(self, list_name, initial_seq, parent=None):
        super().__init__()
        self.list_name = list_name
        self.parent_controller = parent  # 主界面引用
        self.item_data = {}
        self.photo_files = []

        self.background_color = '#f2f2f7'

        # 序号
        self.lbl_seq = self.make_label("序号")
        self.lbl_seq.frame = (20, 90, 100, 30)
        self.add_subview(self.lbl_seq)

        self.txt_seq = ui.TextField()
        self.txt_seq.text = str(initial_seq)
        self.txt_seq.frame = (120, 85, 180, 36)
        self.txt_seq.border_width = 1
        self.txt_seq.border_color = '#ccc'
        self.txt_seq.corner_radius = 6
        self.txt_seq.placeholder = "序号"
        self.add_subview(self.txt_seq)

        # 型号
        self.lbl_model = self.make_label("型号")
        self.lbl_model.frame = (20, 130, 100, 30)
        self.add_subview(self.lbl_model)

        self.txt_model = ui.TextField()
        self.txt_model.frame = (120, 125, 180, 36)
        self.txt_model.border_width = 1
        self.txt_model.border_color = '#ccc'
        self.txt_model.corner_radius = 6
        self.txt_model.placeholder = "例如：MG Freedom 2.0"
        self.add_subview(self.txt_model)

        # 数量
        self.lbl_qty = self.make_label("数量")
        self.lbl_qty.frame = (20, 170, 100, 30)
        self.add_subview(self.lbl_qty)

        self.txt_qty = ui.TextField()
        self.txt_qty.text = "1"
        self.txt_qty.frame = (120, 165, 180, 36)
        self.txt_qty.border_width = 1
        self.txt_qty.border_color = '#ccc'
        self.txt_qty.corner_radius = 6
        self.txt_qty.placeholder = "数量"
        self.txt_qty.keyboard_type = ui.KEYBOARD_NUMBER_PAD
        self.add_subview(self.txt_qty)

        # 参考价
        self.lbl_price = self.make_label("参考价")
        self.lbl_price.frame = (20, 210, 100, 30)
        self.add_subview(self.lbl_price)

        self.txt_price = ui.TextField()
        self.txt_price.frame = (120, 205, 180, 36)
        self.txt_price.border_width = 1
        self.txt_price.border_color = '#ccc'
        self.txt_price.corner_radius = 6
        self.txt_price.placeholder = "例如：280"
        self.txt_price.keyboard_type = ui.KEYBOARD_DECIMAL_PAD
        self.add_subview(self.txt_price)

        # 拍照按钮
        self.btn_photo = ui.Button()
        self.btn_photo.title = "📷 拍照（多角度）"
        self.btn_photo.font = ('Helvetica', 16)
        self.btn_photo.tint_color = 'white'
        self.btn_photo.background_color = '#007aff'
        self.btn_photo.corner_radius = 10
        self.btn_photo.frame = (20, 260, 280, 45)
        self.btn_photo.action = self.on_take_photos
        self.add_subview(self.btn_photo)

        self.lbl_photo_status = ui.Label()
        self.lbl_photo_status.text = "未拍照"
        self.lbl_photo_status.font = ('Helvetica', 12)
        self.lbl_photo_status.text_alignment = ui.ALIGN_CENTER
        self.lbl_photo_status.text_color = '#666'
        self.lbl_photo_status.frame = (20, 310, 280, 20)
        self.add_subview(self.lbl_photo_status)

        # 盒况按钮
        self.btn_condition = ui.Button()
        self.btn_condition.title = "📦 填写盒况信息"
        self.btn_condition.font = ('Helvetica', 16)
        self.btn_condition.tint_color = 'white'
        self.btn_condition.background_color = '#ff9500'
        self.btn_condition.corner_radius = 10
        self.btn_condition.frame = (20, 340, 280, 45)
        self.btn_condition.action = self.on_edit_condition
        self.add_subview(self.btn_condition)

        self.lbl_condition_status = ui.Label()
        self.lbl_condition_status.text = "未填写"
        self.lbl_condition_status.font = ('Helvetica', 12)
        self.lbl_condition_status.text_alignment = ui.ALIGN_CENTER
        self.lbl_condition_status.text_color = '#666'
        self.lbl_condition_status.frame = (20, 390, 280, 30)
        self.add_subview(self.lbl_condition_status)

        # 保存按钮
        self.btn_save = ui.Button()
        self.btn_save.title = "💾 保存本项"
        self.btn_save.font = ('Helvetica-Bold', 17)
        self.btn_save.tint_color = 'white'
        self.btn_save.background_color = '#34c759'
        self.btn_save.corner_radius = 10
        self.btn_save.frame = (20, 440, 280, 50)
        self.btn_save.action = self.on_save
        self.add_subview(self.btn_save)

        # 取消按钮
        self.btn_cancel = ui.Button()
        self.btn_cancel.title = "取消"
        self.btn_cancel.font = ('Helvetica', 15)
        self.btn_cancel.tint_color = '#007aff'
        self.btn_cancel.frame = (20, 500, 280, 40)
        self.btn_cancel.action = self.on_cancel
        self.add_subview(self.btn_cancel)

        # 默认盒况数据
        self.condition_data = {}

    def make_label(self, text):
        lbl = ui.Label()
        lbl.text = text
        lbl.font = ('Helvetica', 15)
        lbl.text_color = '#333'
        return lbl

    def on_take_photos(self, sender):
        """拍照"""
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
            self.lbl_photo_status.text = f"已拍 {len(photos_list)} 张"
            self.lbl_photo_status.text_color = '#34c759'
        else:
            self.lbl_photo_status.text = "未拍照"
            self.lbl_photo_status.text_color = '#666'

    def on_edit_condition(self, sender):
        """打开盒况编辑界面"""
        ConditionEditor.open(self.condition_data, self.on_condition_saved)

    def on_condition_saved(self, data):
        self.condition_data = data
        # 更新状态显示
        parts = []
        if data.get("拆封状态"):
            parts.append(f"拆封：{data['拆封状态']}")
        if data.get("外盒状态"):
            parts.append(f"外盒：{data['外盒状态']}")
        if data.get("本体状态"):
            parts.append(f"本体：{data['本体状态']}")
        if data.get("配件状态"):
            parts.append(f"配件：{data['配件状态']}")
        if parts:
            self.lbl_condition_status.text = " | ".join(parts)
            self.lbl_condition_status.text_color = '#34c759'
        else:
            self.lbl_condition_status.text = "未填写"
            self.lbl_condition_status.text_color = '#666'

    def on_save(self, sender):
        """保存本条记录"""
        seq = self.txt_seq.text.strip()
        model = self.txt_model.text.strip()
        qty = self.txt_qty.text.strip() or "1"
        price = self.txt_price.text.strip()

        # 验证必填
        if not seq:
            dialogs.alert("提示", "请填写序号")
            return
        if not model:
            dialogs.alert("提示", "请填写型号")
            return

        # 检查序号重复
        try:
            seq_int = int(seq)
            if check_duplicate_seq(self.list_name, seq_int):
                result = dialogs.alert(
                    "序号重复", f"序号 {seq} 已存在，\n确定要覆盖原记录吗？",
                    "覆盖", "取消"
                )
                # 如果用户选"取消"，返回；选"覆盖"继续
                if result is not None:
                    return
        except ValueError:
            pass

        # 构建数据
        item_data = {
            "序号": seq,
            "型号": model,
            "数量": qty,
            "参考价": price,
        }
        item_data.update(self.condition_data)
        item_data["照片文件"] = ";".join(self.photo_files)

        # 追加到CSV
        try:
            append_item_to_csv(self.list_name, item_data)
            # 刷新主界面统计
            if self.parent_controller and hasattr(self.parent_controller, 'update_info'):
                self.parent_controller.update_info()
            dialogs.alert("成功", f"已保存：{seq} - {model}")
            self.close()
        except Exception as e:
            import traceback
            traceback.print_exc()
            dialogs.alert("错误", f"保存失败：{e}")

    def on_cancel(self, sender):
        self.close()


# ============ 盒况编辑器 ============
class ConditionEditor(ui.View):
    """盒况信息编辑界面"""

    @classmethod
    def open(cls, existing_data, callback):
        editor = cls(existing_data, callback)
        editor.present(style='sheet', hide_title_bar=False)

    def __init__(self, existing_data, callback):
        super().__init__()
        self.callback = callback
        self.existing_data = existing_data or {}
        self.background_color = '#f2f2f7'
        self.current_y = 80
        self.height = 700

        # 拆封状态（单选）
        self.add_section_label("拆封状态")
        self.seal_seg = ui.SegmentedControl()
        self.seal_seg.segments = SEAL_OPTIONS
        self.seal_seg.selected_index = 0
        # 恢复已有选择
        existing_seal = self.existing_data.get("拆封状态", "")
        if existing_seal in SEAL_OPTIONS:
            self.seal_seg.selected_index = SEAL_OPTIONS.index(existing_seal)
        self.seal_seg.frame = (20, self.current_y, self.width - 40, 40)
        self.current_y += 50
        self.add_subview(self.seal_seg)

        # 外盒状态
        self.add_section_label("外盒状态（可多选）")
        self.box_checks = self.add_multi_checkbox(BOX_CONDITION_OPTIONS, "外盒状态")
        self.current_y += len(BOX_CONDITION_OPTIONS) * 30 + 10

        # 外盒其他输入
        self.lbl_box_other = self.make_label("外盒其他说明")
        self.lbl_box_other.frame = (20, self.current_y, 140, 28)
        self.add_subview(self.lbl_box_other)

        self.txt_box_other = ui.TextField()
        self.txt_box_other.frame = (160, self.current_y - 2, self.width - 180, 32)
        self.txt_box_other.border_width = 1
        self.txt_box_other.border_color = '#ccc'
        self.txt_box_other.corner_radius = 6
        self.txt_box_other.text = self.existing_data.get("外盒其他", "")
        self.add_subview(self.txt_box_other)
        self.current_y += 40

        # 本体状态
        self.add_section_label("本体状态（可多选）")
        self.item_checks = self.add_multi_checkbox(ITEM_CONDITION_OPTIONS, "本体状态")
        self.current_y += len(ITEM_CONDITION_OPTIONS) * 30 + 10

        # 本体其他
        self.lbl_item_other = self.make_label("本体其他说明")
        self.lbl_item_other.frame = (20, self.current_y, 140, 28)
        self.add_subview(self.lbl_item_other)

        self.txt_item_other = ui.TextField()
        self.txt_item_other.frame = (160, self.current_y - 2, self.width - 180, 32)
        self.txt_item_other.border_width = 1
        self.txt_item_other.border_color = '#ccc'
        self.txt_item_other.corner_radius = 6
        self.txt_item_other.text = self.existing_data.get("本体其他", "")
        self.add_subview(self.txt_item_other)
        self.current_y += 40

        # 配件状态
        self.add_section_label("配件状态（可多选）")
        self.acc_checks = self.add_multi_checkbox(ACCESSORY_OPTIONS, "配件状态")
        self.current_y += len(ACCESSORY_OPTIONS) * 30 + 10

        # 配件其他
        self.lbl_acc_other = self.make_label("配件其他说明")
        self.lbl_acc_other.frame = (20, self.current_y, 140, 28)
        self.add_subview(self.lbl_acc_other)

        self.txt_acc_other = ui.TextField()
        self.txt_acc_other.frame = (160, self.current_y - 2, self.width - 180, 32)
        self.txt_acc_other.border_width = 1
        self.txt_acc_other.border_color = '#ccc'
        self.txt_acc_other.corner_radius = 6
        self.txt_acc_other.text = self.existing_data.get("配件其他", "")
        self.add_subview(self.txt_acc_other)
        self.current_y += 40

        # 其他瑕疵或说明
        self.add_section_label("其他瑕疵或说明")
        self.txt_other = ui.TextView()
        self.txt_other.frame = (20, self.current_y, self.width - 40, 100)
        self.txt_other.border_width = 1
        self.txt_other.border_color = '#ccc'
        self.txt_other.corner_radius = 6
        self.txt_other.text = self.existing_data.get("其他瑕疵或说明", "")
        self.add_subview(self.txt_other)
        self.current_y += 115

        # 保存按钮
        self.btn_save = ui.Button()
        self.btn_save.title = "保存盒况信息"
        self.btn_save.font = ('Helvetica-Bold', 17)
        self.btn_save.tint_color = 'white'
        self.btn_save.background_color = '#34c759'
        self.btn_save.corner_radius = 10
        self.btn_save.frame = (20, self.current_y, self.width - 40, 50)
        self.btn_save.action = self.on_save
        self.add_subview(self.btn_save)

    def add_section_label(self, text):
        lbl = ui.Label()
        lbl.text = text
        lbl.font = ('Helvetica-Bold', 16)
        lbl.text_color = '#1a1a1a'
        lbl.frame = (20, self.current_y, self.width - 40, 28)
        self.add_subview(lbl)
        self.current_y += 32

    def make_label(self, text):
        lbl = ui.Label()
        lbl.text = text
        lbl.font = ('Helvetica', 14)
        lbl.text_color = '#333'
        return lbl

    def add_multi_checkbox(self, options, data_key):
        """添加多选复选框"""
        existing = self.existing_data.get(data_key, "")
        existing_list = [x.strip() for x in existing.split("|") if x.strip()] if existing else []

        checks = []
        for opt in options:
            sw = ui.Switch()
            sw.frame = (self.width - 60, self.current_y, 40, 28)
            sw.value = opt in existing_list
            self.add_subview(sw)

            lbl = ui.Label()
            lbl.text = opt
            lbl.font = ('Helvetica', 15)
            lbl.frame = (20, self.current_y, self.width - 90, 28)
            self.add_subview(lbl)

            checks.append((opt, sw))
            self.current_y += 30

        return checks

    def on_save(self, sender):
        data = {}

        # 拆封状态
        if 0 <= self.seal_seg.selected_index < len(SEAL_OPTIONS):
            data["拆封状态"] = SEAL_OPTIONS[self.seal_seg.selected_index]

        # 外盒
        box_selected = [opt for opt, sw in self.box_checks if sw.value]
        data["外盒状态"] = "|".join(box_selected)
        data["外盒其他"] = self.txt_box_other.text.strip()

        # 本体
        item_selected = [opt for opt, sw in self.item_checks if sw.value]
        data["本体状态"] = "|".join(item_selected)
        data["本体其他"] = self.txt_item_other.text.strip()

        # 配件
        acc_selected = [opt for opt, sw in self.acc_checks if sw.value]
        data["配件状态"] = "|".join(acc_selected)
        data["配件其他"] = self.txt_acc_other.text.strip()

        # 其他
        data["其他瑕疵或说明"] = self.txt_other.text.strip()

        self.callback(data)
        self.close()


# ============ 清单查看器 ============
class ListViewer(ui.View):
    """查看当前清单"""

    @classmethod
    def open(cls, list_name):
        viewer = cls(list_name)
        viewer.present(style='sheet', hide_title_bar=False)

    def __init__(self, list_name):
        super().__init__()
        self.list_name = list_name
        self.background_color = 'white'

        # 标题行
        self.title_label = ui.Label()
        self.title_label.text = "附件：寄售玩具清单"
        self.title_label.font = ('Helvetica-Bold', 16)
        self.title_label.text_alignment = ui.ALIGN_CENTER
        self.title_label.text_color = 'black'
        self.title_label.frame = (20, 80, self.width - 40, 24)
        self.add_subview(self.title_label)

        # 副标题说明
        self.subtitle_label = ui.Label()
        self.subtitle_label.text = "（本清单一式两份，双方各执一份；随附交接照片和视频）"
        self.subtitle_label.font = ('Helvetica', 10)
        self.subtitle_label.text_alignment = ui.ALIGN_CENTER
        self.subtitle_label.text_color = '#666'
        self.subtitle_label.frame = (20, 108, self.width - 40, 18)
        self.subtitle_label.number_of_lines = 0
        self.add_subview(self.subtitle_label)

        # 清单名称
        self.list_name_label = ui.Label()
        self.list_name_label.text = f"清单：{list_name}"
        self.list_name_label.font = ('Helvetica-Bold', 14)
        self.list_name_label.text_alignment = ui.ALIGN_CENTER
        self.list_name_label.text_color = '#007aff'
        self.list_name_label.frame = (20, 135, self.width - 40, 22)
        self.add_subview(self.list_name_label)

        # 表格视图（使用ScrollView + TextView来展示）
        self.scroll = ui.ScrollView()
        self.scroll.frame = (10, 165, self.width - 20, self.height - 260)
        self.scroll.background_color = '#f9f9f9'
        self.add_subview(self.scroll)

        self.table_view = ui.TextView()
        self.table_view.frame = (0, 0, self.width - 20, 500)
        self.table_view.font = ('Menlo', 12)
        self.table_view.editable = False
        self.table_view.background_color = 'white'
        self.scroll.add_subview(self.table_view)

        # 关闭按钮
        self.btn_close = ui.Button()
        self.btn_close.title = "关闭"
        self.btn_close.font = ('Helvetica', 15)
        self.btn_close.tint_color = '#007aff'
        self.btn_close.frame = (20, self.height - 80, self.width - 40, 44)
        self.btn_close.action = lambda s: self.close()
        self.add_subview(self.btn_close)

        # 加载数据
        self.load_data()

    def load_data(self):
        items = read_all_items(self.list_name)
        if not items:
            self.table_view.text = "（暂无记录）"
            return

        lines = []
        # 表头
        header = f"{'序号':<6}{'型号':<24}{'数量':<6}{'参考价':<10}{'盒况备注':<20}"
        lines.append(header)
        lines.append("-" * 80)

        for item in items:
            seq = item.get("序号", "")
            model = item.get("型号", "")[:12]
            qty = item.get("数量", "")
            price = item.get("参考价", "")

            # 盒况摘要
            cond_parts = []
            if item.get("拆封状态"):
                cond_parts.append(item["拆封状态"])
            if item.get("外盒状态"):
                cond_parts.append("盒:" + item["外盒状态"].split("|")[0])
            cond = "/".join(cond_parts)[:18]

            line = f"{seq:<6}{model:<24}{qty:<6}{price:<10}{cond:<20}"
            lines.append(line)

        text = "\n".join(lines)
        self.table_view.text = text
        self.table_view.height = max(len(lines) * 18 + 20, self.height - 280)

    def layout(self):
        self.scroll.frame = (10, 165, self.width - 20, self.height - 260)
        self.table_view.frame = (0, 0, self.width - 20, self.table_view.height)
        self.btn_close.frame = (20, self.height - 80, self.width - 40, 44)


# ============ 入口 ============
def main():
    main_view = MainViewController()
    main_view.present(style='fullscreen', hide_title_bar=False,
                      title_bar_color='#007aff', title_color='white')


if __name__ == "__main__":
    main()
