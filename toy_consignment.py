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
    with open(csv_path, 'r', encoding='utf-8') as f:
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
    with open(tmp_path, 'w', encoding='utf-8', newline='') as f:
        f.write('\ufeff')  # BOM
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

    def _export_pdf(self, folder, safe, items, _share):
        generated = False
        try:
            from reportlab.lib import colors
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.units import mm
            from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont
            # ===== 关键：注册中文字体 =====
            # .ttc 是 TrueType Collection（多个字体打包），必须加 subfontIndex
            cn_font = False
            fam = 'Helvetica'
            registered_name = None
            def _try_ttf(name, path):
                try:
                    pdfmetrics.registerFont(TTFont(name, path))
                    return True
                except Exception: return False
            def _try_ttc(name, path, idx=0):
                try:
                    pdfmetrics.registerFont(TTFont(name, path, subfontIndex=idx))
                    return True
                except Exception: return False
            # 候选列表：(注册名, 路径, subfontIndex)
            font_candidates = [
                ('CN', '/System/Library/Fonts/PingFang.ttc', 0),
                ('CN', '/System/Library/Fonts/PingFang.ttc', 4),
                ('CN', '/System/Library/Fonts/STHeiti Light.ttc', 0),
                ('CN', '/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
                ('CN', '/Library/Fonts/Songti.ttc', 0),
            ]
            for _n, _p, _i in font_candidates:
                if os.path.exists(_p):
                    if _try_ttc(_n, _p, _i):
                        cn_font = True
                        fam = _n
                        registered_name = _n
                        print(f"[PDF] 字体注册成功: {_n} <- {_p} (idx={_i})")
                        break
            # 兜底：reportlab 内置 CID 字体（STSong-Light）
            if not cn_font:
                try:
                    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
                    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                    cn_font = True
                    fam = 'STSong-Light'
                    registered_name = fam
                    print("[PDF] 兜底 CID 字体: STSong-Light")
                except Exception as e:
                    print(f"[PDF] CID 也失败: {e}")
                    fam = 'Helvetica'
            # ====== 关键中的关键：注册字体家族 ======
            # reportlab 的 Paragraph/Table 内部会问："CN 的 bold/italic 变体在哪？"
            # 中文字体通常只有 normal，我们把 bold/italic 全部映射到 normal
            if registered_name and registered_name != 'Helvetica':
                try:
                    from reportlab.pdfbase.pdfmetrics import registerFontFamily
                    registerFontFamily(
                        registered_name,
                        normal=registered_name,
                        bold=registered_name,
                        italic=registered_name,
                        boldItalic=registered_name,
                    )
                    print(f"[PDF] 字体家族映射: {registered_name} bold/italic → normal")
                except Exception as e:
                    print(f"[PDF] 字体家族映射失败: {e}")
            print(f"[PDF] 最终字体: {fam}")
            out_path = os.path.join(folder, safe + '_清单.pdf')
            doc = SimpleDocTemplate(out_path, pagesize=A4,
                                    leftMargin=18*mm, rightMargin=18*mm,
                                    topMargin=18*mm, bottomMargin=18*mm)
            styles = getSampleStyleSheet()
            # fam 已经在字体注册环节正确设置好了
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
            # 盒况自动换行用的 style
            wrap_style = ParagraphStyle('wrap',
                                         fontName=fam, fontSize=10, leading=13)
            hd = ["序号", "型号", "数量", "参考价", "盒况备注"]
            data = [hd]
            for it in items:
                cp = []
                if it.get("拆封状态"): cp.append(it["拆封状态"])
                if it.get("外盒状态"): cp.append("盒:"+it["外盒状态"].replace("|", "、"))
                if it.get("本体状态"): cp.append("本:"+it["本体状态"].replace("|", "、"))
                cond = " ".join(cp)
                # 盒况用 Paragraph 包起来 + <br/> 让 reportlab 自动换行
                cond_wrapped = Paragraph(cond, wrap_style)
                data.append([str(it.get("序号","")), str(it.get("型号","")),
                             str(it.get("数量","")), str(it.get("参考价","")), cond_wrapped])
            # 列宽: A4 可用 174mm (210 - 2*18mm margin)
            # 序号 15 + 型号 24 + 数量 15 + 参考价 24 + 盒况备注 96 = 174 ✓
            col_widths = [15*mm, 24*mm, 15*mm, 24*mm, 96*mm]
            t = Table(data, colWidths=col_widths, repeatRows=1)
            t.setStyle(TableStyle([
                ('FONTNAME', (0,0), (-1,-1), fam),
                ('FONTSIZE', (0,0), (-1,-1), 10),
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f0f0f0')),
                ('TEXTCOLOR', (0,0), (-1,0), colors.black),
                ('ALIGN', (0,0), (-1,0), 'CENTER'),
                ('ALIGN', (0,1), (2,-1), 'CENTER'),
                ('ALIGN', (3,1), (3,-1), 'RIGHT'),
                ('ALIGN', (4,1), (4,-1), 'LEFT'),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('GRID', (0,0), (-1,-1), 0.4, colors.grey),
                # padding 加大: 默认 3pt 太挤 → 数字贴边框像重叠
                ('TOPPADDING', (0,0), (-1,-1), 6),
                ('BOTTOMPADDING', (0,0), (-1,-1), 6),
                ('LEFTPADDING', (0,0), (-1,-1), 8),
                ('RIGHTPADDING', (0,0), (-1,-1), 8),
            ]))
            story.append(t)
            story.append(Spacer(1, 20))
            story.append(Paragraph('双方签字确认：________________________', body_style))
            doc.build(story)
            generated = True
            _share.share_file(out_path) if _share else dialogs.alert("PDF 已生成", out_path)
        except ImportError:
            dialogs.alert("提示",
                "reportlab 未找到，请在 Pythonista 包管理里搜索 reportlab\\n"
                "或用 Stash 终端 pip install reportlab")
        except Exception as e:
            import traceback; traceback.print_exc()
            print(f"[reportlab] 失败: {e}")
            dialogs.alert("PDF 生成失败 (reportlab)", str(e))
        if not generated:
            self._export_pdf_via_webview(folder, safe, items, _share)

    def _export_pdf_via_webview(self, folder, safe, items, _share):
        import html as _hm
        th = '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:12pt;font-family:PingFang SC,Helvetica,sans-serif;">'
        th += '<tr bgcolor="#f0f0f0"><th align="center">序号</th><th align="center">型号</th>'
        th += '<th align="center">数量</th><th align="center">参考价</th><th align="center">盒况备注</th></tr>'
        for it in items:
            cp = []
            if it.get("拆封状态"): cp.append(it["拆封状态"])
            if it.get("外盒状态"): cp.append("盒:"+it["外盒状态"].replace("|", "、"))
            if it.get("本体状态"): cp.append("本:"+it["本体状态"].replace("|", "、"))
            cond = " ".join(cp)
            th += f'<tr><td align="center">{_hm.escape(str(it.get("序号","")))}</td>'
            th += f'<td align="center">{_hm.escape(str(it.get("型号","")))}</td>'
            th += f'<td align="center">{_hm.escape(str(it.get("数量","")))}</td>'
            th += f'<td align="right">{_hm.escape(str(it.get("参考价","")))}</td>'
            th += f'<td align="left">{_hm.escape(cond)}</td></tr>'
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
        out_path = os.path.join(folder, safe + '_清单.html')
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(html_doc)
        _share.share_file(out_path) if _share else dialogs.alert("HTML 已生成 (兜底)", out_path)

# ============ 数据输入表单（内嵌盒况）============
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

        y = 20  # 相对 scroll 的 y

        # ===== 第0行: 前 / 保存 / 后 =====
        self.btn_prev = ui.Button()
        self.btn_prev.title = "◀ 前一个"
        self.btn_prev.font = ('Helvetica', 14); self.btn_prev.tint_color = '#007aff'
        self.btn_prev.frame = (16, y, 100, 36)
        self.btn_prev.action = self.on_prev_item
        self.scroll.add_subview(self.btn_prev)

        self.btn_save_top = ui.Button()
        self.btn_save_top.title = "💾 保存"
        self.btn_save_top.font = ('Helvetica-Bold', 14); self.btn_save_top.tint_color = 'white'
        self.btn_save_top.background_color = '#34c759'; self.btn_save_top.corner_radius = 6
        self.btn_save_top.frame = (140, y - 2, 100, 40)
        self.btn_save_top.action = self.on_save
        self.scroll.add_subview(self.btn_save_top)

        self.btn_next = ui.Button()
        self.btn_next.title = "后一个 ▶"
        self.btn_next.font = ('Helvetica', 14); self.btn_next.tint_color = '#007aff'
        self.btn_next.frame = (264, y, 100, 36)
        self.btn_next.action = self.on_next_item
        self.scroll.add_subview(self.btn_next)

        # 当前序号标签 (在按钮下面)
        self.lbl_idx = ui.Label()
        self.lbl_idx.font = ('Helvetica', 11); self.lbl_idx.text_color = '#888'
        self.lbl_idx.text_alignment = ui.ALIGN_CENTER
        self.lbl_idx.frame = (16, y + 38, 340, 18)
        self.scroll.add_subview(self.lbl_idx)

        y += 62

        # ===== 第1行: 序号 + 拍照按钮 =====
        def small_lbl(t):
            l = ui.Label()
            l.text = t; l.font = ('Helvetica', 15); l.text_color = '#333'
            return l

        lbl = small_lbl("序号"); lbl.frame = (20, y, 50, 34)
        self.scroll.add_subview(lbl)

        self.txt_seq = ui.TextField()
        self.txt_seq.frame = (72, y - 2, 80, 34)
        self.txt_seq.border_width = 1; self.txt_seq.border_color = '#ccc'
        self.txt_seq.corner_radius = 6
        self.txt_seq.text = str(initial_seq)
        self.scroll.add_subview(self.txt_seq)

        self.btn_photo = ui.Button()
        self.btn_photo.title = "📷拍照"
        self.btn_photo.font = ('Helvetica', 13); self.btn_photo.tint_color = 'white'
        self.btn_photo.background_color = '#007aff'; self.btn_photo.corner_radius = 6
        self.btn_photo.frame = (160, y - 2, 90, 34)
        self.btn_photo.action = self.on_take_photos
        self.scroll.add_subview(self.btn_photo)

        self.lbl_photo_count = ui.Label()
        self.lbl_photo_count.font = ('Helvetica', 11); self.lbl_photo_count.text_alignment = ui.ALIGN_CENTER
        self.lbl_photo_count.text_color = '#666'
        self.lbl_photo_count.frame = (258, y - 2, 100, 34)
        self.scroll.add_subview(self.lbl_photo_count)

        y += 50

        # ===== 第2行: 型号 =====
        lbl = small_lbl("型号"); lbl.frame = (20, y, 50, 30)
        self.scroll.add_subview(lbl)
        self.txt_model = ui.TextField()
        self.txt_model.frame = (72, y - 2, 280, 34)
        self.txt_model.border_width = 1; self.txt_model.border_color = '#ccc'
        self.txt_model.corner_radius = 6
        self.txt_model.placeholder = "例如：MG Freedom 2.0"
        self.scroll.add_subview(self.txt_model)
        y += 36

        # ===== 第3行: 数量 + 参考价 =====
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

        # ============ 盒况 ============
        def section(t):
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

        def make_checkbox(text, cx, cy, col_w=85):
            cb = ui.Button()
            cb.title = "☐"; cb.font = ('Helvetica', 14); cb.tint_color = '#333'
            cb.frame = (cx, cy - 4, 26, 28)
            def toggle(sender, b=cb):
                b.title = "☑" if b.title == "☐" else "☐"
            cb.action = toggle
            self.scroll.add_subview(cb)
            lbl = ui.Label()
            lbl.text = text; lbl.font = ('Helvetica', 14); lbl.text_color = '#222'
            lbl.number_of_lines = 1
            lbl.adjusts_font_size_to_fit = True
            lbl.minimum_font_size = 10
            lbl.frame = (cx + 28, cy, col_w - 32, 28)
            self.scroll.add_subview(lbl)
            return cb

        # 拆封状态
        y = section("拆封状态（单选）")
        self.seal_seg = ui.SegmentedControl()
        self.seal_seg.segments = SEAL_OPTIONS
        self.seal_seg.selected_index = 0
        self.seal_seg.frame = (16, y, 340, 36)
        self.scroll.add_subview(self.seal_seg)
        y += 44

        # 外盒状态
        y = section("外盒状态（可多选）")
        self.box_checks = []
        non_other = [o for o in BOX_CONDITION_OPTIONS if o != "其他"]
        for i, opt in enumerate(non_other):
            col = i % 4; row_idx = i // 4
            x_pos = 16 + col * 85; row_y = y + row_idx * 32
            cb = make_checkbox(opt, x_pos, row_y)
            self.box_checks.append((opt, cb))
        y += ((len(non_other) + 3) // 4) * 32 + 4
        cb_other = make_checkbox("其他", 16, y)
        self.box_checks.append(("其他", cb_other))
        self.txt_box_other = ui.TextField()
        self.txt_box_other.frame = (101, y - 3, 258, 28)
        self.txt_box_other.border_width = 1; self.txt_box_other.border_color = '#ddd'
        self.txt_box_other.corner_radius = 4
        self.scroll.add_subview(self.txt_box_other)
        y += 36

        # 本体状态
        y = section("本体状态（可多选）")
        self.item_checks = []
        non_other = [o for o in ITEM_CONDITION_OPTIONS if o != "其他"]
        for i, opt in enumerate(non_other):
            col = i % 4; row_idx = i // 4
            x_pos = 16 + col * 85; row_y = y + row_idx * 32
            cb = make_checkbox(opt, x_pos, row_y)
            self.item_checks.append((opt, cb))
        y += ((len(non_other) + 3) // 4) * 32 + 4
        cb_other = make_checkbox("其他", 16, y)
        self.item_checks.append(("其他", cb_other))
        self.txt_item_other = ui.TextField()
        self.txt_item_other.frame = (101, y - 3, 258, 28)
        self.txt_item_other.border_width = 1; self.txt_item_other.border_color = '#ddd'
        self.txt_item_other.corner_radius = 4
        self.scroll.add_subview(self.txt_item_other)
        y += 36

        # 配件状态
        y = section("配件状态（可多选）")
        self.acc_checks = []
        non_other = [o for o in ACCESSORY_OPTIONS if o != "其他"]
        for i, opt in enumerate(non_other):
            col = i % 4; row_idx = i // 4
            x_pos = 16 + col * 85; row_y = y + row_idx * 32
            cb = make_checkbox(opt, x_pos, row_y)
            self.acc_checks.append((opt, cb))
        y += ((len(non_other) + 3) // 4) * 32 + 4
        cb_other = make_checkbox("其他", 16, y)
        self.acc_checks.append(("其他", cb_other))
        self.txt_acc_other = ui.TextField()
        self.txt_acc_other.frame = (101, y - 3, 258, 28)
        self.txt_acc_other.border_width = 1; self.txt_acc_other.border_color = '#ddd'
        self.txt_acc_other.corner_radius = 4
        self.scroll.add_subview(self.txt_acc_other)
        y += 42

        # 其他瑕疵
        y = section("其他瑕疵或说明")
        self.txt_other = ui.TextView()
        self.txt_other.frame = (16, y, 340, 90)
        self.txt_other.border_width = 1; self.txt_other.border_color = '#ddd'
        self.txt_other.corner_radius = 4
        self.scroll.add_subview(self.txt_other)
        y += 100

        # ============ 图片缩略图区 ============
        y = section("📷 图片（点击缩略图看大图）")
        self.thumb_container = ui.View()
        self.thumb_container.frame = (16, y, 340, 300)  # 高度动态调整
        self.scroll.add_subview(self.thumb_container)
        y += 300

        # 返回按钮
        self.btn_cancel = ui.Button()
        self.btn_cancel.title = "返回"
        self.btn_cancel.font = ('Helvetica', 15); self.btn_cancel.tint_color = '#007aff'
        self.btn_cancel.frame = (20, y + 10, 340, 44)
        self.btn_cancel.action = self.on_cancel
        self.scroll.add_subview(self.btn_cancel)
        y += 70

        self._form_bottom_y = y
        self.scroll.content_size = (400, y + 20)

        # === 初始化: 加载 start_idx 对应的货品，或新建 ===
        if start_idx >= 0 and start_idx < len(self.items):
            self._load_item(start_idx)
        else:
            self.current_idx = -1  # 新建模式
            self.lbl_idx.text = f"共 {len(self.items)} 项 · 新建"
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
        thumb_size = 78       # 正方形缩略图大小
        gap = 8
        cols = 4
        rows = max((n + cols - 1) // cols, 1)
        container_h = rows * thumb_size + (rows - 1) * gap
        self.thumb_container.height = max(container_h, thumb_size)

        if n == 0:
            # 空状态
            empty_lbl = ui.Label()
            empty_lbl.text = "（还没有照片，点击 📷拍照 添加）"
            empty_lbl.font = ('Helvetica', 12)
            empty_lbl.text_color = '#aaa'
            empty_lbl.alignment = ui.ALIGN_CENTER
            empty_lbl.frame = (0, 0, 340, thumb_size)
            self.thumb_container.add_subview(empty_lbl)
            return

        for idx, fname in enumerate(self.photo_files):
            col = idx % cols
            row = idx // cols
            x = col * (thumb_size + gap)
            y = row * (thumb_size + gap)
            fp = os.path.join(photo_dir, fname)

            btn = ui.Button()
            btn.frame = (x, y, thumb_size, thumb_size)
            btn.corner_radius = 6
            btn.border_width = 1
            btn.border_color = '#ddd'
            btn.background_color = '#f5f5f5'
            # 加载图片
            if os.path.exists(fp):
                try:
                    btn.image = ui.Image.from_file(fp)
                except Exception as e:
                    print(f"[缩略图] 加载失败 {fp}: {e}")
                    btn.title = "🖼"
                    btn.font = ('Helvetica', 30)
                    btn.tint_color = '#ccc'
            else:
                btn.title = "❓"
                btn.font = ('Helvetica', 24)
                btn.tint_color = '#999'
            # 闭包绑定参数
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

        # 图片
        img_view = ui.ImageView()
        if os.path.exists(img_path):
            try:
                img_view.image = ui.Image.from_file(img_path)
            except Exception:
                img_view.image = None
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
        self.lbl_idx.text = f"第 {idx+1}/{len(self.items)} 项 · 序号 {item.get('序号','?')}"

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
        self.lbl_idx.text = f"共 {len(self.items)} 项 · 新建"
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
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if str(row.get("序号", "")) != str(seq):
                    rows.append(row)
        tmp_path = csv_path + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8', newline='') as f:
            f.write('\ufeff')
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

    @classmethod
    def open(cls, list_name):
        viewer = cls(list_name)
        viewer.present(style='sheet', hide_title_bar=False)

    def __init__(self, list_name):
        super().__init__()
        self.list_name = list_name
        self.background_color = 'white'
        w = self.width

        # 前 3 行：全宽 frame (x=0)
        self.title_label = ui.Label()
        self.title_label.text = "附件：寄售玩具清单"
        self.title_label.font = ('Helvetica-Bold', 16)
        self.title_label.text_alignment = ui.ALIGN_CENTER
        self.title_label.text_color = 'black'
        self.title_label.frame = (0, 80, w, 24)
        self.add_subview(self.title_label)

        self.subtitle_label = ui.Label()
        self.subtitle_label.text = "（本清单一式两份，双方各执一份；随附交接照片和视频）"
        self.subtitle_label.font = ('Helvetica', 10)
        self.subtitle_label.text_alignment = ui.ALIGN_CENTER
        self.subtitle_label.text_color = '#666'
        self.subtitle_label.frame = (0, 108, w, 18)
        self.add_subview(self.subtitle_label)

        self.list_name_label = ui.Label()
        self.list_name_label.text = f"清单：{list_name}"
        self.list_name_label.font = ('Helvetica-Bold', 14)
        self.list_name_label.text_alignment = ui.ALIGN_CENTER
        self.list_name_label.text_color = '#007aff'
        self.list_name_label.frame = (0, 132, w, 22)
        self.add_subview(self.list_name_label)

        self.table_view = ui.TextView()
        self.table_view.frame = (10, 162, w - 20, self.height - 260)
        self.table_view.font = ('Menlo', 11)
        self.table_view.editable = False
        self.table_view.background_color = '#f9f9f9'
        self.table_view.text = "加载中..."
        self.add_subview(self.table_view)

        self.btn_close = ui.Button()
        self.btn_close.title = "返回"
        self.btn_close.font = ('Helvetica', 15)
        self.btn_close.tint_color = '#007aff'
        self.btn_close.frame = (20, self.height - 80, w - 40, 44)
        self.btn_close.action = lambda s: self.close()
        self.add_subview(self.btn_close)

        self.load_data()

    def _fmt_cell(self, s, width, align='center'):
        """按显示宽度（中文=2 英文=1）+ 对齐方式格式化"""
        s = str(s or "")
        w = 0; out = ""
        for ch in s:
            cw = 2 if ord(ch) > 127 else 1
            if w + cw > width:
                break
            out += ch; w += cw
        pad = width - w
        if align == 'center':
            left = pad // 2; right = pad - left
            return (" " * left) + out + (" " * right)
        elif align == 'right':
            return (" " * pad) + out
        else:
            return out + (" " * pad)

    def load_data(self):
        items = read_all_items(self.list_name)
        # 列宽（显示宽度）：序号=6 型号=24 数量=6 参考价=10 盒况备注=24
        W_SEQ, W_MODEL, W_QTY, W_PRICE, W_COND = 6, 24, 6, 10, 24
        sep = "─" * (W_SEQ + W_MODEL + W_QTY + W_PRICE + W_COND + 4)
        # 表头：标题全居中
        header = (
            self._fmt_cell("序号", W_SEQ, 'center') + "│" +
            self._fmt_cell("型号", W_MODEL, 'center') + "│" +
            self._fmt_cell("数量", W_QTY, 'center') + "│" +
            self._fmt_cell("参考价", W_PRICE, 'center') + "│" +
            self._fmt_cell("盒况备注", W_COND, 'center')
        )
        lines = [sep, header, sep]
        for it in items:
            cond_parts = []
            if it.get("拆封状态"): cond_parts.append(it["拆封状态"])
            if it.get("外盒状态"): cond_parts.append("盒:" + it["外盒状态"].replace("|", "、"))
            if it.get("本体状态"): cond_parts.append("本:" + it["本体状态"].replace("|", "、"))
            cond = " ".join(cond_parts)
            row = (
                self._fmt_cell(it.get("序号",""), W_SEQ, 'center') + "│" +
                self._fmt_cell(it.get("型号",""), W_MODEL, 'center') + "│" +
                self._fmt_cell(it.get("数量",""), W_QTY, 'center') + "│" +
                self._fmt_cell(it.get("参考价",""), W_PRICE, 'right') + "│" +
                self._fmt_cell(cond, W_COND, 'left')
            )
            lines.append(row)
        lines.append(sep)
        if not items:
            self.table_view.text = sep + "\n" + header + "\n" + sep + "\n（暂无记录）"
        else:
            self.table_view.text = "\n".join(lines)

    def layout(self):
        self.title_label.frame = (0, 80, self.width, 24)
        self.subtitle_label.frame = (0, 108, self.width, 18)
        self.list_name_label.frame = (0, 132, self.width, 22)
        self.table_view.frame = (10, 162, self.width - 20, self.height - 260)
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
