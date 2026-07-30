#!/usr/bin/env python3
import sqlite3
import os
import ui

class PartWall:
    def __init__(self, db_file='partwall.db'):
        self.db_file = db_file
        self._init_db()
    
    def _get_connection(self):
        """获取数据库连接"""
        # 为每个操作创建新的连接，确保线程安全
        conn = sqlite3.connect(self.db_file)
        conn.row_factory = sqlite3.Row
        return conn
    
    def _init_db(self):
        """初始化数据库"""
        try:
            # 连接到数据库
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # 创建仓库表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS warehouses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE
                )
            ''')
            
            # 创建盒子表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS boxes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    warehouse_id INTEGER NOT NULL,
                    box_number INTEGER NOT NULL,
                    box_name TEXT NOT NULL,
                    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
                    UNIQUE(warehouse_id, box_number)
                )
            ''')
            
            # 创建零件表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS parts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    box_id INTEGER NOT NULL,
                    part_num TEXT NOT NULL,
                    color_id INTEGER,
                    part_cat_id INTEGER,
                    img_url TEXT,
                    quantity INTEGER NOT NULL,
                    FOREIGN KEY (box_id) REFERENCES boxes(id),
                    FOREIGN KEY (color_id) REFERENCES colors(id),
                    UNIQUE(box_id, part_num, color_id)
                )
            ''')
            
            # 创建颜色表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS colors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    color_name TEXT NOT NULL UNIQUE,
                    rgb TEXT,
                    bricklink_id INTEGER
                )
            ''')
            
            # 提交事务
            conn.commit()
            conn.close()
            print("数据库初始化成功")
            
        except sqlite3.Error as e:
            print(f"数据库初始化失败: {e}")
        
    def add_warehouse(self, name):
        """添加仓库"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute('INSERT INTO warehouses (name) VALUES (?)', (name,))
            warehouse_id = cursor.lastrowid
            
            conn.commit()
            conn.close()
            print(f"仓库 '{name}' 创建成功")
            return warehouse_id
        except sqlite3.Error as e:
            print(f"添加仓库失败: {e}")
            return None
    
    def rename_warehouse(self, warehouse_id, new_name):
        """重命名仓库"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute('UPDATE warehouses SET name = ? WHERE id = ?', (new_name, warehouse_id))
            conn.commit()
            if cursor.rowcount > 0:
                print(f"仓库 {warehouse_id} 已重命名为 '{new_name}'")
                conn.close()
                return True
            else:
                print(f"未找到仓库 {warehouse_id}")
                conn.close()
                return False
        except sqlite3.Error as e:
            print(f"重命名仓库失败: {e}")
            return False
    
    def delete_warehouse(self, warehouse_id):
        """删除仓库"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # 开始事务
            conn.execute('BEGIN TRANSACTION')
            
            # 查找仓库中的盒子
            cursor.execute('SELECT id FROM boxes WHERE warehouse_id = ?', (warehouse_id,))
            boxes = cursor.fetchall()
            
            # 删除盒子中的零件
            for box in boxes:
                box_id = box[0]
                cursor.execute('DELETE FROM parts WHERE box_id = ?', (box_id,))
            
            # 删除仓库中的盒子
            cursor.execute('DELETE FROM boxes WHERE warehouse_id = ?', (warehouse_id,))
            
            # 删除仓库
            cursor.execute('DELETE FROM warehouses WHERE id = ?', (warehouse_id,))
            
            # 提交事务
            conn.commit()
            
            if cursor.rowcount > 0:
                print(f"仓库 {warehouse_id} 已删除")
                conn.close()
                return True
            else:
                print(f"未找到仓库 {warehouse_id}")
                conn.close()
                return False
        except sqlite3.Error as e:
            # 回滚事务
            conn.execute('ROLLBACK')
            print(f"删除仓库失败: {e}")
            conn.close()
            return False
    
    def delete_box(self, warehouse_id, box_number):
        """删除盒子"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # 开始事务
            conn.execute('BEGIN TRANSACTION')
            
            # 查找盒子ID
            cursor.execute('SELECT id FROM boxes WHERE warehouse_id = ? AND box_number = ?', (warehouse_id, box_number))
            box = cursor.fetchone()
            if not box:
                print(f"未找到仓库 {warehouse_id} 中的盒子 {box_number}")
                conn.close()
                return False
            box_id = box[0]
            
            # 删除盒子中的零件
            cursor.execute('DELETE FROM parts WHERE box_id = ?', (box_id,))
            
            # 删除盒子
            cursor.execute('DELETE FROM boxes WHERE id = ?', (box_id,))
            
            # 提交事务
            conn.commit()
            
            print(f"盒子 {box_number} 已删除")
            conn.close()
            return True
        except sqlite3.Error as e:
            # 回滚事务
            conn.execute('ROLLBACK')
            print(f"删除盒子失败: {e}")
            conn.close()
            return False
    
    def add_box(self, warehouse_id, box_number, box_name):
        """添加盒子"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO boxes (warehouse_id, box_number, box_name) VALUES (?, ?, ?)',
                (warehouse_id, box_number, box_name)
            )
            conn.commit()
            conn.close()
            print(f"盒子 {box_number} '{box_name}' 添加成功")
            return True
        except sqlite3.Error as e:
            print(f"添加盒子失败: {e}")
            return False
    
    def rename_box(self, warehouse_id, box_number, new_name):
        """重命名盒子"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                'UPDATE boxes SET box_name = ? WHERE warehouse_id = ? AND box_number = ?',
                (new_name, warehouse_id, box_number)
            )
            conn.commit()
            if cursor.rowcount > 0:
                print(f"盒子 {box_number} 已重命名为 '{new_name}'")
                conn.close()
                return True
            else:
                print(f"未找到仓库 {warehouse_id} 中的盒子 {box_number}")
                conn.close()
                return False
        except sqlite3.Error as e:
            print(f"重命名盒子失败: {e}")
            return False
    
    def add_part(self, warehouse_id, box_number, part_num, color_input, part_cat_id=None, img_url=None, quantity=0):
        """添加零件"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # 检查colors表是否存在，如果不存在则创建
            try:
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS colors (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        color_name TEXT NOT NULL UNIQUE,
                        rgb TEXT,
                        bricklink_id INTEGER
                    )
                ''')
                conn.commit()
            except Exception as e:
                print(f"创建colors表失败: {e}")
            
            # 处理颜色输入：如果是数字则视为color_id，否则视为颜色名称
            color_id = None
            try:
                # 尝试转换为数字
                color_id = int(color_input)
            except ValueError:
                # 不是数字，视为颜色名称
                color_name = color_input.strip()
                if color_name:
                    # 查找或创建颜色
                    cursor.execute('''
                        INSERT OR IGNORE INTO colors (color_name)
                        VALUES (?)
                    ''', (color_name,))
                    conn.commit()
                    
                    # 获取颜色ID
                    cursor.execute('''
                        SELECT id FROM colors WHERE color_name = ?
                    ''', (color_name,))
                    color_row = cursor.fetchone()
                    if color_row:
                        color_id = color_row[0]
                    else:
                        print(f"获取颜色ID失败: {color_name}")
                        conn.close()
                        return False
            
            if not color_id:
                print("颜色ID不能为空")
                conn.close()
                return False
            
            # 查找盒子ID
            cursor.execute(
                'SELECT id FROM boxes WHERE warehouse_id = ? AND box_number = ?',
                (warehouse_id, box_number)
            )
            box = cursor.fetchone()
            if not box:
                print(f"未找到仓库 {warehouse_id} 中的盒子 {box_number}")
                conn.close()
                return False
            box_id = box[0]
            
            # 检查parts表结构，确定使用color还是color_id字段
            use_color_field = False
            try:
                # 尝试使用color_id字段
                cursor.execute('''
                    SELECT quantity FROM parts WHERE box_id = ? AND part_num = ? AND color_id = ?
                ''', (box_id, part_num, color_id))
            except sqlite3.OperationalError:
                # 如果出错，说明表结构是旧的，使用color字段
                use_color_field = True
            
            if use_color_field:
                # 使用旧的color字段
                # 检查零件是否已存在
                cursor.execute(
                    'SELECT quantity FROM parts WHERE box_id = ? AND part_num = ? AND color = ?',
                    (box_id, part_num, str(color_id))
                )
                existing = cursor.fetchone()
                
                if existing:
                    # 更新数量
                    new_quantity = existing[0] + quantity
                    cursor.execute(
                        'UPDATE parts SET quantity = ? WHERE box_id = ? AND part_num = ? AND color = ?',
                        (new_quantity, box_id, part_num, str(color_id))
                    )
                    print(f"零件 {part_num} (颜色ID: {color_id}) 数量已更新为 {new_quantity}")
                else:
                    # 插入新零件
                    cursor.execute(
                        'INSERT INTO parts (box_id, part_num, color, quantity) VALUES (?, ?, ?, ?)',
                        (box_id, part_num, str(color_id), quantity)
                    )
                    print(f"零件 {part_num} (颜色ID: {color_id}, 数量: {quantity}) 添加成功")
            else:
                # 使用新的color_id字段
                # 检查零件是否已存在
                cursor.execute(
                    'SELECT quantity FROM parts WHERE box_id = ? AND part_num = ? AND color_id = ?',
                    (box_id, part_num, color_id)
                )
                existing = cursor.fetchone()
                
                if existing:
                    # 更新数量
                    new_quantity = existing[0] + quantity
                    cursor.execute(
                        'UPDATE parts SET quantity = ? WHERE box_id = ? AND part_num = ? AND color_id = ?',
                        (new_quantity, box_id, part_num, color_id)
                    )
                    print(f"零件 {part_num} (颜色ID: {color_id}) 数量已更新为 {new_quantity}")
                else:
                    # 插入新零件
                    try:
                        cursor.execute(
                            'INSERT INTO parts (box_id, part_num, color_id, part_cat_id, img_url, quantity) VALUES (?, ?, ?, ?, ?, ?)',
                            (box_id, part_num, color_id, part_cat_id, img_url, quantity)
                        )
                    except sqlite3.OperationalError:
                        # 如果字段不存在，使用基本字段
                        cursor.execute(
                            'INSERT INTO parts (box_id, part_num, color_id, quantity) VALUES (?, ?, ?, ?)',
                            (box_id, part_num, color_id, quantity)
                        )
                    print(f"零件 {part_num} (颜色ID: {color_id}, 数量: {quantity}) 添加成功")
            
            conn.commit()
            conn.close()
            return True
        except sqlite3.Error as e:
            print(f"添加零件失败: {e}")
            return False
    
    def update_part_quantity(self, warehouse_id, box_number, part_num, color_id, quantity):
        """更新零件数量"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # 查找盒子ID
            cursor.execute(
                'SELECT id FROM boxes WHERE warehouse_id = ? AND box_number = ?',
                (warehouse_id, box_number)
            )
            box = cursor.fetchone()
            if not box:
                print(f"未找到仓库 {warehouse_id} 中的盒子 {box_number}")
                conn.close()
                return False
            box_id = box[0]
            
            # 更新数量
            cursor.execute(
                'UPDATE parts SET quantity = ? WHERE box_id = ? AND part_num = ? AND color_id = ?',
                (quantity, box_id, part_num, color_id)
            )
            
            conn.commit()
            if cursor.rowcount > 0:
                print(f"零件 {part_num} (颜色ID: {color_id}) 数量已更新为 {quantity}")
                conn.close()
                return True
            else:
                print(f"未找到该零件记录")
                conn.close()
                return False
        except sqlite3.Error as e:
            print(f"更新零件数量失败: {e}")
            return False
    
    def search_part(self, part_num):
        """根据型号查询零件"""
        try:
            print(f"search_part called with part_num: '{part_num}'")
            conn = self._get_connection()
            print(f"Database connection established")
            cursor = conn.cursor()
            print(f"Cursor created")
            
            # 检查parts表结构，确定使用color还是color_id字段
            use_color_field = False
            try:
                # 尝试使用color_id字段
                print("Trying to use color_id field")
                cursor.execute('''
                    SELECT p.part_num, p.color_id, p.quantity, w.name as warehouse_name, b.box_number, b.box_name
                    FROM parts p
                    JOIN boxes b ON p.box_id = b.id
                    JOIN warehouses w ON b.warehouse_id = w.id
                    WHERE p.part_num = ?
                    ORDER BY w.name, b.box_number
                ''', (part_num,))
                results = cursor.fetchall()
                print(f"Query executed, fetched {len(results)} results with color_id field")
            except sqlite3.OperationalError as e:
                # 如果出错，说明表结构是旧的，使用color字段
                print(f"Error with color_id field: {e}")
                use_color_field = True
                print("Trying to use color field instead")
                cursor.execute('''
                    SELECT p.part_num, p.color, p.quantity, w.name as warehouse_name, b.box_number, b.box_name
                    FROM parts p
                    JOIN boxes b ON p.box_id = b.id
                    JOIN warehouses w ON b.warehouse_id = w.id
                    WHERE p.part_num = ?
                    ORDER BY w.name, b.box_number
                ''', (part_num,))
                results = cursor.fetchall()
                print(f"Query executed, fetched {len(results)} results with color field")
            
            conn.close()
            
            if not results:
                print(f"未找到型号为 {part_num} 的零件")
                return []
            
            print(f"=== 零件 {part_num} 查询结果 ===")
            print("颜色ID\t数量\t仓库\t盒子编号\t盒子名称")
            print("-" * 60)
            
            for row in results:
                part_num, color_id, quantity, warehouse_name, box_number, box_name = row
                print(f"{color_id}\t{quantity}\t{warehouse_name}\t{box_number}\t{box_name}")
            
            return results
        except sqlite3.Error as e:
            print(f"查询零件失败: {e}")
            return []
    
    def list_warehouses(self):
        """列出所有仓库"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT id, name FROM warehouses')
            warehouses = cursor.fetchall()
            conn.close()
            
            if not warehouses:
                print("暂无仓库")
                return []
            
            print("=== 仓库列表 ===")
            print("ID\t名称")
            print("-" * 20)
            for warehouse in warehouses:
                print(f"{warehouse[0]}\t{warehouse[1]}")
            
            return warehouses
        except sqlite3.Error as e:
            print(f"查询仓库失败: {e}")
            return []
    
    def get_warehouse_name(self, warehouse_id):
        """获取仓库名称"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT name FROM warehouses WHERE id = ?', (warehouse_id,))
            result = cursor.fetchone()
            conn.close()
            if result:
                return result[0]
            return None
        except sqlite3.Error as e:
            print(f"查询仓库名称失败: {e}")
            return None
    
    def list_boxes(self, warehouse_id):
        """列出仓库中的所有盒子"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                'SELECT box_number, box_name FROM boxes WHERE warehouse_id = ? ORDER BY box_number',
                (warehouse_id,)
            )
            boxes = cursor.fetchall()
            conn.close()
            
            if not boxes:
                print(f"仓库 {warehouse_id} 中暂无盒子")
                return []
            
            print(f"=== 仓库 {warehouse_id} 盒子列表 ===")
            print("编号\t名称")
            print("-" * 30)
            for box in boxes:
                print(f"{box[0]}\t{box[1]}")
            
            return boxes
        except sqlite3.Error as e:
            print(f"查询盒子失败: {e}")
            return []
    
    def get_box_name(self, warehouse_id, box_number):
        """获取盒子名称"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                'SELECT box_name FROM boxes WHERE warehouse_id = ? AND box_number = ?',
                (warehouse_id, box_number)
            )
            result = cursor.fetchone()
            conn.close()
            if result:
                return result[0]
            return None
        except sqlite3.Error as e:
            print(f"查询盒子名称失败: {e}")
            return None
    
    def list_parts_in_box(self, warehouse_id, box_number):
        """列出盒子中的所有零件"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # 查找盒子ID
            cursor.execute(
                'SELECT id, box_name FROM boxes WHERE warehouse_id = ? AND box_number = ?',
                (warehouse_id, box_number)
            )
            box = cursor.fetchone()
            if not box:
                print(f"未找到仓库 {warehouse_id} 中的盒子 {box_number}")
                conn.close()
                return []
            box_id, box_name = box
            
            # 检查parts表结构，确定使用color还是color_id字段
            use_color_field = False
            try:
                # 尝试使用color_id字段
                cursor.execute(
                    'SELECT part_num, color_id, quantity FROM parts WHERE box_id = ? ORDER BY part_num, color_id',
                    (box_id,)
                )
                parts = cursor.fetchall()
            except sqlite3.OperationalError:
                # 如果出错，说明表结构是旧的，使用color字段
                use_color_field = True
                cursor.execute(
                    'SELECT part_num, color, quantity FROM parts WHERE box_id = ? ORDER BY part_num, color',
                    (box_id,)
                )
                parts = cursor.fetchall()
            
            conn.close()
            
            if not parts:
                print(f"盒子 {box_number} ({box_name}) 中暂无零件")
                return []
            
            print(f"=== 盒子 {box_number} ({box_name}) 零件列表 ===")
            print("型号\t颜色ID\t数量")
            print("-" * 30)
            for part in parts:
                print(f"{part[0]}\t{part[1]}\t{part[2]}")
            
            return parts
        except sqlite3.Error as e:
            print(f"查询零件失败: {e}")
            return []
    
    def close(self):
        """关闭数据库连接"""
        # 由于现在每个操作都创建和关闭自己的连接，这个方法可以保留为空
        print("数据库连接已关闭")
    
    def init_database(self):
        """初始化数据库（删除所有数据并重建表结构）"""
        try:
            # 删除所有表
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # 先删除依赖关系的表
            cursor.execute('DROP TABLE IF EXISTS parts')
            cursor.execute('DROP TABLE IF EXISTS boxes')
            cursor.execute('DROP TABLE IF EXISTS warehouses')
            
            # 重新创建表结构
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS warehouses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS boxes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    warehouse_id INTEGER NOT NULL,
                    box_number INTEGER NOT NULL,
                    box_name TEXT NOT NULL,
                    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
                    UNIQUE(warehouse_id, box_number)
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS parts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    box_id INTEGER NOT NULL,
                    part_num TEXT NOT NULL,
                    color_id INTEGER,
                    part_cat_id INTEGER,
                    img_url TEXT,
                    quantity INTEGER NOT NULL,
                    FOREIGN KEY (box_id) REFERENCES boxes(id),
                    FOREIGN KEY (color_id) REFERENCES colors(id),
                    UNIQUE(box_id, part_num, color_id)
                )
            ''')
            
            conn.commit()
            conn.close()
            print("数据库初始化成功")
            return True
        except sqlite3.Error as e:
            print(f"数据库初始化失败: {e}")
            return False

class PartWallApp:
    def __init__(self):
        self.partwall = PartWall()
        self.current_warehouse = None
        self.current_box = None
        self.main_view = None
        self.current_content_view = None
        self.is_view_changing = False
    
    def show_main_view(self):
        """显示主视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 如果主视图不存在，创建它
            if not self.main_view:
                # 创建主视图容器
                self.main_view = ui.View()
                self.main_view.name = "PartWall - 零件数据库"
                self.main_view.background_color = "#f5f5f5"
                self.main_view.frame = (0, 0, screen_width, screen_height)
                
                # 上部分：功能按钮区域（高度150）
                top_view = ui.View()
                top_view.frame = (0, 0, screen_width, 150)
                top_view.background_color = "#34495e"
                self.main_view.add_subview(top_view)
                
                # 标题
                title = ui.Label()
                title.text = "PartWall - 零件数据库"
                title.font = ("Arial", 20)
                title.text_color = "white"
                title.alignment = ui.ALIGN_CENTER
                title.frame = (0, 20, screen_width, 30)
                top_view.add_subview(title)
                
                # 仓库管理按钮（直接添加到top_view，不使用容器）
                warehouse_button = ui.Button()
                warehouse_button.title = "仓库管理"
                warehouse_button.background_color = "#3498db"
                warehouse_button.tint_color = "white"
                warehouse_button.corner_radius = 8
                warehouse_button.frame = (40, 70, 180, 50)
                warehouse_button.action = self.warehouse_button_action
                top_view.add_subview(warehouse_button)
                
                # 零件搜索按钮
                search_button = ui.Button()
                search_button.title = "零件搜索"
                search_button.background_color = "#27ae60"
                search_button.tint_color = "white"
                search_button.corner_radius = 8
                search_button.frame = (240, 70, 180, 50)
                search_button.action = self.search_button_action
                top_view.add_subview(search_button)
                
                # 系统设置按钮
                settings_button = ui.Button()
                settings_button.title = "系统设置"
                settings_button.background_color = "#9b59b6"
                settings_button.tint_color = "white"
                settings_button.corner_radius = 8
                settings_button.frame = (440, 70, 180, 50)
                settings_button.action = lambda sender: self.show_settings_view()
                top_view.add_subview(settings_button)
                
                # 退出按钮
                exit_button = ui.Button()
                exit_button.title = "退出"
                exit_button.background_color = "#e74c3c"
                exit_button.tint_color = "white"
                exit_button.corner_radius = 8
                exit_button.frame = (640, 70, 180, 50)
                exit_button.action = self.exit_button_action
                top_view.add_subview(exit_button)
                
                # 显示主视图
                self.main_view.present("fullscreen")
                print("Main view container presented successfully")
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    # 检查视图是否有remove_from_superview方法
                    if hasattr(self.current_content_view, 'remove_from_superview'):
                        self.current_content_view.remove_from_superview()
                        print("Current content view removed successfully")
                    else:
                        # 在Pythonista中，_ui.View对象没有remove_from_superview方法
                        # 我们可以通过设置current_content_view为None来模拟移除
                        print("Current content view has no remove_from_superview method, setting to None")
                        self.current_content_view = None
                except Exception as e:
                    print(f"Error removing current content view: {e}")
            
            # 创建主页面内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            

            
            # 主页面提示
            hint_label = ui.Label()
            hint_label.text = "请选择上方的功能按钮"
            hint_label.font = ("Arial", 18)
            hint_label.text_color = "#7f8c8d"
            hint_label.alignment = ui.ALIGN_CENTER
            hint_label.frame = (0, (content_view.height - 50) / 2, screen_width, 50)
            content_view.add_subview(hint_label)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Main view content updated successfully")
        except Exception as e:
            print(f"Error in show_main_view: {e}")
    
    def exit_app(self):
        """退出应用程序"""
        try:
            print("Exiting app, saving data first...")
            
            # 保存数据操作
            # 由于我们使用的是SQLite数据库，每次操作都会自动保存
            # 但我们可以确保所有连接都被正确关闭
            print("Data saved successfully")
            
            # 关闭当前视图
            if hasattr(self, 'current_view') and self.current_view:
                try:
                    self.current_view.close()
                    print("Current view closed")
                except Exception as e:
                    print(f"Error closing current view: {e}")
            
            # 关闭主视图（如果存在）
            if hasattr(self, 'main_view') and self.main_view:
                try:
                    self.main_view.close()
                    print("Main view closed")
                except Exception as e:
                    print(f"Error closing main view: {e}")
            
            # 延迟一下，确保所有操作都完成
            import time
            time.sleep(0.5)
            
            # 使用系统退出
            print("Exiting application")
            import sys
            sys.exit()
        except Exception as e:
            print(f"Error in exit_app: {e}")
            # 即使出错也要尝试退出
            try:
                import sys
                sys.exit()
            except:
                pass
    
    def get_part_image_url(self, part_num, color_id):
        """从partwall.db数据库的inventory_parts表中获取零件图片URL"""
        try:
            # 连接到partwall.db数据库
            import os
            try:
                # 首先尝试使用__file__变量
                current_dir = os.path.dirname(__file__)
            except NameError:
                # 如果__file__未定义（例如在Pythonista中），使用当前工作目录
                current_dir = os.getcwd()
            
            # 构建partwall.db文件路径
            db_path = os.path.join(current_dir, 'partwall.db')
            
            if not os.path.exists(db_path):
                return None
            
            # 连接到数据库
            import sqlite3
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # 检查inventory_parts表是否存在
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_parts'")
            table_exists = cursor.fetchone()
            
            if not table_exists:
                conn.close()
                return None
            
            # 尝试不同的查询方式
            try:
                # 从inventory_parts表中获取零件信息（忽略大小写，精确匹配）
                cursor.execute('SELECT img_url FROM inventory_parts WHERE part_num = ? COLLATE NOCASE AND color_id = ?', (part_num, color_id))
                result = cursor.fetchone()
                
                if not result:
                    # 尝试只使用part_num查询（忽略大小写，精确匹配）
                    cursor.execute('SELECT img_url FROM inventory_parts WHERE part_num = ? COLLATE NOCASE', (part_num,))
                    result = cursor.fetchone()
            except Exception as query_error:
                result = None
            
            conn.close()
            
            if result:
                img_url = result[0]
                return img_url
            else:
                return None
        except Exception as e:
            return None
    
    def get_color_name(self, color_id):
        """根据颜色ID获取颜色名称"""
        try:
            import sqlite3
            conn = self.partwall._get_connection()
            cursor = conn.cursor()
            
            # 尝试使用color_name字段
            try:
                cursor.execute('SELECT color_name FROM colors WHERE id = ?', (color_id,))
                color = cursor.fetchone()
            except sqlite3.OperationalError:
                # 如果出错，尝试使用name字段
                cursor.execute('SELECT name FROM colors WHERE id = ?', (color_id,))
                color = cursor.fetchone()
            
            conn.close()
            if color:
                return color[0]
            return f"{color_id}"
        except Exception as e:
            print(f"Error getting color name: {e}")
            return f"{color_id}"

    def download_image(self, url, part_num, color_id):
        """下载图片并保存到本地"""
        try:
            # 尝试获取当前目录
            try:
                # 首先尝试使用__file__变量
                current_dir = os.path.dirname(__file__)
            except NameError:
                # 如果__file__未定义（例如在Pythonista中），使用当前工作目录
                import os
                current_dir = os.getcwd()
            
            # 创建图片保存目录
            import os
            img_dir = os.path.join(current_dir, 'images')
            if not os.path.exists(img_dir):
                os.makedirs(img_dir)
            
            # 生成图片文件名
            img_filename = f"{part_num}_{color_id}.jpg"
            img_path = os.path.join(img_dir, img_filename)
            
            # 检查图片是否已存在
            if os.path.exists(img_path):
                return img_path
            
            # 下载图片
            import requests
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                with open(img_path, 'wb') as f:
                    f.write(response.content)
                return img_path
            else:
                return None
        except Exception as e:
            return None

    def warehouse_button_action(self, sender):
        """仓库管理按钮点击事件"""
        try:
            if not self.is_view_changing:
                print("Warehouse button clicked")
                self.is_view_changing = True
                self.show_warehouse_view()
                # 重置标志
                import time
                time.sleep(0.2)
                self.is_view_changing = False
        except Exception as e:
            print(f"Error in warehouse_button_action: {e}")
            self.is_view_changing = False
    
    def search_button_action(self, sender):
        """零件搜索按钮点击事件"""
        try:
            print("Search button clicked")
            self.show_search_view()
        except Exception as e:
            print(f"Error in search_button_action: {e}")
    
    def exit_button_action(self, sender):
        """退出按钮点击事件"""
        try:
            print("Exit button clicked")
            self.exit_app()
        except Exception as e:
            print(f"Error in exit_button_action: {e}")
    
    def show_warehouse_view(self):
        """显示仓库管理视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    # 检查视图是否有remove_from_superview方法
                    if hasattr(self.current_content_view, 'remove_from_superview'):
                        self.current_content_view.remove_from_superview()
                        print("Current content view removed successfully")
                    else:
                        # 在Pythonista中，_ui.View对象没有remove_from_superview方法
                        # 我们可以通过设置current_content_view为None来模拟移除
                        print("Current content view has no remove_from_superview method, setting to None")
                        self.current_content_view = None
                except Exception as e:
                    print(f"Error removing current content view: {e}")
            
            # 创建仓库管理内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 添加仓库按钮（左上角）
            add_button = ui.Button()
            add_button.frame = (20, 20, 100, 40)
            add_button.title = "添加仓库"
            add_button.background_color = "#27ae60"
            add_button.tint_color = "white"
            add_button.corner_radius = 5
            add_button.action = lambda sender: self.show_add_warehouse_view()
            content_view.add_subview(add_button)
            
            # 返回按钮（右上角）
            back_button = ui.Button()
            back_button.frame = (screen_width - 120, 20, 100, 40)
            back_button.title = "返回"
            back_button.background_color = "#3498db"
            back_button.tint_color = "white"
            back_button.corner_radius = 5
            back_button.action = lambda sender: self.show_main_view()
            content_view.add_subview(back_button)
            
            # 添加一个标题
            title_label = ui.Label()
            title_label.frame = (0, 80, screen_width, 40)
            title_label.text = "仓库管理"
            title_label.font = ("Arial", 24)
            title_label.text_color = "#333"
            title_label.alignment = ui.ALIGN_CENTER
            content_view.add_subview(title_label)
            
            # 获取仓库列表
            warehouses = self.partwall.list_warehouses()
            
            # 添加仓库列表
            if warehouses:
                # 创建一个滚动视图来显示仓库
                scroll_view = ui.ScrollView()
                scroll_view.frame = (20, 140, screen_width - 40, content_view.height - 160)
                
                # 创建一个容器视图来容纳所有仓库按钮
                scroll_content = ui.View()
                scroll_content.frame = (0, 0, screen_width - 40, len(warehouses) * 80)
                
                # 为每个仓库创建一个按钮
                for i, warehouse in enumerate(warehouses):
                    # 创建仓库按钮容器
                    container = ui.View()
                    container.frame = (0, i * 80, screen_width - 40, 70)
                    container.background_color = "#ffffff"
                    container.border_width = 1
                    container.border_color = "#ddd"
                    container.corner_radius = 5
                    
                    # 仓库名称按钮
                    warehouse_button = ui.Button()
                    warehouse_button.frame = (10, 10, container.width - 20, 50)
                    warehouse_button.title = f"{warehouse[0]}. {warehouse[1]}"
                    warehouse_button.background_color = "clear"
                    warehouse_button.tint_color = "#3498db"
                    warehouse_button.action = lambda sender, wid=warehouse[0]: self.show_box_view(wid)
                    container.add_subview(warehouse_button)
                    
                    scroll_content.add_subview(container)
                
                # 设置滚动视图的内容大小
                scroll_view.content_size = (screen_width - 40, len(warehouses) * 80)
                scroll_view.add_subview(scroll_content)
                content_view.add_subview(scroll_view)
            else:
                # 显示无仓库提示
                no_warehouse_label = ui.Label()
                no_warehouse_label.frame = (0, 140, screen_width, 40)
                no_warehouse_label.text = "暂无仓库"
                no_warehouse_label.font = ("Arial", 16)
                no_warehouse_label.text_color = "#999"
                no_warehouse_label.alignment = ui.ALIGN_CENTER
                content_view.add_subview(no_warehouse_label)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Warehouse view content updated successfully")
        except Exception as e:
            print(f"Error in show_warehouse_view: {e}")
    
    def show_add_warehouse_view(self):
        """显示添加仓库视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    # 检查视图是否有remove_from_superview方法
                    if hasattr(self.current_content_view, 'remove_from_superview'):
                        self.current_content_view.remove_from_superview()
                        print("Current content view removed successfully")
                    else:
                        print("Current content view has no remove_from_superview method")
                except Exception as e:
                    print(f"Error removing current content view: {e}")
            
            # 创建添加仓库内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 标题
            title = ui.Label()
            title.text = "添加仓库"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.frame = (20, 20, screen_width - 40, 30)
            content_view.add_subview(title)
            
            # 名称输入
            name_label = ui.Label()
            name_label.text = "仓库名称:"
            name_label.font = ("Arial", 16)
            name_label.text_color = "#34495e"
            name_label.frame = (40, 80, 100, 30)
            content_view.add_subview(name_label)
            
            name_input = ui.TextField()
            name_input.placeholder = "请输入仓库名称"
            name_input.frame = (150, 80, screen_width - 190, 36)
            name_input.border_width = 1
            name_input.border_color = "#ddd"
            name_input.corner_radius = 4
            content_view.add_subview(name_input)
            
            # 按钮
            cancel_button = ui.Button()
            cancel_button.title = "取消"
            cancel_button.background_color = "#95a5a6"
            cancel_button.tint_color = "white"
            cancel_button.corner_radius = 8
            cancel_button.frame = (40, 140, 100, 40)
            cancel_button.action = lambda sender: self.show_warehouse_view()
            content_view.add_subview(cancel_button)
            
            save_button = ui.Button()
            save_button.title = "保存"
            save_button.background_color = "#3498db"
            save_button.tint_color = "white"
            save_button.corner_radius = 8
            save_button.frame = (screen_width - 140, 140, 100, 40)
            save_button.action = lambda sender: self.save_warehouse(name_input.text)
            content_view.add_subview(save_button)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Add warehouse view content updated successfully")
        except Exception as e:
            print(f"Error in show_add_warehouse_view: {e}")
    
    def save_warehouse(self, name):
        """保存仓库"""
        try:
            if name and name.strip():
                self.partwall.add_warehouse(name.strip())
            self.show_warehouse_view()
        except Exception as e:
            print(f"Error in save_warehouse: {e}")
    
    def show_rename_warehouse_view(self, warehouse_id, current_name):
        """显示仓库重命名视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建重命名仓库内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 标题
            title = ui.Label()
            title.text = "重命名仓库"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (20, 40, screen_width - 40, 30)
            content_view.add_subview(title)
            
            # 名称输入
            name_label = ui.Label()
            name_label.text = "新名称:"
            name_label.font = ("Arial", 16)
            name_label.text_color = "#34495e"
            name_label.frame = (40, 120, 100, 30)
            content_view.add_subview(name_label)
            
            name_input = ui.TextField()
            name_input.text = current_name
            name_input.frame = (150, 120, screen_width - 190, 36)
            name_input.border_width = 1
            name_input.border_color = "#ddd"
            name_input.corner_radius = 4
            content_view.add_subview(name_input)
            
            # 取消按钮
            cancel_button = ui.Button()
            cancel_button.title = "取消"
            cancel_button.background_color = "#95a5a6"
            cancel_button.tint_color = "white"
            cancel_button.corner_radius = 8
            cancel_button.frame = (100, 200, 200, 50)
            cancel_button.action = lambda sender: self.show_warehouse_view()
            content_view.add_subview(cancel_button)
            
            # 保存按钮
            save_button = ui.Button()
            save_button.title = "保存"
            save_button.background_color = "#3498db"
            save_button.tint_color = "white"
            save_button.corner_radius = 8
            save_button.frame = (screen_width - 300, 200, 200, 50)
            save_button.action = lambda sender: self.rename_warehouse(warehouse_id, name_input.text)
            content_view.add_subview(save_button)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Rename warehouse view content updated successfully")
        except Exception as e:
            print(f"Error in show_rename_warehouse_view: {e}")
    
    def rename_warehouse(self, warehouse_id, new_name):
        """重命名仓库"""
        try:
            if new_name and new_name.strip():
                self.partwall.rename_warehouse(warehouse_id, new_name.strip())
            self.show_warehouse_view()
        except Exception as e:
            print(f"Error in rename_warehouse: {e}")
    
    def show_box_view(self, warehouse_id):
        """显示盒子管理视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建盒子管理内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 退回上一级按钮（右上角）
            back_button = ui.Button()
            back_button.title = "退回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width - 120, 20, 100, 40)
            back_button.action = lambda sender: self.show_warehouse_view()
            content_view.add_subview(back_button)
            
            # 添加盒子按钮
            add_button = ui.Button()
            add_button.title = "添加盒子"
            add_button.background_color = "#3498db"
            add_button.tint_color = "white"
            add_button.corner_radius = 8
            add_button.frame = (20, 20, 100, 40)
            add_button.action = lambda sender: self.show_add_box_view(warehouse_id)
            content_view.add_subview(add_button)
            
            # 中央显示盒子管理标题（可点击更改）
            warehouse_name = self.partwall.get_warehouse_name(warehouse_id)
            center_title = ui.Button()
            center_title.title = f"盒子管理 - {warehouse_name}"
            center_title.font = ("Arial", 24)
            center_title.text_color = "#2c3e50"
            center_title.alignment = ui.ALIGN_CENTER
            center_title.frame = (0, 80, screen_width, 50)
            center_title.background_color = "clear"
            center_title.action = lambda sender, wid=warehouse_id, name=warehouse_name: self.show_rename_warehouse_view(wid, name)
            content_view.add_subview(center_title)
            
            # 盒子列表
            boxes = self.partwall.list_boxes(warehouse_id)
            
            if boxes:
                # 提示文本
                hint_label = ui.Label()
                hint_label.text = "点击盒子进入零件管理"
                hint_label.font = ("Arial", 14)
                hint_label.text_color = "#3498db"
                hint_label.alignment = ui.ALIGN_CENTER
                hint_label.frame = (0, 140, screen_width, 30)
                content_view.add_subview(hint_label)
                
                # 创建滚动视图来容纳盒子网格
                scroll_view = ui.ScrollView()
                scroll_view.frame = (20, 180, screen_width - 40, content_view.height - 200)
                scroll_view.content_size = (screen_width - 40, ((len(boxes) + 4) // 5) * 140)
                scroll_view.shows_horizontal_scroll_indicator = False
                
                # 计算每个盒子卡片的大小和位置
                card_width = (screen_width - 80) / 5  # 5个盒子一行，左右各20边距
                card_height = 100
                
                # 创建盒子卡片
                for i, box in enumerate(boxes):
                    # 计算行列位置
                    row = i // 5
                    col = i % 5
                    
                    # 创建卡片视图
                    card = ui.View()
                    card.frame = (0 + col * (card_width + 10), row * (card_height + 30), card_width, card_height + 10)
                    card.background_color = "#ffffff"
                    card.border_width = 1
                    card.border_color = "#ddd"
                    card.corner_radius = 8
                    card.user_interaction_enabled = True
                    
                    # 添加盒子序号和名称
                    box_info = ui.Label()
                    box_info.text = f"{box[0]}. {box[1]}"
                    box_info.font = ("Arial", 14)
                    box_info.text_color = "#2c3e50"
                    box_info.alignment = ui.ALIGN_CENTER
                    box_info.number_of_lines = 0
                    box_info.frame = (10, 10, card_width - 20, 60)
                    card.add_subview(box_info)
                    
                    # 添加点击事件到整个卡片
                    card_button = ui.Button()
                    card_button.frame = (0, 0, card_width, card_height + 10)
                    card_button.background_color = "clear"
                    card_button.action = lambda sender, wid=warehouse_id, box_num=box[0]: self.show_part_view(wid, box_num)
                    card.add_subview(card_button)
                    
                    scroll_view.add_subview(card)
                
                content_view.add_subview(scroll_view)
            else:
                # 提示文本
                hint_label = ui.Label()
                hint_label.text = "暂无盒子，请添加一个盒子"
                hint_label.font = ("Arial", 16)
                hint_label.text_color = "#7f8c8d"
                hint_label.alignment = ui.ALIGN_CENTER
                hint_label.frame = (0, (content_view.height - 50) / 2, screen_width, 50)
                content_view.add_subview(hint_label)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Box view content updated successfully")
        except Exception as e:
            print(f"Error in show_box_view: {e}")
    
    def show_add_box_view(self, warehouse_id):
        """显示添加盒子视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建添加盒子内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 标题
            title = ui.Label()
            title.text = "添加盒子"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.frame = (20, 20, screen_width - 40, 30)
            content_view.add_subview(title)
            
            # 编号输入
            number_label = ui.Label()
            number_label.text = "盒子编号:"
            number_label.font = ("Arial", 16)
            number_label.text_color = "#34495e"
            number_label.frame = (40, 70, 100, 30)
            content_view.add_subview(number_label)
            
            # 自动生成默认盒子编号
            boxes = self.partwall.list_boxes(warehouse_id)
            max_number = 0
            for box in boxes:
                if box[0] > max_number:
                    max_number = box[0]
            default_number = max_number + 1
            
            number_input = ui.TextField()
            number_input.text = str(default_number)
            number_input.keyboard_type = ui.KEYBOARD_NUMBER_PAD
            number_input.frame = (150, 70, screen_width - 190, 36)
            number_input.border_width = 1
            number_input.border_color = "#ddd"
            number_input.corner_radius = 4
            content_view.add_subview(number_input)
            
            # 名称输入
            name_label = ui.Label()
            name_label.text = "盒子名称:"
            name_label.font = ("Arial", 16)
            name_label.text_color = "#34495e"
            name_label.frame = (40, 120, 100, 30)
            content_view.add_subview(name_label)
            
            name_input = ui.TextField()
            name_input.placeholder = "请输入盒子名称"
            name_input.frame = (150, 120, screen_width - 190, 36)
            name_input.border_width = 1
            name_input.border_color = "#ddd"
            name_input.corner_radius = 4
            content_view.add_subview(name_input)
            
            # 按钮
            cancel_button = ui.Button()
            cancel_button.title = "取消"
            cancel_button.background_color = "#95a5a6"
            cancel_button.tint_color = "white"
            cancel_button.corner_radius = 8
            cancel_button.frame = (40, 180, 100, 40)
            cancel_button.action = lambda sender: self.show_box_view(warehouse_id)
            content_view.add_subview(cancel_button)
            
            save_button = ui.Button()
            save_button.title = "保存"
            save_button.background_color = "#3498db"
            save_button.tint_color = "white"
            save_button.corner_radius = 8
            save_button.frame = (screen_width - 140, 180, 100, 40)
            save_button.action = lambda sender: self.save_box(warehouse_id, number_input.text, name_input.text)
            content_view.add_subview(save_button)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Add box view content updated successfully")
        except Exception as e:
            print(f"Error in show_add_box_view: {e}")
    
    def save_box(self, warehouse_id, number, name):
        """保存盒子"""
        try:
            if number and name:
                try:
                    box_number = int(number)
                    self.partwall.add_box(warehouse_id, box_number, name)
                except ValueError:
                    # 显示错误提示
                    pass
            self.show_box_view(warehouse_id)
        except Exception as e:
            print(f"Error in save_box: {e}")
    
    def show_rename_box_view(self, warehouse_id, box_number, current_name):
        """显示盒子重命名视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建重命名盒子内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 标题
            title = ui.Label()
            title.text = "重命名盒子"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (20, 40, screen_width - 40, 30)
            content_view.add_subview(title)
            
            # 名称输入
            name_label = ui.Label()
            name_label.text = "新名称:"
            name_label.font = ("Arial", 16)
            name_label.text_color = "#34495e"
            name_label.frame = (40, 120, 100, 30)
            content_view.add_subview(name_label)
            
            name_input = ui.TextField()
            name_input.text = current_name
            name_input.frame = (150, 120, screen_width - 190, 36)
            name_input.border_width = 1
            name_input.border_color = "#ddd"
            name_input.corner_radius = 4
            content_view.add_subview(name_input)
            
            # 取消按钮
            cancel_button = ui.Button()
            cancel_button.title = "取消"
            cancel_button.background_color = "#95a5a6"
            cancel_button.tint_color = "white"
            cancel_button.corner_radius = 8
            cancel_button.frame = (100, 200, 200, 50)
            cancel_button.action = lambda sender: self.show_box_view(warehouse_id)
            content_view.add_subview(cancel_button)
            
            # 保存按钮
            save_button = ui.Button()
            save_button.title = "保存"
            save_button.background_color = "#3498db"
            save_button.tint_color = "white"
            save_button.corner_radius = 8
            save_button.frame = (screen_width - 300, 200, 200, 50)
            save_button.action = lambda sender: self.rename_box(warehouse_id, box_number, name_input.text)
            content_view.add_subview(save_button)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Rename box view content updated successfully")
        except Exception as e:
            print(f"Error in show_rename_box_view: {e}")
    
    def rename_box(self, warehouse_id, box_number, new_name):
        """重命名盒子"""
        try:
            if new_name and new_name.strip():
                self.partwall.rename_box(warehouse_id, box_number, new_name.strip())
            self.show_box_view(warehouse_id)
        except Exception as e:
            print(f"Error in rename_box: {e}")
    
    def show_part_view(self, warehouse_id, box_number):
        """显示零件管理视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if hasattr(self, 'current_content_view') and self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except Exception as e:
                    pass
            
            # 创建零件管理内容视图（只占据次视图区域，与主页面布局一致）
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 退回上一级按钮（右上角）
            back_button = ui.Button()
            back_button.title = "退回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width - 120, 20, 100, 40)
            back_button.action = lambda sender: self.show_box_view(warehouse_id)
            content_view.add_subview(back_button)
            
            # 添加零件按钮
            add_button = ui.Button()
            add_button.title = "添加零件"
            add_button.background_color = "#3498db"
            add_button.tint_color = "white"
            add_button.corner_radius = 8
            add_button.frame = (20, 20, 100, 40)
            # 使用局部变量保存warehouse_id和box_number，避免闭包问题
            def add_part_action(sender):
                try:
                    print(f"Add part button clicked, warehouse_id: {warehouse_id}, box_number: {box_number}")
                    self.show_add_part_view(warehouse_id, box_number)
                except Exception as e:
                    print(f"Error in add_part_action: {e}")
            add_button.action = add_part_action
            content_view.add_subview(add_button)
            
            # 中央显示零件管理标题（可点击更改）
            box_name = self.partwall.get_box_name(warehouse_id, box_number)
            center_title = ui.Button()
            center_title.title = f"零件管理 - {box_name}"
            center_title.font = ("Arial", 24)
            center_title.text_color = "#2c3e50"
            center_title.alignment = ui.ALIGN_CENTER
            center_title.frame = (0, 80, screen_width, 50)
            center_title.background_color = "clear"
            center_title.action = lambda sender, wid=warehouse_id, box_num=box_number, name=box_name: self.show_rename_box_view(wid, box_num, name)
            content_view.add_subview(center_title)
            
            # 零件列表
            parts = self.partwall.list_parts_in_box(warehouse_id, box_number)
            
            if parts:
                # 提示文本
                hint_label = ui.Label()
                hint_label.text = "点击零件进入零件管理"
                hint_label.font = ("Arial", 14)
                hint_label.text_color = "#3498db"
                hint_label.alignment = ui.ALIGN_CENTER
                hint_label.frame = (0, 140, screen_width, 30)
                content_view.add_subview(hint_label)
                
                # 创建滚动视图来容纳零件网格
                scroll_view = ui.ScrollView()
                scroll_view.frame = (20, 180, screen_width - 40, content_view.height - 200)
                scroll_view.content_size = (screen_width - 40, ((len(parts) + 4) // 5) * 170)  # 调整高度以适应新的卡片大小
                scroll_view.shows_horizontal_scroll_indicator = False
                
                # 计算每个零件卡片的大小和位置
                card_width = (screen_width - 80) / 5  # 5个零件一行，左右各20边距
                card_height = 150  # 增加高度以容纳图片
                
                # 创建零件卡片
                for i, part in enumerate(parts):
                    # 计算行列位置
                    row = i // 5
                    col = i % 5
                    
                    # 创建卡片视图
                    card = ui.View()
                    card.frame = (0 + col * (card_width + 10), row * (card_height + 20), card_width, card_height)
                    card.background_color = "#ffffff"
                    card.border_width = 1
                    card.border_color = "#ddd"
                    card.corner_radius = 8
                    card.user_interaction_enabled = True
                    
                    # 添加零件图片
                    part_num, color_id, quantity = part
                    
                    # 创建图片视图
                    img_view = ui.ImageView()
                    img_view.frame = (10, 10, card_width - 20, 80)
                    img_view.background_color = "#ecf0f1"
                    img_view.corner_radius = 5
                    img_view.content_mode = ui.CONTENT_SCALE_ASPECT_FIT
                    
                    # 尝试获取并显示零件图片
                    try:
                        # 从partwall.db数据库的inventory_parts表中获取零件图片URL
                        img_url = self.get_part_image_url(part_num, color_id)
                        
                        if img_url:
                            # 下载图片
                            img_path = self.download_image(img_url, part_num, color_id)
                            
                            if img_path:
                                # 检查图片文件是否存在
                                import os
                                if os.path.exists(img_path):
                                    # 加载并显示图片
                                    import ui
                                    try:
                                        img = ui.Image.named(img_path)
                                        if img:
                                            img_view.image = img
                                        else:
                                            # 图片加载失败，显示占位符
                                            placeholder_label = ui.Label()
                                            placeholder_label.frame = (0, 0, card_width - 20, 80)
                                            placeholder_label.text = "Image"
                                            placeholder_label.font = ("Arial", 12)
                                            placeholder_label.text_color = "#7f8c8d"
                                            placeholder_label.alignment = ui.ALIGN_CENTER
                                            img_view.add_subview(placeholder_label)
                                    except Exception as img_load_error:
                                        # 显示错误占位符
                                        placeholder_label = ui.Label()
                                        placeholder_label.frame = (0, 0, card_width - 20, 80)
                                        placeholder_label.text = "Load Error"
                                        placeholder_label.font = ("Arial", 12)
                                        placeholder_label.text_color = "#e74c3c"
                                        placeholder_label.alignment = ui.ALIGN_CENTER
                                        img_view.add_subview(placeholder_label)
                                else:
                                    # 图片文件不存在
                                    placeholder_label = ui.Label()
                                    placeholder_label.frame = (0, 0, card_width - 20, 80)
                                    placeholder_label.text = "File"
                                    placeholder_label.font = ("Arial", 12)
                                    placeholder_label.text_color = "#7f8c8d"
                                    placeholder_label.alignment = ui.ALIGN_CENTER
                                    img_view.add_subview(placeholder_label)
                            else:
                                # 下载失败，显示占位符
                                placeholder_label = ui.Label()
                                placeholder_label.frame = (0, 0, card_width - 20, 80)
                                placeholder_label.text = "Download"
                                placeholder_label.font = ("Arial", 12)
                                placeholder_label.text_color = "#7f8c8d"
                                placeholder_label.alignment = ui.ALIGN_CENTER
                                img_view.add_subview(placeholder_label)
                        else:
                            # 没有找到图片URL，显示占位符
                            placeholder_label = ui.Label()
                            placeholder_label.frame = (0, 0, card_width - 20, 80)
                            placeholder_label.text = "No Image"
                            placeholder_label.font = ("Arial", 12)
                            placeholder_label.text_color = "#7f8c8d"
                            placeholder_label.alignment = ui.ALIGN_CENTER
                            img_view.add_subview(placeholder_label)
                    except Exception as e:
                        # 出错时显示占位符
                        placeholder_label = ui.Label()
                        placeholder_label.frame = (0, 0, card_width - 20, 80)
                        placeholder_label.text = "Error"
                        placeholder_label.font = ("Arial", 12)
                        placeholder_label.text_color = "#e74c3c"
                        placeholder_label.alignment = ui.ALIGN_CENTER
                        img_view.add_subview(placeholder_label)
                    
                    card.add_subview(img_view)
                    
                    # 添加零件型号
                    part_num_label = ui.Label()
                    part_num_label.text = f"{part[0]}"
                    part_num_label.font = ("Arial", 12)
                    part_num_label.text_color = "#2c3e50"
                    part_num_label.alignment = ui.ALIGN_CENTER
                    part_num_label.number_of_lines = 1
                    part_num_label.frame = (10, 100, card_width - 20, 20)
                    card.add_subview(part_num_label)
                    
                    # 添加零件颜色和数量
                    part_info_label = ui.Label()
                    # 获取颜色名称
                    color_name = self.get_color_name(part[1])
                    part_info_label.text = f"颜色: {color_name} | 数量: {part[2]}"
                    part_info_label.font = ("Arial", 10)
                    part_info_label.text_color = "#7f8c8d"
                    part_info_label.alignment = ui.ALIGN_CENTER
                    part_info_label.number_of_lines = 1
                    part_info_label.frame = (10, 120, card_width - 20, 20)
                    card.add_subview(part_info_label)
                    
                    # 使用按钮替代点击手势，点击弹出选择框
                    card_button = ui.Button()
                    card_button.frame = (0, 0, card_width, card_height)
                    card_button.background_color = 'clear'
                    card_button.action = lambda sender, part_info=part, wid=warehouse_id, box_num=box_number: self.show_part_options(part_info, wid, box_num)
                    card.add_subview(card_button)
                    
                    scroll_view.add_subview(card)
                
                content_view.add_subview(scroll_view)
            else:
                # 提示文本
                hint_label = ui.Label()
                hint_label.text = "暂无零件，请添加一个零件"
                hint_label.font = ("Arial", 16)
                hint_label.text_color = "#7f8c8d"
                hint_label.alignment = ui.ALIGN_CENTER
                hint_label.frame = (0, (content_view.height - 50) / 2, screen_width, 50)
                content_view.add_subview(hint_label)
            
            # 添加内容视图到主视图
            if hasattr(self, 'main_view'):
                self.main_view.add_subview(content_view)
                print("Content view added to main view")
                
                # 确保内容视图在最前面
                content_view.bring_to_front()
                print("Content view brought to front")
                
                # 保存当前内容视图
                self.current_content_view = content_view
                print("Current content view saved")
                
                print("Part view content updated successfully")
            else:
                print("Error: main_view attribute not found")
        except Exception as e:
            print(f"Error in show_part_view: {e}")
    
    def show_part_options(self, part_info, warehouse_id, box_number):
        """显示零件操作选项"""
        try:
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            part_num, color_id, quantity = part_info
            
            # 创建选项视图
            options_view = ui.View()
            options_view.frame = (screen_width * 0.3, screen_height * 0.3, screen_width * 0.4, 200)
            options_view.background_color = "#ffffff"
            options_view.border_width = 1
            options_view.border_color = "#ddd"
            options_view.corner_radius = 8
            
            # 保存上下文信息
            options_view.part_num = part_num
            options_view.color_id = color_id
            options_view.quantity = quantity
            options_view.warehouse_id = warehouse_id
            options_view.box_number = box_number
            options_view.parent_app = self
            
            # 标题
            title_label = ui.Label()
            title_label.text = "选择操作"
            title_label.font = ("Arial", 16)
            title_label.text_color = "#2c3e50"
            title_label.alignment = ui.ALIGN_CENTER
            title_label.frame = (0, 20, options_view.width, 30)
            options_view.add_subview(title_label)
            
            # 零件信息
            part_label = ui.Label()
            part_label.text = f"零件: {part_num}\n颜色ID: {color_id}\n数量: {quantity}"
            part_label.font = ("Arial", 14)
            part_label.text_color = "#34495e"
            part_label.alignment = ui.ALIGN_CENTER
            part_label.number_of_lines = 3
            part_label.frame = (20, 60, options_view.width - 40, 60)
            options_view.add_subview(part_label)
            
            # 零件搜索按钮
            search_button = ui.Button()
            search_button.title = "零件搜索"
            search_button.background_color = "#3498db"
            search_button.tint_color = "white"
            search_button.corner_radius = 5
            search_button.frame = (20, 130, (options_view.width - 50) / 2, 40)
            search_button.action = self.handle_search_action
            search_button.options_view = options_view
            options_view.add_subview(search_button)
            
            # 零件编辑按钮
            edit_button = ui.Button()
            edit_button.title = "零件编辑"
            edit_button.background_color = "#27ae60"
            edit_button.tint_color = "white"
            edit_button.corner_radius = 5
            edit_button.frame = (options_view.width - 20 - (options_view.width - 50) / 2, 130, (options_view.width - 50) / 2, 40)
            edit_button.action = self.handle_edit_action
            edit_button.options_view = options_view
            options_view.add_subview(edit_button)
            
            # 返回按钮（移到右上角）
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#95a5a6"
            back_button.tint_color = "white"
            back_button.corner_radius = 5
            back_button.frame = (options_view.width - 80, 10, 60, 30)
            # 修改返回按钮的操作，使其在Pythonista中也能工作
            def back_action(sender):
                try:
                    # 检查视图是否有remove_from_superview方法
                    if hasattr(options_view, 'remove_from_superview'):
                        options_view.remove_from_superview()
                        print("options_view removed via remove_from_superview")
                    else:
                        # 在Pythonista中，_ui.View对象没有remove_from_superview方法
                        # 我们可以通过设置alpha为0来隐藏视图
                        options_view.alpha = 0
                        print("options_view hidden via alpha = 0")
                except Exception as e:
                    print(f"Error removing/hiding options_view: {e}")
            back_button.action = back_action
            options_view.add_subview(back_button)
            
            # 调整选项视图高度（不需要额外增加高度，因为返回按钮现在在顶部）
            options_view.frame = (screen_width * 0.3, screen_height * 0.3, screen_width * 0.4, 200)
            
            # 添加到主视图
            self.main_view.add_subview(options_view)
            
        except Exception as e:
            print(f"Error in show_part_options: {e}")
    
    def handle_search_action(self, sender):
        """处理零件搜索按钮点击"""
        try:
            options_view = sender.options_view
            part_num = options_view.part_num
            self.show_search_view(part_num)
            # 使用try-except确保即使移除失败也不会崩溃
            try:
                options_view.remove_from_superview()
            except:
                pass
        except Exception as e:
            print(f"Error in handle_search_action: {e}")
    
    def handle_edit_action(self, sender):
        """处理零件编辑按钮点击"""
        try:
            print("handle_edit_action called")
            options_view = sender.options_view
            print(f"options_view: {options_view}")
            part_num = options_view.part_num
            color_id = options_view.color_id
            quantity = options_view.quantity
            warehouse_id = options_view.warehouse_id
            box_number = options_view.box_number
            print(f"Part info: {part_num}, {color_id}, {quantity}")
            print(f"Location: {warehouse_id}, {box_number}")
            
            # 先移除选项视图，避免界面卡住
            try:
                # 检查视图是否有remove_from_superview方法
                if hasattr(options_view, 'remove_from_superview'):
                    options_view.remove_from_superview()
                    print("options_view removed")
                else:
                    # 在Pythonista中，_ui.View对象没有remove_from_superview方法
                    print("options_view has no remove_from_superview method")
            except Exception as e:
                print(f"Error removing options_view: {e}")
                pass
            
            # 然后显示编辑页面
            self.show_edit_part_view(warehouse_id, box_number, part_num, color_id, quantity)
        except Exception as e:
            print(f"Error in handle_edit_action: {e}")
            import traceback
            traceback.print_exc()
            # 确保即使出错也移除选项视图
            try:
                options_view = sender.options_view
                # 检查视图是否有remove_from_superview方法
                if hasattr(options_view, 'remove_from_superview'):
                    options_view.remove_from_superview()
                else:
                    # 在Pythonista中，_ui.View对象没有remove_from_superview方法
                    print("options_view has no remove_from_superview method")
            except:
                pass
    
    def show_edit_part_view(self, warehouse_id, box_number, part_num, color_id, quantity):
        """显示零件编辑页面"""
        print("show_edit_part_view called")
        
        # 简化实现，使用最基本的UI元素
        try:
            # 确保ui模块被导入
            global ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            print(f"Screen size: {screen_width}x{screen_height}")
            
            print(f"Part info: {part_num}, {color_id}, {quantity}")
            print(f"Location: {warehouse_id}, {box_number}")
            
            # 移除当前内容视图（如果存在）
            if hasattr(self, 'current_content_view') and self.current_content_view:
                try:
                    print("Removing current content view")
                    # 检查视图是否有remove_from_superview方法
                    if hasattr(self.current_content_view, 'remove_from_superview'):
                        self.current_content_view.remove_from_superview()
                        print("Current content view removed successfully")
                    else:
                        # 在Pythonista中，_ui.View对象没有remove_from_superview方法
                        # 我们可以通过设置current_content_view为None来模拟移除
                        print("Current content view has no remove_from_superview method, setting to None")
                        self.current_content_view = None
                except Exception as e:
                    print(f"Error removing current content view: {e}")
                    pass
            
            # 创建零件编辑内容视图（只占据次视图区域，与主页面布局一致）
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            print("Content view created")
            
            # 退回上一级按钮（右上角）
            back_button = ui.Button()
            back_button.title = "退回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width - 120, 20, 100, 40)
            back_button.action = lambda sender: self.show_part_view(warehouse_id, box_number)
            content_view.add_subview(back_button)
            print("Back button added")
            
            # 标题
            title_label = ui.Label()
            title_label.text = f"零件编辑"
            title_label.font = ("Arial", 24)
            title_label.text_color = "#2c3e50"
            title_label.alignment = ui.ALIGN_CENTER
            title_label.frame = (0, 80, screen_width, 50)
            content_view.add_subview(title_label)
            print("Title label added")
            
            # 零件型号显示
            part_label = ui.Label()
            part_label.text = f"零件型号: {part_num}"
            part_label.font = ("Arial", 16)
            part_label.text_color = "#34495e"
            part_label.frame = (40, 140, screen_width - 80, 30)
            content_view.add_subview(part_label)
            print("Part label added")
            
            # 颜色编辑部分
            color_label = ui.Label()
            color_label.text = "颜色ID:" 
            color_label.font = ("Arial", 16)
            color_label.text_color = "#34495e"
            color_label.frame = (40, 180, 100, 30)
            content_view.add_subview(color_label)
            
            color_input = ui.TextField()
            color_input.text = str(color_id)
            color_input.keyboard_type = ui.KEYBOARD_NUMBER_PAD
            color_input.frame = (150, 180, 200, 36)
            color_input.border_width = 1
            color_input.border_color = "#ddd"
            color_input.corner_radius = 4
            content_view.add_subview(color_input)
            print("Color input added")
            
            # 颜色选择按钮
            color_select_button = ui.Button()
            color_select_button.title = "颜色选择"
            color_select_button.background_color = "#3498db"
            color_select_button.tint_color = "white"
            color_select_button.corner_radius = 4
            color_select_button.frame = (360, 180, 100, 36)
            color_select_button.user_interaction_enabled = True  # 确保按钮可交互
            # 添加详细的调试信息
            def color_select_action(sender):
                try:
                    self.show_color_selection_view(color_input)
                except Exception as e:
                    pass
            color_select_button.action = color_select_action
            # 直接添加按钮，不使用bring_subview_to_front
            content_view.add_subview(color_select_button)
            
            # 数量编辑部分（移到颜色选择按钮右边）
            quantity_label = ui.Label()
            quantity_label.text = "数量:" 
            quantity_label.font = ("Arial", 16)
            quantity_label.text_color = "#34495e"
            quantity_label.frame = (480, 180, 100, 30)
            content_view.add_subview(quantity_label)
            
            quantity_input = ui.TextField()
            quantity_input.text = str(quantity)
            quantity_input.keyboard_type = ui.KEYBOARD_NUMBER_PAD
            quantity_input.frame = (580, 180, 200, 36)
            quantity_input.border_width = 1
            quantity_input.border_color = "#ddd"
            quantity_input.corner_radius = 4
            content_view.add_subview(quantity_input)
            print("Quantity input added")
            
            # 当前位置显示
            location_label = ui.Label()
            location_label.text = "当前位置:" 
            location_label.font = ("Arial", 16)
            location_label.text_color = "#34495e"
            location_label.frame = (40, 230, 100, 30)
            content_view.add_subview(location_label)
            
            # 获取仓库和盒子名称
            warehouse_name = self.partwall.get_warehouse_name(warehouse_id)
            box_name = self.partwall.get_box_name(warehouse_id, box_number)
            
            location_value = ui.Label()
            location_value.text = f"仓库: {warehouse_id} ({warehouse_name}), 盒子: {box_number} ({box_name})"
            location_value.font = ("Arial", 16)
            location_value.text_color = "#27ae60"
            location_value.frame = (150, 230, screen_width - 190, 30)
            location_value.number_of_lines = 1
            content_view.add_subview(location_value)
            print("Location display added")
            
            # 位置变更按钮
            change_location_button = ui.Button()
            change_location_button.title = "位置变更"
            change_location_button.background_color = "#3498db"
            change_location_button.tint_color = "white"
            change_location_button.corner_radius = 8
            change_location_button.frame = (screen_width // 2 - 100, 280, 200, 40)
            change_location_button.font = ("Arial", 16)
            
            # 位置变更相关变量
            selected_warehouse_id = warehouse_id
            selected_box_number = box_number
            location_options_visible = False
            warehouse_scroll_view = None
            box_scroll_view = None
            
            # 显示盒子选项的函数
            def show_box_options(w_id):
                nonlocal box_scroll_view
                
                # 移除之前的盒子滚动视图
                if box_scroll_view:
                    try:
                        box_scroll_view.remove_from_superview()
                    except:
                        pass
                
                # 获取该仓库的所有盒子
                try:
                    boxes = self.partwall.list_boxes(w_id)
                except Exception as e:
                    print(f"Error getting boxes: {e}")
                    boxes = []
                
                if boxes:
                    # 创建盒子滚动视图
                    box_scroll_view = ui.ScrollView()
                    box_scroll_view.frame = (20, 480, screen_width - 40, 120)
                    box_scroll_view.content_size = (screen_width - 40, ((len(boxes) + 3) // 4) * 90)
                    box_scroll_view.shows_horizontal_scroll_indicator = False
                    
                    # 盒子标题
                    box_title = ui.Label()
                    box_title.text = "选择盒子:"
                    box_title.font = ("Arial", 14)
                    box_title.text_color = "#34495e"
                    box_title.frame = (0, 0, screen_width - 40, 30)
                    box_scroll_view.add_subview(box_title)
                    
                    # 创建盒子卡片
                    for i, box in enumerate(boxes):
                        bnum = box[0]
                        bname = box[1]
                        
                        # 计算位置
                        row = i // 4
                        col = i % 4
                        card_width = (screen_width - 80) / 4
                        card_height = 60
                        
                        # 创建卡片
                        box_card = ui.View()
                        box_card.frame = (15 + col * (card_width + 10), 40 + row * (card_height + 10), card_width, card_height)
                        box_card.background_color = "#ffffff"
                        box_card.border_width = 2
                        box_card.border_color = "#27ae60" if bnum == selected_box_number else "#ddd"
                        box_card.corner_radius = 6
                        box_card.user_interaction_enabled = True
                        
                        # 添加点击手势
                        def box_tap_action(sender, b_num=bnum):
                            nonlocal selected_box_number
                            # 更新选中的盒子
                            selected_box_number = b_num
                            
                            # 更新位置显示
                            warehouse_name = self.partwall.get_warehouse_name(selected_warehouse_id)
                            box_name = self.partwall.get_box_name(selected_warehouse_id, b_num)
                            location_value.text = f"仓库: {selected_warehouse_id} ({warehouse_name}), 盒子: {b_num} ({box_name})"
                            
                            # 更新盒子卡片边框
                            for subview in box_scroll_view.subviews:
                                if hasattr(subview, 'box_number'):
                                    subview.border_color = "#27ae60" if subview.box_number == b_num else "#ddd"
                        
                        # 保存盒子ID到卡片
                        box_card.box_number = bnum
                        
                        # 添加点击事件
                        box_card_tap = ui.Button()
                        box_card_tap.frame = (0, 0, card_width, card_height)
                        box_card_tap.background_color = "clear"
                        box_card_tap.action = box_tap_action
                        box_card.add_subview(box_card_tap)
                        
                        # 盒子ID
                        box_id_label = ui.Label()
                        box_id_label.text = f"ID: {bnum}"
                        box_id_label.font = ("Arial", 12)
                        box_id_label.text_color = "#2c3e50"
                        box_id_label.frame = (5, 5, card_width - 10, 15)
                        box_card.add_subview(box_id_label)
                        
                        # 盒子名称
                        box_name_label = ui.Label()
                        box_name_label.text = f"名称: {bname}"
                        box_name_label.font = ("Arial", 10)
                        box_name_label.text_color = "#7f8c8d"
                        box_name_label.frame = (5, 25, card_width - 10, 15)
                        box_name_label.number_of_lines = 1
                        box_card.add_subview(box_name_label)
                        
                        box_scroll_view.add_subview(box_card)
                    
                    content_view.add_subview(box_scroll_view)
                    print("Box options added")
                else:
                    # 没有盒子的提示
                    no_box_label = ui.Label()
                    no_box_label.text = "该仓库没有盒子"
                    no_box_label.font = ("Arial", 14)
                    no_box_label.text_color = "#e74c3c"
                    no_box_label.alignment = ui.ALIGN_CENTER
                    no_box_label.frame = (20, 480, screen_width - 40, 40)
                    content_view.add_subview(no_box_label)
            
            # 显示仓库选项的函数
            def show_warehouse_options():
                nonlocal location_options_visible, warehouse_scroll_view, box_scroll_view
                
                # 切换显示/隐藏
                location_options_visible = not location_options_visible
                
                # 移除之前的滚动视图
                if warehouse_scroll_view:
                    try:
                        warehouse_scroll_view.remove_from_superview()
                    except:
                        pass
                if box_scroll_view:
                    try:
                        box_scroll_view.remove_from_superview()
                    except:
                        pass
                
                if location_options_visible:
                    # 获取所有仓库
                    try:
                        warehouses = self.partwall.list_warehouses()
                    except Exception as e:
                        print(f"Error getting warehouses: {e}")
                        warehouses = []
                    
                    if warehouses:
                        # 创建仓库滚动视图
                        warehouse_scroll_view = ui.ScrollView()
                        warehouse_scroll_view.frame = (20, 340, screen_width - 40, 120)
                        warehouse_scroll_view.content_size = (screen_width - 40, ((len(warehouses) + 2) // 3) * 110)
                        warehouse_scroll_view.shows_horizontal_scroll_indicator = False
                        
                        # 仓库标题
                        warehouse_title = ui.Label()
                        warehouse_title.text = "选择仓库:"
                        warehouse_title.font = ("Arial", 14)
                        warehouse_title.text_color = "#34495e"
                        warehouse_title.frame = (0, 0, screen_width - 40, 30)
                        warehouse_scroll_view.add_subview(warehouse_title)
                        
                        # 创建仓库卡片
                        for i, warehouse in enumerate(warehouses):
                            wid = warehouse[0]
                            wname = warehouse[1]
                            
                            # 计算位置
                            row = i // 3
                            col = i % 3
                            card_width = (screen_width - 80) / 3
                            card_height = 80
                            
                            # 创建卡片
                            warehouse_card = ui.View()
                            warehouse_card.frame = (20 + col * (card_width + 10), 40 + row * (card_height + 10), card_width, card_height)
                            warehouse_card.background_color = "#ffffff"
                            warehouse_card.border_width = 2
                            warehouse_card.border_color = "#3498db" if wid == selected_warehouse_id else "#ddd"
                            warehouse_card.corner_radius = 8
                            warehouse_card.user_interaction_enabled = True
                            
                            # 添加点击手势
                            def warehouse_tap_action(sender, w_id=wid):
                                nonlocal selected_warehouse_id, selected_box_number, box_scroll_view
                                # 更新选中的仓库
                                selected_warehouse_id = w_id
                                selected_box_number = 1  # 默认选择第一个盒子
                                
                                # 更新位置显示
                                warehouse_name = self.partwall.get_warehouse_name(w_id)
                                box_name = self.partwall.get_box_name(w_id, 1)
                                location_value.text = f"仓库: {w_id} ({warehouse_name}), 盒子: 1 ({box_name})"
                                
                                # 更新仓库卡片边框
                                for subview in warehouse_scroll_view.subviews:
                                    if hasattr(subview, 'warehouse_id'):
                                        subview.border_color = "#3498db" if subview.warehouse_id == w_id else "#ddd"
                                
                                # 显示该仓库的盒子
                                show_box_options(w_id)
                            
                            # 保存仓库ID到卡片
                            warehouse_card.warehouse_id = wid
                            
                            # 添加点击事件
                            warehouse_card_tap = ui.Button()
                            warehouse_card_tap.frame = (0, 0, card_width, card_height)
                            warehouse_card_tap.background_color = "clear"
                            warehouse_card_tap.action = warehouse_tap_action
                            warehouse_card.add_subview(warehouse_card_tap)
                            
                            # 仓库ID
                            warehouse_id_label = ui.Label()
                            warehouse_id_label.text = f"ID: {wid}"
                            warehouse_id_label.font = ("Arial", 14)
                            warehouse_id_label.text_color = "#2c3e50"
                            warehouse_id_label.frame = (10, 10, card_width - 20, 20)
                            warehouse_card.add_subview(warehouse_id_label)
                            
                            # 仓库名称
                            warehouse_name_label = ui.Label()
                            warehouse_name_label.text = f"名称: {wname}"
                            warehouse_name_label.font = ("Arial", 12)
                            warehouse_name_label.text_color = "#7f8c8d"
                            warehouse_name_label.frame = (10, 35, card_width - 20, 20)
                            warehouse_name_label.number_of_lines = 1
                            warehouse_card.add_subview(warehouse_name_label)
                            
                            warehouse_scroll_view.add_subview(warehouse_card)
                        
                        content_view.add_subview(warehouse_scroll_view)
                        print("Warehouse options added")
                    else:
                        # 没有仓库的提示
                        no_warehouse_label = ui.Label()
                        no_warehouse_label.text = "没有可用的仓库"
                        no_warehouse_label.font = ("Arial", 14)
                        no_warehouse_label.text_color = "#e74c3c"
                        no_warehouse_label.alignment = ui.ALIGN_CENTER
                        no_warehouse_label.frame = (20, 340, screen_width - 40, 40)
                        content_view.add_subview(no_warehouse_label)
            
            # 绑定位置变更按钮的点击事件
            change_location_button.action = lambda sender: show_warehouse_options()
            content_view.add_subview(change_location_button)
            print("Change location button added")
            
            # 保存按钮（左上角）
            save_button = ui.Button()
            save_button.title = "保存修改"
            save_button.background_color = "#27ae60"
            save_button.tint_color = "white"
            save_button.corner_radius = 8
            save_button.frame = (40, 80, 120, 40)  # 左上角位置
            save_button.font = ("Arial", 16)
            
            # 使用局部函数避免lambda中的变量捕获问题
            def on_save(sender):
                try:
                    print("Save button clicked")
                    # 使用选中的仓库和盒子信息
                    print(f"Saving part: {part_num}, color: {color_input.text}, quantity: {quantity_input.text}")
                    print(f"Location: {selected_warehouse_id}, {selected_box_number}")
                    
                    # 调用保存方法
                    self.save_part_edit(
                        warehouse_id, box_number, part_num, color_id, 
                        color_input.text, quantity_input.text,
                        selected_warehouse_id, selected_box_number, [], []
                    )
                except Exception as e:
                    print(f"Error in save button action: {e}")
                    import traceback
                    traceback.print_exc()
            
            save_button.action = on_save
            content_view.add_subview(save_button)
            print("Save button added")
            
            # 添加内容视图到主视图
            print("Adding content view to main view")
            if hasattr(self, 'main_view'):
                # 添加新的内容视图
                self.main_view.add_subview(content_view)
                print("Content view added to main view")
                
                # 确保内容视图在最前面
                content_view.bring_to_front()
                print("Content view brought to front")
                
                # 保存当前内容视图
                self.current_content_view = content_view
                print("Current content view saved")
            else:
                print("Error: main_view attribute not found")
            
            print("Part edit view content updated successfully")
        except Exception as e:
            print(f"Error in show_edit_part_view: {e}")
            import traceback
            traceback.print_exc()
            
            # 即使出错也创建一个简单的错误提示页面
            try:
                import ui
                screen_width = ui.get_screen_size()[0]
                screen_height = ui.get_screen_size()[1]
                
                error_view = ui.View()
                error_view.frame = (0, 150, screen_width, screen_height - 150)
                error_view.background_color = "#f5f5f5"
                
                # 退回上一级按钮（右上角）
                back_button = ui.Button()
                back_button.title = "退回"
                back_button.background_color = "#e74c3c"
                back_button.tint_color = "white"
                back_button.corner_radius = 8
                back_button.frame = (screen_width - 120, 20, 100, 40)
                back_button.action = lambda sender: self.show_part_view(warehouse_id, box_number)
                error_view.add_subview(back_button)
                
                error_label = ui.Label()
                error_label.text = f"编辑页面加载失败: {str(e)}"
                error_label.font = ("Arial", 16)
                error_label.text_color = "#e74c3c"
                error_label.alignment = ui.ALIGN_CENTER
                error_label.number_of_lines = 0
                error_label.frame = (50, 150, screen_width - 100, 100)
                error_view.add_subview(error_label)
                
                retry_button = ui.Button()
                retry_button.title = "返回"
                retry_button.background_color = "#3498db"
                retry_button.tint_color = "white"
                retry_button.corner_radius = 8
                retry_button.frame = (screen_width // 2 - 100, 300, 200, 40)
                retry_button.action = lambda sender: self.show_part_view(warehouse_id, box_number)
                error_view.add_subview(retry_button)
                
                if hasattr(self, 'main_view'):
                    # 移除当前内容视图
                    if hasattr(self, 'current_content_view') and self.current_content_view:
                        try:
                            self.current_content_view.remove_from_superview()
                        except:
                            pass
                    
                    self.main_view.add_subview(error_view)
                    self.current_content_view = error_view
                    print("Error view added")
            except Exception as e2:
                print(f"Error creating error view: {e2}")
                # 如果创建错误视图也失败，尝试直接返回
                try:
                    self.show_part_view(warehouse_id, box_number)
                except:
                    pass
    
    def save_part_edit(self, warehouse_id, box_number, part_num, old_color_id, new_color_input, new_quantity_str, warehouse_picker=None, box_picker=None, warehouses=None, boxes=None):
        """保存零件编辑"""
        try:
            import sqlite3
            print(f"开始保存零件编辑: {part_num}")
            print(f"参数: warehouse_id={warehouse_id}, box_number={box_number}, part_num={part_num}, old_color_id={old_color_id}")
            print(f"新值: color={new_color_input}, quantity={new_quantity_str}")
            
            # 处理旧颜色ID（可能是文本）
            processed_old_color_id = None
            try:
                processed_old_color_id = int(old_color_id)
                print(f"旧颜色ID是数字: {processed_old_color_id}")
            except ValueError:
                # 不是数字，视为颜色名称
                old_color_name = str(old_color_id).strip()
                print(f"旧颜色ID是文本: {old_color_name}")
                if old_color_name:
                    conn = self.partwall._get_connection()
                    cursor = conn.cursor()
                    
                    # 查找颜色
                    cursor.execute('''
                        SELECT id FROM colors WHERE color_name = ?
                    ''', (old_color_name,))
                    color_row = cursor.fetchone()
                    if color_row:
                        processed_old_color_id = color_row[0]
                        print(f"找到颜色ID: {processed_old_color_id}")
                    else:
                        print(f"未找到颜色: {old_color_name}")
                    conn.close()
            
            if not processed_old_color_id:
                print("旧颜色ID不能为空")
                return
            print(f"处理后的旧颜色ID: {processed_old_color_id}")
            
            # 处理颜色输入
            new_color_id = None
            try:
                new_color_id = int(new_color_input)
                print(f"新颜色ID是数字: {new_color_id}")
            except ValueError:
                # 不是数字，视为颜色名称
                color_name = new_color_input.strip()
                print(f"新颜色ID是文本: {color_name}")
                if color_name:
                    conn = self.partwall._get_connection()
                    cursor = conn.cursor()
                    
                    # 查找或创建颜色
                    cursor.execute('''
                        INSERT OR IGNORE INTO colors (color_name)
                        VALUES (?)
                    ''', (color_name,))
                    conn.commit()
                    
                    # 获取颜色ID
                    cursor.execute('''
                        SELECT id FROM colors WHERE color_name = ?
                    ''', (color_name,))
                    color_row = cursor.fetchone()
                    if color_row:
                        new_color_id = color_row[0]
                        print(f"找到或创建颜色ID: {new_color_id}")
                    conn.close()
            
            if not new_color_id:
                print("颜色ID不能为空")
                return
            print(f"处理后的新颜色ID: {new_color_id}")
            
            # 处理数量输入
            new_quantity = int(new_quantity_str)
            if new_quantity < 0:
                print("数量不能为负数")
                return
            print(f"新数量: {new_quantity}")
            
            # 处理仓库和盒子变更
            new_warehouse_id = warehouse_id
            new_box_number = box_number
            
            # 检查warehouse_picker是否为数字（直接传递的仓库ID）
            if warehouse_picker is not None:
                try:
                    # 尝试将warehouse_picker转换为数字
                    new_warehouse_id = int(warehouse_picker)
                    print(f"新仓库ID (direct): {new_warehouse_id}")
                except (ValueError, TypeError):
                    # 不是数字，尝试作为选择器对象处理
                    if warehouse_picker and warehouses:
                        try:
                            selected_warehouse_index = warehouse_picker.selected_row(0)
                            if selected_warehouse_index < len(warehouses):
                                new_warehouse_id = warehouses[selected_warehouse_index][0]
                                print(f"新仓库ID (from picker): {new_warehouse_id}")
                        except Exception as e:
                            print(f"Error getting warehouse from picker: {e}")
            
            # 检查box_picker是否为数字（直接传递的盒子编号）
            if box_picker is not None:
                try:
                    # 尝试将box_picker转换为数字
                    new_box_number = int(box_picker)
                    print(f"新盒子编号 (direct): {new_box_number}")
                except (ValueError, TypeError):
                    # 不是数字，尝试作为选择器对象处理
                    if box_picker and boxes:
                        try:
                            selected_box_index = box_picker.selected_row(0)
                            if selected_box_index < len(boxes):
                                new_box_number = boxes[selected_box_index][0]
                                print(f"新盒子编号 (from picker): {new_box_number}")
                        except Exception as e:
                            print(f"Error getting box from picker: {e}")
            
            # 注意：当使用按钮选择时，我们需要从其他方式获取选中的仓库和盒子
            # 这里我们假设调用者已经通过其他方式设置了正确的 warehouses 和 boxes 参数
            print(f"最终仓库ID: {new_warehouse_id}")
            print(f"最终盒子编号: {new_box_number}")
            
            # 连接数据库
            conn = self.partwall._get_connection()
            cursor = conn.cursor()
            
            # 查找旧盒子ID
            print(f"查找旧盒子: warehouse_id={warehouse_id}, box_number={box_number}")
            cursor.execute(
                'SELECT id FROM boxes WHERE warehouse_id = ? AND box_number = ?',
                (warehouse_id, box_number)
            )
            old_box = cursor.fetchone()
            if not old_box:
                print(f"未找到仓库 {warehouse_id} 中的盒子 {box_number}")
                conn.close()
                return
            old_box_id = old_box[0]
            print(f"旧盒子ID: {old_box_id}")
            
            # 查找新盒子ID
            print(f"查找新盒子: new_warehouse_id={new_warehouse_id}, new_box_number={new_box_number}")
            cursor.execute(
                'SELECT id FROM boxes WHERE warehouse_id = ? AND box_number = ?',
                (new_warehouse_id, new_box_number)
            )
            new_box = cursor.fetchone()
            if not new_box:
                print(f"未找到仓库 {new_warehouse_id} 中的盒子 {new_box_number}")
                conn.close()
                return
            new_box_id = new_box[0]
            print(f"新盒子ID: {new_box_id}")
            
            # 检查parts表结构，确定使用color还是color_id字段
            use_color_field = False
            try:
                # 尝试使用color_id字段
                cursor.execute('''
                    SELECT color_id FROM parts WHERE box_id = ? AND part_num = ?
                ''', (old_box_id, part_num))
                print("使用color_id字段")
            except sqlite3.OperationalError:
                # 如果出错，说明表结构是旧的，使用color字段
                use_color_field = True
                print("使用color字段")
            
            # 先删除旧记录
            print(f"删除旧记录: old_box_id={old_box_id}, part_num={part_num}, processed_old_color_id={processed_old_color_id}")
            if use_color_field:
                # 使用旧的color字段
                cursor.execute(
                    'DELETE FROM parts WHERE box_id = ? AND part_num = ? AND color = ?',
                    (old_box_id, part_num, str(processed_old_color_id))
                )
            else:
                # 使用新的color_id字段
                cursor.execute(
                    'DELETE FROM parts WHERE box_id = ? AND part_num = ? AND color_id = ?',
                    (old_box_id, part_num, processed_old_color_id)
                )
            deleted_rows = cursor.rowcount
            print(f"删除了 {deleted_rows} 行")
            
            # 插入新记录
            print(f"插入新记录: new_box_id={new_box_id}, part_num={part_num}, new_color_id={new_color_id}, new_quantity={new_quantity}")
            try:
                if use_color_field:
                    # 使用旧的color字段
                    cursor.execute(
                        'INSERT OR REPLACE INTO parts (box_id, part_num, color, quantity) VALUES (?, ?, ?, ?)',
                        (new_box_id, part_num, str(new_color_id), new_quantity)
                    )
                else:
                    # 使用新的color_id字段
                    cursor.execute(
                        'INSERT OR REPLACE INTO parts (box_id, part_num, color_id, quantity) VALUES (?, ?, ?, ?)',
                        (new_box_id, part_num, new_color_id, new_quantity)
                    )
                inserted_rows = cursor.rowcount
                print(f"插入了 {inserted_rows} 行")
            except Exception as e:
                print(f"更新零件失败: {e}")
                conn.rollback()
                conn.close()
                return
            
            conn.commit()
            conn.close()
            
            print(f"零件 {part_num} 已更新")
        except Exception as e:
            print(f"Error in save_part_edit: {e}")
        finally:
            # 无论成功失败都返回零件管理页面
            # 如果位置变更了，返回到新的位置
            try:
                if 'new_warehouse_id' in locals() and 'new_box_number' in locals():
                    self.show_part_view(new_warehouse_id, new_box_number)
                else:
                    self.show_part_view(warehouse_id, box_number)
            except Exception as e:
                print(f"Error in finally block: {e}")
                # 确保即使在finally块中出错也能返回
                self.show_part_view(warehouse_id, box_number)
    
    def show_part_detail_view(self, warehouse_id, box_number, part_num, color_id):
        """显示零件管理详情页面"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建零件管理详情内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 退回上一级按钮（右上角）
            back_button = ui.Button()
            back_button.title = "退回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width - 120, 20, 100, 40)
            back_button.action = lambda sender: self.show_part_view(warehouse_id, box_number)
            content_view.add_subview(back_button)
            
            # 中央显示零件信息
            center_title = ui.Label()
            center_title.text = f"零件管理 - {part_num} (颜色ID: {color_id})"
            center_title.font = ("Arial", 24)
            center_title.text_color = "#2c3e50"
            center_title.alignment = ui.ALIGN_CENTER
            center_title.frame = (0, 80, screen_width, 50)
            content_view.add_subview(center_title)
            
            # 数量修改部分
            quantity_label = ui.Label()
            quantity_label.text = "数量修改:"
            quantity_label.font = ("Arial", 16)
            quantity_label.text_color = "#34495e"
            quantity_label.frame = (40, 160, 100, 30)
            content_view.add_subview(quantity_label)
            
            # 数量输入框
            quantity_input = ui.TextField()
            quantity_input.placeholder = "输入数值（正增加，负减少）"
            quantity_input.keyboard_type = ui.KEYBOARD_NUMBER_PAD
            quantity_input.frame = (150, 160, 200, 36)
            quantity_input.border_width = 1
            quantity_input.border_color = "#ddd"
            quantity_input.corner_radius = 4
            content_view.add_subview(quantity_input)
            
            # 应用数量按钮
            apply_quantity_button = ui.Button()
            apply_quantity_button.title = "应用数量"
            apply_quantity_button.background_color = "#3498db"
            apply_quantity_button.tint_color = "white"
            apply_quantity_button.corner_radius = 8
            apply_quantity_button.frame = (370, 160, 120, 36)
            apply_quantity_button.action = lambda sender: self.update_part_quantity_action(warehouse_id, box_number, part_num, color_id, quantity_input.text)
            content_view.add_subview(apply_quantity_button)
            
            # 盒子位置修改部分
            box_label = ui.Label()
            box_label.text = "更改盒子:"
            box_label.font = ("Arial", 16)
            box_label.text_color = "#34495e"
            box_label.frame = (40, 220, 100, 30)
            content_view.add_subview(box_label)
            
            # 仓库选择
            warehouse_label = ui.Label()
            warehouse_label.text = "选择仓库:"
            warehouse_label.font = ("Arial", 14)
            warehouse_label.text_color = "#34495e"
            warehouse_label.frame = (150, 220, 100, 30)
            content_view.add_subview(warehouse_label)
            
            # 获取所有仓库
            warehouses = self.partwall.list_warehouses()
            warehouse_names = [w[1] for w in warehouses]
            
            # 仓库选择器
            warehouse_picker = ui.PickerView()
            warehouse_picker.frame = (250, 220, 300, 100)
            warehouse_picker.data_source = WarehousePickerDataSource(warehouses)
            warehouse_picker.delegate = WarehousePickerDelegate(warehouses)
            content_view.add_subview(warehouse_picker)
            
            # 盒子选择
            box_number_label = ui.Label()
            box_number_label.text = "盒子编号:"
            box_number_label.font = ("Arial", 14)
            box_number_label.text_color = "#34495e"
            box_number_label.frame = (150, 340, 100, 30)
            content_view.add_subview(box_number_label)
            
            box_number_input = ui.TextField()
            box_number_input.placeholder = "输入新盒子编号"
            box_number_input.keyboard_type = ui.KEYBOARD_NUMBER_PAD
            box_number_input.frame = (250, 340, 200, 36)
            box_number_input.border_width = 1
            box_number_input.border_color = "#ddd"
            box_number_input.corner_radius = 4
            content_view.add_subview(box_number_input)
            
            # 应用盒子位置按钮
            apply_box_button = ui.Button()
            apply_box_button.title = "应用盒子位置"
            apply_box_button.background_color = "#3498db"
            apply_box_button.tint_color = "white"
            apply_box_button.corner_radius = 8
            apply_box_button.frame = (150, 400, 200, 40)
            apply_box_button.action = lambda sender: self.update_part_location_action(warehouse_id, box_number, part_num, color_id, warehouse_picker.selected_row(0), box_number_input.text)
            content_view.add_subview(apply_box_button)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Part detail view content updated successfully")
        except Exception as e:
            print(f"Error in show_part_detail_view: {e}")
    
    def update_part_quantity_action(self, warehouse_id, box_number, part_num, color_id, quantity_str):
        """更新零件数量"""
        try:
            if quantity_str:
                try:
                    quantity_change = int(quantity_str)
                    # 获取当前数量
                    conn = self.partwall._get_connection()
                    cursor = conn.cursor()
                    
                    # 查找盒子ID
                    cursor.execute(
                        'SELECT id FROM boxes WHERE warehouse_id = ? AND box_number = ?',
                        (warehouse_id, box_number)
                    )
                    box = cursor.fetchone()
                    if not box:
                        print(f"未找到仓库 {warehouse_id} 中的盒子 {box_number}")
                        conn.close()
                        return
                    box_id = box[0]
                    
                    # 获取当前数量
                    cursor.execute(
                        'SELECT quantity FROM parts WHERE box_id = ? AND part_num = ? AND color_id = ?',
                        (box_id, part_num, color_id)
                    )
                    current = cursor.fetchone()
                    conn.close()
                    
                    if current:
                        new_quantity = current[0] + quantity_change
                        if new_quantity < 0:
                            new_quantity = 0
                        # 更新数量
                        self.partwall.add_part(warehouse_id, box_number, part_num, color_id, None, None, quantity_change)
                except ValueError:
                    print("请输入有效的数字")
            # 返回到零件管理页面
            self.show_part_view(warehouse_id, box_number)
        except Exception as e:
            print(f"Error in update_part_quantity_action: {e}")
    
    def update_part_location_action(self, warehouse_id, box_number, part_num, color_id, new_warehouse_row, new_box_number_str):
        """更新零件位置"""
        try:
            if new_box_number_str:
                try:
                    new_box_number = int(new_box_number_str)
                    # 获取新仓库ID
                    warehouses = self.partwall.list_warehouses()
                    if 0 <= new_warehouse_row < len(warehouses):
                        new_warehouse_id = warehouses[new_warehouse_row][0]
                        
                        # 获取当前数量
                        conn = self.partwall._get_connection()
                        cursor = conn.cursor()
                        
                        # 查找当前盒子ID
                        cursor.execute(
                            'SELECT id FROM boxes WHERE warehouse_id = ? AND box_number = ?',
                            (warehouse_id, box_number)
                        )
                        current_box = cursor.fetchone()
                        if not current_box:
                            print(f"未找到仓库 {warehouse_id} 中的盒子 {box_number}")
                            conn.close()
                            return
                        current_box_id = current_box[0]
                        
                        # 获取当前数量
                        cursor.execute(
                            'SELECT quantity FROM parts WHERE box_id = ? AND part_num = ? AND color_id = ?',
                            (current_box_id, part_num, color_id)
                        )
                        current = cursor.fetchone()
                        conn.close()
                        
                        if current:
                            quantity = current[0]
                            # 删除原零件
                            # 这里需要先实现删除功能，暂时使用添加负数来减少
                            self.partwall.add_part(warehouse_id, box_number, part_num, color_id, None, None, -quantity)
                            # 在新位置添加零件
                            self.partwall.add_part(new_warehouse_id, new_box_number, part_num, color_id, None, None, quantity)
                except ValueError:
                    print("请输入有效的盒子编号")
            # 返回到零件管理页面
            self.show_part_view(warehouse_id, box_number)
        except Exception as e:
            print(f"Error in update_part_location_action: {e}")
    
    def show_add_part_view(self, warehouse_id, box_number):
        """显示添加零件视图"""
        try:
            print("show_add_part_view called!")
            # 确保ui模块被导入
            import ui
            # 获取屏幕尺寸
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            print(f"Screen size: {screen_width}x{screen_height}")
            
            # 移除当前内容视图（如果存在）
            if hasattr(self, 'current_content_view') and self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except Exception as e:
                    print(f"Error removing current content view: {e}")
                    pass
            
            # 创建添加零件内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 标题
            title = ui.Label()
            title.text = "添加零件"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.frame = (20, 20, screen_width - 40, 30)
            content_view.add_subview(title)
            
            # 型号输入
            part_num_label = ui.Label()
            part_num_label.text = "零件型号:"
            part_num_label.font = ("Arial", 16)
            part_num_label.text_color = "#34495e"
            part_num_label.frame = (40, 60, 100, 30)
            content_view.add_subview(part_num_label)
            
            part_num_input = ui.TextField()
            part_num_input.placeholder = "请输入零件型号"
            part_num_input.frame = (150, 60, screen_width - 190, 36)
            part_num_input.border_width = 1
            part_num_input.border_color = "#ddd"
            part_num_input.corner_radius = 4
            content_view.add_subview(part_num_input)
            
            # 颜色ID输入
            color_id_label = ui.Label()
            color_id_label.text = "颜色ID:"
            color_id_label.font = ("Arial", 16)
            color_id_label.text_color = "#34495e"
            color_id_label.frame = (40, 105, 100, 30)
            content_view.add_subview(color_id_label)
            
            color_id_input = ui.TextField()
            color_id_input.placeholder = "请输入颜色名称或ID"
            color_id_input.frame = (150, 105, screen_width - 290, 36)
            color_id_input.border_width = 1
            color_id_input.border_color = "#ddd"
            color_id_input.corner_radius = 4
            content_view.add_subview(color_id_input)
            
            # 颜色选择按钮
            color_select_button = ui.Button()
            color_select_button.title = "颜色选择"
            color_select_button.background_color = "#3498db"
            color_select_button.tint_color = "white"
            color_select_button.corner_radius = 4
            color_select_button.frame = (screen_width - 120, 105, 100, 36)
            color_select_button.user_interaction_enabled = True  # 确保按钮可交互
            # 添加详细的调试信息
            def color_select_action(sender):
                try:
                    self.show_color_selection_view(color_id_input)
                except Exception as e:
                    pass
            color_select_button.action = color_select_action
            # 直接添加按钮，不使用bring_subview_to_front
            content_view.add_subview(color_select_button)
            
            # 数量输入
            quantity_label = ui.Label()
            quantity_label.text = "零件数量:"
            quantity_label.font = ("Arial", 16)
            quantity_label.text_color = "#34495e"
            quantity_label.frame = (40, 150, 100, 30)
            content_view.add_subview(quantity_label)
            
            quantity_input = ui.TextField()
            quantity_input.placeholder = "请输入零件数量"
            quantity_input.keyboard_type = ui.KEYBOARD_NUMBER_PAD
            quantity_input.frame = (150, 150, screen_width - 190, 36)
            quantity_input.border_width = 1
            quantity_input.border_color = "#ddd"
            quantity_input.corner_radius = 4
            content_view.add_subview(quantity_input)
            
            # 称重反算数量选项
            weight_calc_label = ui.Label()
            weight_calc_label.text = "通过称重计算:"
            weight_calc_label.font = ("Arial", 16)
            weight_calc_label.text_color = "#34495e"
            weight_calc_label.frame = (40, 195, 120, 30)
            content_view.add_subview(weight_calc_label)
            
            # 重量输入
            weight_input = ui.TextField()
            weight_input.placeholder = "请输入总重量（克）"
            weight_input.keyboard_type = ui.KEYBOARD_NUMBER_PAD
            weight_input.frame = (160, 195, 150, 36)
            weight_input.border_width = 1
            weight_input.border_color = "#ddd"
            weight_input.corner_radius = 4
            content_view.add_subview(weight_input)
            
            # 零件重量显示
            part_weight_label = ui.Label()
            part_weight_label.text = "零件重量: 未知"
            part_weight_label.font = ("Arial", 14)
            part_weight_label.text_color = "#7f8c8d"
            part_weight_label.frame = (320, 195, screen_width - 360, 36)
            part_weight_label.border_width = 1
            part_weight_label.border_color = "#ddd"
            part_weight_label.corner_radius = 4
            part_weight_label.text_alignment = ui.ALIGN_CENTER
            content_view.add_subview(part_weight_label)
            
            # 获取零件重量按钮
            get_weight_button = ui.Button()
            get_weight_button.title = "获取重量"
            get_weight_button.background_color = "#3498db"
            get_weight_button.tint_color = "white"
            get_weight_button.corner_radius = 4
            get_weight_button.frame = (screen_width - 120, 195, 100, 36)
            
            def get_weight_action(sender):
                try:
                    part_num = part_num_input.text.strip()
                    if not part_num:
                        part_weight_label.text = "请输入零件型号"
                        return
                    
                    # 清理零件型号，确保使用准确的型号
                    # 移除可能的多余字符，只保留字母和数字
                    clean_part_num = ''.join(c for c in part_num if c.isalnum())
                    
                    # 显示正在使用的型号，让用户确认
                    part_weight_label.text = f"获取中... (型号: {clean_part_num})"
                    
                    # 从Bricklink.com获取零件重量的逻辑
                    import time
                    import requests
                    
                    # 实现基于网页抓取的Bricklink零件重量获取
                    def get_bricklink_part_weight(part_number):
                        """从Bricklink网页抓取零件真实重量"""
                        try:
                            import re
                            # 使用Bricklink的商品页面URL
                            url = f"https://www.bricklink.com/v2/catalog/catalogitem.page?P={part_number}"
                            
                            # 设置请求头，模拟浏览器请求
                            headers = {
                                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
                                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                                "Accept-Language": "en-US,en;q=0.5",
                                "Connection": "keep-alive"
                            }
                            
                            # 发送请求
                            response = requests.get(url, headers=headers, timeout=15)
                            
                            # 检查响应状态
                            if response.status_code == 200:
                                # 解析HTML内容
                                from bs4 import BeautifulSoup
                                soup = BeautifulSoup(response.content, 'html.parser')
                                
                                # 查找重量信息
                                # Bricklink页面的重量信息通常在规格部分
                                weight_elements = soup.find_all(['div', 'span'], string=lambda string: string and 'Weight' in string)
                                
                                for element in weight_elements:
                                    # 获取包含重量的父元素或兄弟元素
                                    parent = element.parent
                                    if parent:
                                        # 查找包含数字的文本
                                        weight_match = re.search(r'(\d+\.\d+)\s*g', parent.text)
                                        if weight_match:
                                            weight = float(weight_match.group(1))
                                            if weight > 0:
                                                return round(weight, 1)
                                
                                # 尝试其他可能的重量信息位置
                                all_text = soup.get_text()
                                weight_match = re.search(r'Weight:\s*(\d+\.\d+)\s*g', all_text)
                                if weight_match:
                                    weight = float(weight_match.group(1))
                                    if weight > 0:
                                        return round(weight, 1)
                            elif response.status_code == 404:
                                # 零件未找到
                                return None
                            else:
                                # 其他错误
                                print(f"Bricklink网页错误: {response.status_code}")
                                return None
                        except Exception as e:
                            print(f"Bricklink网页抓取失败: {e}")
                            # 移除了内置的重量估算数据库，直接返回None
                        
                        # 如果所有方法都失败，返回None
                        return None
                    
                    # 调用函数获取重量
                    weight = get_bricklink_part_weight(clean_part_num)
                    
                    if weight is not None:
                        part_weight_label.text = f"零件重量: {weight}g (型号: {clean_part_num})"
                    else:
                        part_weight_label.text = f"未找到重量数据 (型号: {clean_part_num})"
                        
                except Exception as e:
                    part_weight_label.text = "获取失败"
                    print(f"Error getting part weight: {e}")
            
            get_weight_button.action = get_weight_action
            content_view.add_subview(get_weight_button)
            
            # 计算数量按钮
            calculate_button = ui.Button()
            calculate_button.title = "计算数量"
            calculate_button.background_color = "#27ae60"
            calculate_button.tint_color = "white"
            calculate_button.corner_radius = 4
            calculate_button.frame = (160, 240, 120, 36)
            
            def calculate_quantity_action(sender):
                try:
                    total_weight = weight_input.text.strip()
                    part_weight_text = part_weight_label.text
                    
                    if not total_weight:
                        # 显示错误提示
                        error_label = ui.Label()
                        error_label.text = "请输入总重量"
                        error_label.font = ("Arial", 14)
                        error_label.text_color = "#e74c3c"
                        error_label.alignment = ui.ALIGN_CENTER
                        error_label.frame = (160, 280, 120, 20)
                        content_view.add_subview(error_label)
                        # 2秒后移除错误提示
                        import time
                        def remove_error_label():
                            try:
                                error_label.remove_from_superview()
                            except:
                                pass
                        time.sleep(2)
                        remove_error_label()
                        return
                    
                    # 提取零件重量
                    if "零件重量: " in part_weight_text and "g" in part_weight_text:
                        # 提取重量值，忽略型号信息
                        weight_str = part_weight_text.split('g')[0].replace('零件重量: ', '').strip()
                        # 移除可能的括号和其他字符
                        weight_str = weight_str.split('(')[0].strip()
                        
                        if weight_str and weight_str != "未知":
                            try:
                                total_weight_val = float(total_weight)
                                part_weight_val = float(weight_str)
                                
                                if part_weight_val > 0:
                                    # 计算数量
                                    quantity = int(total_weight_val / part_weight_val)
                                    quantity_input.text = str(quantity)
                                    
                                    # 显示计算结果和过程
                                    result_label = ui.Label()
                                    result_label.text = f"计算完成: {total_weight}g ÷ {part_weight_val}g = {quantity}个"
                                    result_label.font = ("Arial", 14)
                                    result_label.text_color = "#27ae60"
                                    result_label.alignment = ui.ALIGN_CENTER
                                    result_label.frame = (160, 280, 200, 20)
                                    content_view.add_subview(result_label)
                                    # 2秒后移除结果提示
                                    import time
                                    def remove_result_label():
                                        try:
                                            result_label.remove_from_superview()
                                        except:
                                            pass
                                    time.sleep(2)
                                    remove_result_label()
                                else:
                                    # 显示错误提示
                                    error_label = ui.Label()
                                    error_label.text = "零件重量必须大于0"
                                    error_label.font = ("Arial", 14)
                                    error_label.text_color = "#e74c3c"
                                    error_label.alignment = ui.ALIGN_CENTER
                                    error_label.frame = (160, 280, 150, 20)
                                    content_view.add_subview(error_label)
                                    # 2秒后移除错误提示
                                    import time
                                    def remove_error_label():
                                        try:
                                            error_label.remove_from_superview()
                                        except:
                                            pass
                                    time.sleep(2)
                                    remove_error_label()
                            except ValueError:
                                # 显示错误提示
                                error_label = ui.Label()
                                error_label.text = "请输入有效的数字"
                                error_label.font = ("Arial", 14)
                                error_label.text_color = "#e74c3c"
                                error_label.alignment = ui.ALIGN_CENTER
                                error_label.frame = (160, 280, 150, 20)
                                content_view.add_subview(error_label)
                                # 2秒后移除错误提示
                                import time
                                def remove_error_label():
                                    try:
                                        error_label.remove_from_superview()
                                    except:
                                        pass
                                time.sleep(2)
                                remove_error_label()
                    else:
                        # 显示错误提示
                        error_label = ui.Label()
                        error_label.text = "请先获取零件重量"
                        error_label.font = ("Arial", 14)
                        error_label.text_color = "#e74c3c"
                        error_label.alignment = ui.ALIGN_CENTER
                        error_label.frame = (160, 280, 150, 20)
                        content_view.add_subview(error_label)
                        # 2秒后移除错误提示
                        import time
                        def remove_error_label():
                            try:
                                error_label.remove_from_superview()
                            except:
                                pass
                        time.sleep(2)
                        remove_error_label()
                except Exception as e:
                    print(f"Error calculating quantity: {e}")
                    # 显示错误提示
                    error_label = ui.Label()
                    error_label.text = "计算错误"
                    error_label.font = ("Arial", 14)
                    error_label.text_color = "#e74c3c"
                    error_label.alignment = ui.ALIGN_CENTER
                    error_label.frame = (160, 280, 120, 20)
                    content_view.add_subview(error_label)
                    # 2秒后移除错误提示
                    import time
                    def remove_error_label():
                        try:
                            error_label.remove_from_superview()
                        except:
                            pass
                    time.sleep(2)
                    remove_error_label()
            
            calculate_button.action = calculate_quantity_action
            content_view.add_subview(calculate_button)
            
            # 按钮
            cancel_button = ui.Button()
            cancel_button.title = "取消"
            cancel_button.background_color = "#95a5a6"
            cancel_button.tint_color = "white"
            cancel_button.corner_radius = 8
            cancel_button.frame = (40, 290, 100, 40)
            cancel_button.action = lambda sender: self.show_part_view(warehouse_id, box_number)
            content_view.add_subview(cancel_button)
            
            save_button = ui.Button()
            save_button.title = "保存"
            save_button.background_color = "#3498db"
            save_button.tint_color = "white"
            save_button.corner_radius = 8
            save_button.frame = (screen_width - 140, 290, 100, 40)
            save_button.action = lambda sender: self.save_part(warehouse_id, box_number, part_num_input.text, color_id_input.text, "", "", quantity_input.text)
            content_view.add_subview(save_button)
            
            # 添加内容视图到主视图
            if hasattr(self, 'main_view'):
                # 移除当前内容视图（如果存在）
                if hasattr(self, 'current_content_view') and self.current_content_view:
                    try:
                        self.current_content_view.remove_from_superview()
                    except Exception as e:
                        print(f"Error removing current content view: {e}")
                        pass
                
                # 添加新的内容视图
                self.main_view.add_subview(content_view)
                
                # 确保内容视图在最前面
                content_view.bring_to_front()
                
                # 保存当前内容视图
                self.current_content_view = content_view
                
                print("Add part view content updated successfully")
            else:
                print("Error: main_view attribute not found")
        except Exception as e:
            print(f"Error in show_add_part_view: {e}")
    
    def save_part(self, warehouse_id, box_number, part_num, color_input, part_cat_id, img_url, quantity):
        """保存零件"""
        try:
            if part_num and color_input and quantity:
                try:
                    qty = int(quantity)
                    part_cat_id_val = int(part_cat_id) if part_cat_id.strip() else None
                    img_url_val = img_url.strip() if img_url else None
                    self.partwall.add_part(warehouse_id, box_number, part_num, color_input, part_cat_id_val, img_url_val, qty)
                except ValueError:
                    # 显示错误提示
                    pass
            self.show_part_view(warehouse_id, box_number)
        except Exception as e:
            print(f"Error in save_part: {e}")
    
    def show_search_view(self, part_number=None):
        """显示零件搜索视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建零件搜索内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 标题
            title = ui.Label()
            title.text = "零件搜索"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.frame = (20, 20, screen_width - 40, 30)
            content_view.add_subview(title)
            
            # 返回按钮（右上角，与标题底部平齐）
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width - 100, 10, 80, 40)
            back_button.action = lambda sender: self.show_main_view()
            content_view.add_subview(back_button)
            
            # 型号输入
            part_num_label = ui.Label()
            part_num_label.text = "零件型号:"
            part_num_label.font = ("Arial", 16)
            part_num_label.text_color = "#34495e"
            part_num_label.frame = (40, 120, 100, 30)
            content_view.add_subview(part_num_label)
            
            # 输入框和搜索按钮在同一行
            input_container = ui.View()
            input_container.frame = (150, 120, screen_width - 190, 36)
            content_view.add_subview(input_container)
            
            part_num_input = ui.TextField()
            part_num_input.placeholder = "请输入零件型号"
            if part_number:
                part_num_input.text = part_number
            part_num_input.frame = (0, 0, input_container.width - 80, 36)
            part_num_input.border_width = 1
            part_num_input.border_color = "#ddd"
            part_num_input.corner_radius = 4
            input_container.add_subview(part_num_input)
            
            # 搜索按钮（输入栏右边）
            search_button = ui.Button()
            search_button.title = "搜索"
            search_button.background_color = "#27ae60"
            search_button.tint_color = "white"
            search_button.corner_radius = 4
            search_button.frame = (input_container.width - 70, 0, 70, 36)
            # 使用局部函数避免闭包变量捕获问题
            def search_action(sender):
                try:
                    # 直接引用当前的输入框和内容视图
                    search_text = part_num_input.text
                    print(f"Search button clicked, searching for: {search_text}")
                    self.perform_search(search_text, content_view)
                except Exception as e:
                    print(f"Error in search action: {e}")
            search_button.action = search_action
            input_container.add_subview(search_button)
            
            # 如果提供了part_number，自动执行搜索
            if part_number:
                self.perform_search(part_number, content_view)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Search view content updated successfully")
        except Exception as e:
            print(f"Error in show_search_view: {e}")
    
    def show_settings_view(self):
        """显示系统设置页面"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建系统设置内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 返回按钮（右上角）
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width - 120, 20, 100, 40)
            back_button.action = lambda sender: self.show_main_view()
            content_view.add_subview(back_button)
            
            # 标题
            title = ui.Label()
            title.text = "系统设置"
            title.font = ("Arial", 24)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (0, 80, screen_width, 50)
            content_view.add_subview(title)
            
            # 管理仓库按钮
            manage_warehouse_button = ui.Button()
            manage_warehouse_button.title = "管理仓库"
            manage_warehouse_button.background_color = "#3498db"
            manage_warehouse_button.tint_color = "white"
            manage_warehouse_button.corner_radius = 8
            manage_warehouse_button.frame = ((screen_width - 200) / 2, 200, 200, 60)
            manage_warehouse_button.action = lambda sender: self.show_system_warehouse_manage_view()
            content_view.add_subview(manage_warehouse_button)
            
            # 管理盒子按钮
            manage_box_button = ui.Button()
            manage_box_button.title = "管理盒子"
            manage_box_button.background_color = "#27ae60"
            manage_box_button.tint_color = "white"
            manage_box_button.corner_radius = 8
            manage_box_button.frame = ((screen_width - 200) / 2, 280, 200, 60)
            manage_box_button.action = lambda sender: self.show_system_box_manage_view()
            content_view.add_subview(manage_box_button)
            
            # 初始化数据库按钮
            init_button = ui.Button()
            init_button.title = "初始化数据库"
            init_button.background_color = "#e74c3c"
            init_button.tint_color = "white"
            init_button.corner_radius = 8
            init_button.frame = ((screen_width - 200) / 2, 360, 200, 60)
            init_button.action = lambda sender: self.show_init_database_view()
            content_view.add_subview(init_button)
            
            # 导入颜色按钮
            import_colors_button = ui.Button()
            import_colors_button.title = "导入颜色"
            import_colors_button.background_color = "#9b59b6"
            import_colors_button.tint_color = "white"
            import_colors_button.corner_radius = 8
            import_colors_button.frame = ((screen_width - 200) / 2, 440, 200, 60)
            import_colors_button.action = lambda sender: self.import_colors()
            content_view.add_subview(import_colors_button)
            
            # 零件颜色调整按钮
            adjust_colors_button = ui.Button()
            adjust_colors_button.title = "零件颜色调整"
            adjust_colors_button.background_color = "#e67e22"
            adjust_colors_button.tint_color = "white"
            adjust_colors_button.corner_radius = 8
            adjust_colors_button.frame = ((screen_width - 200) / 2, 520, 200, 60)
            adjust_colors_button.action = lambda sender: self.adjust_part_colors()
            content_view.add_subview(adjust_colors_button)
            
            # 显示所有颜色按钮
            show_colors_button = ui.Button()
            show_colors_button.title = "显示所有颜色"
            show_colors_button.background_color = "#1abc9c"
            show_colors_button.tint_color = "white"
            show_colors_button.corner_radius = 8
            show_colors_button.frame = ((screen_width - 200) / 2, 600, 200, 60)
            show_colors_button.action = lambda sender: self.show_all_colors()
            content_view.add_subview(show_colors_button)
            
            # 导入inventory_parts.csv按钮
            import_inventory_button = ui.Button()
            import_inventory_button.title = "导入零件数据"
            import_inventory_button.background_color = "#3498db"
            import_inventory_button.tint_color = "white"
            import_inventory_button.corner_radius = 8
            import_inventory_button.frame = ((screen_width - 200) / 2, 680, 200, 60)
            import_inventory_button.action = lambda sender: self.import_inventory_parts()
            content_view.add_subview(import_inventory_button)
            
            # 导入PARTS按钮
            import_parts_button = ui.Button()
            import_parts_button.title = "导入PARTS"
            import_parts_button.background_color = "#3498db"
            import_parts_button.tint_color = "white"
            import_parts_button.corner_radius = 8
            import_parts_button.frame = ((screen_width - 200) / 2, 760, 200, 60)
            import_parts_button.action = lambda sender: self.import_parts()
            content_view.add_subview(import_parts_button)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Settings view content updated successfully")
        except Exception as e:
            print(f"Error in show_settings_view: {e}")
    
    def import_parts(self):
        """导入RB文件夹中的parts.csv到数据库的legoparts表"""
        try:
            import ui
            import os
            import csv
            import sqlite3
            
            # 获取屏幕尺寸
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建导入结果视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 返回按钮
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (20, 20, 100, 40)
            back_button.action = lambda sender: self.show_settings_view()
            content_view.add_subview(back_button)
            
            # 标题
            title = ui.Label()
            title.text = "导入PARTS结果"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (0, 60, screen_width, 30)
            content_view.add_subview(title)
            
            # 结果标签
            result_label = ui.Label()
            result_label.font = ("Arial", 16)
            result_label.text_color = "#34495e"
            result_label.alignment = ui.ALIGN_CENTER
            result_label.number_of_lines = 0
            result_label.frame = (40, 120, screen_width - 80, 200)
            content_view.add_subview(result_label)
            
            # 状态标签
            status_label = ui.Label()
            status_label.text = "正在导入..."
            status_label.font = ("Arial", 14)
            status_label.text_color = "#3498db"
            status_label.alignment = ui.ALIGN_CENTER
            status_label.frame = (40, 340, screen_width - 80, 30)
            content_view.add_subview(status_label)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            # 开始导入过程
            try:
                # 获取当前目录
                try:
                    current_dir = os.path.dirname(__file__)
                except NameError:
                    current_dir = os.getcwd()
                
                # 构建parts.csv文件路径
                csv_path = os.path.join(current_dir, 'RB', 'parts.csv')
                
                if not os.path.exists(csv_path):
                    result_label.text = f"错误: 找不到文件 {csv_path}"
                    status_label.text = "导入失败"
                    status_label.text_color = "#e74c3c"
                    return
                
                # 构建数据库路径
                db_path = os.path.join(current_dir, 'partwall.db')
                
                # 连接到数据库
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                
                # 创建legoparts表（如果不存在）
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS legoparts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        part_num TEXT NOT NULL,
                        name TEXT,
                        part_cat_id INTEGER,
                        part_material TEXT,
                        UNIQUE(part_num)
                    )
                ''')
                conn.commit()
                
                # 读取并导入CSV文件
                total_rows = 0
                imported_rows = 0
                skipped_rows = 0
                
                # 尝试不同的编码打开文件
                encodings = ['utf-8', 'utf-8-sig', 'latin-1']
                csv_reader = None
                
                for encoding in encodings:
                    try:
                        csvfile = open(csv_path, 'r', encoding=encoding)
                        csv_reader = csv.DictReader(csvfile)
                        # 测试读取一行
                        next(csv_reader)
                        csvfile.seek(0)  # 重置文件指针
                        csv_reader = csv.DictReader(csvfile)
                        result_label.text = f"使用编码 {encoding} 打开文件成功"
                        break
                    except Exception as e:
                        if csvfile:
                            csvfile.close()
                        continue
                
                if not csv_reader:
                    result_label.text = "错误: 无法打开CSV文件，编码可能不支持"
                    status_label.text = "导入失败"
                    status_label.text_color = "#e74c3c"
                    conn.close()
                    return
                
                # 遍历CSV行
                try:
                    for row in csv_reader:
                        total_rows += 1
                        
                        # 获取必要的字段
                        part_num = row.get('part_num', '').strip()
                        name = row.get('name', '').strip()
                        part_cat_id = row.get('part_cat_id', '')
                        part_material = row.get('part_material', '').strip()
                        
                        # 确保part_num不为空
                        if not part_num:
                            skipped_rows += 1
                            continue
                        
                        # 转换part_cat_id为整数
                        try:
                            part_cat_id = int(part_cat_id) if part_cat_id else None
                        except ValueError:
                            part_cat_id = None
                        
                        # 插入或忽略（避免重复）
                        try:
                            cursor.execute('''
                                INSERT OR IGNORE INTO legoparts (part_num, name, part_cat_id, part_material)
                                VALUES (?, ?, ?, ?)
                            ''', (part_num, name, part_cat_id, part_material))
                            if cursor.rowcount > 0:
                                imported_rows += 1
                            else:
                                skipped_rows += 1
                        except sqlite3.Error as e:
                            skipped_rows += 1
                        
                        # 每1000行提交一次
                        if total_rows % 1000 == 0:
                            conn.commit()
                finally:
                    csvfile.close()
                
                # 最终提交
                conn.commit()
                conn.close()
                
                # 显示导入结果
                result_label.text = f"导入完成！\n\n总行数: {total_rows}\n导入行数: {imported_rows}\n跳过行数: {skipped_rows}\n\n跳过的行可能是重复的零件编号。"
                status_label.text = "导入成功"
                status_label.text_color = "#27ae60"
                
                # 显示前10行数据预览
                preview_label = ui.Label()
                preview_label.text = "前10行数据预览:"
                preview_label.font = ("Arial", 16)
                preview_label.text_color = "#2c3e50"
                preview_label.frame = (40, 380, screen_width - 80, 30)
                content_view.add_subview(preview_label)
                
                # 连接到数据库并获取前10行
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute('SELECT part_num, name FROM legoparts LIMIT 10')
                preview_data = cursor.fetchall()
                conn.close()
                
                # 显示预览数据
                preview_text = "\n".join([f"{row[0]}: {row[1]}" for row in preview_data])
                data_label = ui.Label()
                data_label.text = preview_text
                data_label.font = ("Arial", 14)
                data_label.text_color = "#7f8c8d"
                data_label.number_of_lines = 0
                data_label.frame = (40, 420, screen_width - 80, 200)
                content_view.add_subview(data_label)
                
            except Exception as e:
                result_label.text = f"导入失败: {str(e)}"
                status_label.text = "导入失败"
                status_label.text_color = "#e74c3c"
                
        except Exception as e:
            pass
    
    def show_init_database_view(self):
        """显示初始化数据库确认视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建初始化数据库确认内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 返回按钮
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (20, 20, 100, 40)
            back_button.action = lambda sender: self.show_settings_view()
            content_view.add_subview(back_button)
            
            # 标题
            title = ui.Label()
            title.text = "确认初始化数据库"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (20, 40, screen_width - 40, 30)
            content_view.add_subview(title)
            
            # 警告信息
            warning_label = ui.Label()
            warning_label.text = "警告: 初始化数据库将删除所有现有数据！\n\n此操作不可撤销，请谨慎操作。"
            warning_label.font = ("Arial", 16)
            warning_label.text_color = "#e74c3c"
            warning_label.alignment = ui.ALIGN_CENTER
            warning_label.number_of_lines = 0
            warning_label.frame = (40, 100, screen_width - 80, 100)
            content_view.add_subview(warning_label)
            
            # 取消按钮
            cancel_button = ui.Button()
            cancel_button.title = "取消"
            cancel_button.background_color = "#95a5a6"
            cancel_button.tint_color = "white"
            cancel_button.corner_radius = 8
            cancel_button.frame = (100, 240, 200, 50)
            cancel_button.action = lambda sender: self.show_settings_view()
            content_view.add_subview(cancel_button)
            
            # 确认按钮
            confirm_button = ui.Button()
            confirm_button.title = "确认初始化"
            confirm_button.background_color = "#e74c3c"
            confirm_button.tint_color = "white"
            confirm_button.corner_radius = 8
            confirm_button.frame = (screen_width - 300, 240, 200, 50)
            confirm_button.action = lambda sender: self.init_database()
            content_view.add_subview(confirm_button)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Init database view content updated successfully")
        except Exception as e:
            print(f"Error in show_init_database_view: {e}")
    
    def show_delete_warehouse_confirm(self, warehouse_id):
        """显示删除仓库确认视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建删除仓库确认内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 返回按钮
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (20, 20, 100, 40)
            back_button.action = lambda sender: self.show_system_warehouse_manage_view()
            content_view.add_subview(back_button)
            
            # 标题
            title = ui.Label()
            title.text = "确认删除仓库"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (20, 40, screen_width - 40, 30)
            content_view.add_subview(title)
            
            # 警告信息
            warning_label = ui.Label()
            warning_label.text = "警告: 删除仓库将同时删除仓库中的所有盒子和零件！\n\n此操作不可撤销，请谨慎操作。"
            warning_label.font = ("Arial", 16)
            warning_label.text_color = "#e74c3c"
            warning_label.alignment = ui.ALIGN_CENTER
            warning_label.number_of_lines = 0
            warning_label.frame = (40, 100, screen_width - 80, 100)
            content_view.add_subview(warning_label)
            
            # 取消按钮
            cancel_button = ui.Button()
            cancel_button.title = "取消"
            cancel_button.background_color = "#95a5a6"
            cancel_button.tint_color = "white"
            cancel_button.corner_radius = 8
            cancel_button.frame = (100, 240, 200, 50)
            cancel_button.action = lambda sender: self.show_system_warehouse_manage_view()
            content_view.add_subview(cancel_button)
            
            # 确认按钮
            confirm_button = ui.Button()
            confirm_button.title = "确认删除"
            confirm_button.background_color = "#e74c3c"
            confirm_button.tint_color = "white"
            confirm_button.corner_radius = 8
            confirm_button.frame = (screen_width - 300, 240, 200, 50)
            confirm_button.action = lambda sender: self.delete_warehouse(warehouse_id)
            content_view.add_subview(confirm_button)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Delete warehouse confirm view content updated successfully")
        except Exception as e:
            print(f"Error in show_delete_warehouse_confirm: {e}")
    
    def delete_warehouse(self, warehouse_id):
        """执行删除仓库操作"""
        try:
            success = self.partwall.delete_warehouse(warehouse_id)
            self.show_system_warehouse_manage_view()
        except Exception as e:
            print(f"Error in delete_warehouse: {e}")
    
    def show_delete_box_confirm(self, warehouse_id, box_number):
        """显示删除盒子确认视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建删除盒子确认内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 返回按钮
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (20, 20, 100, 40)
            back_button.action = lambda sender: self.show_system_box_manage_view()
            content_view.add_subview(back_button)
            
            # 标题
            title = ui.Label()
            title.text = "确认删除盒子"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (20, 40, screen_width - 40, 30)
            content_view.add_subview(title)
            
            # 警告信息
            warning_label = ui.Label()
            warning_label.text = "警告: 删除盒子将同时删除盒子中的所有零件！\n\n此操作不可撤销，请谨慎操作。"
            warning_label.font = ("Arial", 16)
            warning_label.text_color = "#e74c3c"
            warning_label.alignment = ui.ALIGN_CENTER
            warning_label.number_of_lines = 0
            warning_label.frame = (40, 100, screen_width - 80, 100)
            content_view.add_subview(warning_label)
            
            # 取消按钮
            cancel_button = ui.Button()
            cancel_button.title = "取消"
            cancel_button.background_color = "#95a5a6"
            cancel_button.tint_color = "white"
            cancel_button.corner_radius = 8
            cancel_button.frame = (100, 240, 200, 50)
            cancel_button.action = lambda sender: self.show_system_box_manage_view()
            content_view.add_subview(cancel_button)
            
            # 确认按钮
            confirm_button = ui.Button()
            confirm_button.title = "确认删除"
            confirm_button.background_color = "#e74c3c"
            confirm_button.tint_color = "white"
            confirm_button.corner_radius = 8
            confirm_button.frame = (screen_width - 300, 240, 200, 50)
            confirm_button.action = lambda sender: self.delete_box(warehouse_id, box_number)
            content_view.add_subview(confirm_button)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Delete box confirm view content updated successfully")
        except Exception as e:
            print(f"Error in show_delete_box_confirm: {e}")
    
    def delete_box(self, warehouse_id, box_number):
        """执行删除盒子操作"""
        try:
            success = self.partwall.delete_box(warehouse_id, box_number)
            self.show_system_box_manage_view()
        except Exception as e:
            print(f"Error in delete_box: {e}")
    
    def show_color_selection_view(self, color_id_input):
        """显示颜色选择页面（弹出窗口形式）"""
        try:
            # 获取屏幕尺寸
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 创建半透明背景视图
            bg_view = ui.View()
            bg_view.frame = (0, 0, screen_width, screen_height)
            bg_view.background_color = "#000000"
            bg_view.alpha = 0.5  # 半透明
            
            # 创建颜色选择内容视图（弹出窗口）
            popup_width = min(screen_width - 40, 600)  # 限制最大宽度
            popup_height = min(screen_height - 100, 600)  # 限制最大高度
            popup_x = (screen_width - popup_width) // 2
            popup_y = (screen_height - popup_height) // 2
            
            color_view = ui.View()
            color_view.frame = (popup_x, popup_y, popup_width, popup_height)
            color_view.background_color = "#f5f5f5"
            color_view.corner_radius = 12
            color_view.border_width = 2
            color_view.border_color = "#3498db"
            
            # 返回按钮（放右边）
            back_button = ui.Button()
            back_button.title = "关闭"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (popup_width - 120, 20, 100, 40)  # 放右边
            back_button.user_interaction_enabled = True  # 确保按钮可交互
            
            # 直接定义action函数，避免复杂的闭包问题
            def back_action(sender):
                # 在Pythonista中，我们可以通过修改视图的alpha值来隐藏它
                try:
                    # 尝试隐藏颜色选择视图
                    try:
                        color_view.alpha = 0.0  # 设置为完全透明
                    except Exception as e:
                        pass
                    
                    # 尝试隐藏背景视图
                    try:
                        bg_view.alpha = 0.0  # 设置为完全透明
                    except Exception as e:
                        pass
                except Exception as e:
                    pass
            
            # 设置action
            back_button.action = back_action
            
            # 将按钮添加到颜色视图
            color_view.add_subview(back_button)
            
            # 标题
            title = ui.Label()
            title.text = "颜色选择"
            title.font = ("Arial", 20)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (0, 20, popup_width, 40)
            color_view.add_subview(title)
            
            # 点选结果确认区域
            selected_color_area = ui.View()
            selected_color_area.frame = (20, 80, popup_width - 40, 60)
            selected_color_area.background_color = "#ecf0f1"
            selected_color_area.border_width = 1
            selected_color_area.border_color = "#ddd"
            selected_color_area.corner_radius = 8
            color_view.add_subview(selected_color_area)
            
            # 已选颜色标签
            selected_label = ui.Label()
            selected_label.text = "已选颜色:"
            selected_label.font = ("Arial", 14)
            selected_label.text_color = "#2c3e50"
            selected_label.frame = (10, 15, 100, 30)
            selected_color_area.add_subview(selected_label)
            
            # 颜色预览
            selected_color_preview = ui.View()
            selected_color_preview.frame = (110, 10, 40, 40)
            selected_color_preview.background_color = "#cccccc"
            selected_color_preview.border_width = 1
            selected_color_preview.border_color = "#ddd"
            selected_color_preview.corner_radius = 4
            selected_color_area.add_subview(selected_color_preview)
            
            # 颜色信息
            selected_color_info = ui.Label()
            selected_color_info.text = "未选择"
            selected_color_info.font = ("Arial", 14)
            selected_color_info.text_color = "#7f8c8d"
            selected_color_info.frame = (160, 15, popup_width - 200, 30)
            selected_color_area.add_subview(selected_color_info)
            
            # 读取所有颜色
            try:
                conn = self.partwall._get_connection()
                cursor = conn.cursor()
                cursor.execute('SELECT id, color_name, rgb FROM colors ORDER BY id')
                colors = cursor.fetchall()
                conn.close()
            except Exception as e:
                colors = []
            
            # 创建滚动视图来显示颜色色块
            scroll_view = ui.ScrollView()
            scroll_view.frame = (20, 160, popup_width - 40, popup_height - 210)
            
            # 计算每个色块的大小和位置
            spacing = 8  # 增大间距
            cols = 8  # 每行8个颜色
            
            # 根据弹出窗口宽度动态计算颜色卡片大小
            available_width = popup_width - 40  # 考虑滚动视图的边距
            max_color_size = (available_width - (cols - 1) * spacing) // cols
            color_size = min(max_color_size, 60)  # 增大最大大小
            
            total_width = (color_size + spacing) * cols - spacing
            
            # 检查是否有颜色数据
            if not colors:
                # 没有颜色数据，显示提示信息
                no_colors_label = ui.Label()
                no_colors_label.text = "没有找到颜色数据，请先导入颜色"
                no_colors_label.font = ("Arial", 16)
                no_colors_label.text_color = "#e74c3c"
                no_colors_label.alignment = ui.ALIGN_CENTER
                no_colors_label.number_of_lines = 2
                no_colors_label.frame = (0, 50, popup_width - 40, 60)
                scroll_view.add_subview(no_colors_label)
                scroll_content = ui.View()
                scroll_content.frame = (0, 0, popup_width - 40, 200)
            else:
                # 创建容器视图
                scroll_content = ui.View()
                rows = (len(colors) + cols - 1) // cols
                card_height = color_size + spacing * 6  # 与颜色卡片高度一致
                scroll_content.frame = (0, 0, popup_width - 40, rows * (card_height + spacing))
                
                # 为每个颜色创建色块
                for i, color in enumerate(colors):
                    try:
                        color_id, color_name, rgb = color
                        
                        # 计算位置
                        row = i // cols
                        col = i % cols
                        x = col * (color_size + spacing)
                        # 增加垂直间距，确保颜色名称能正确显示
                        card_height = color_size + spacing * 6
                        y = row * (card_height + spacing)
                        
                        # 调整卡片高度，以容纳颜色名称
                        card_height = color_size + spacing * 6  # 增加更多高度以确保完整显示颜色名称
                        
                        # 创建颜色块容器
                        color_container = ui.View()
                        color_container.frame = (x, y, color_size, card_height)
                        
                        # 创建颜色块（作为整个卡片的背景）
                        color_block = ui.Button()
                        color_block.frame = (0, 0, color_size, card_height)
                        color_block.background_color = "#ffffff"
                        color_block.border_width = 1
                        color_block.border_color = "#ddd"
                        color_block.corner_radius = 4
                        
                        # 创建颜色样本
                        sample_margin = 2
                        color_sample = ui.View()
                        color_sample.frame = (sample_margin, sample_margin, color_size - sample_margin * 2, color_size - sample_margin * 2)
                        color_sample.background_color = rgb if rgb else "#cccccc"
                        color_sample.corner_radius = 3
                        color_block.add_subview(color_sample)
                        
                        # 创建颜色ID标签
                        color_id_label = ui.Label()
                        color_id_label.text = f"{color_id}"
                        # 根据颜色卡片大小动态调整字体大小
                        font_size = min(8, color_size // 3)
                        color_id_label.font = ("Arial", font_size)
                        color_id_label.text_color = "#333"
                        color_id_label.alignment = ui.ALIGN_CENTER
                        color_id_label.frame = (0, color_size + 1, color_size, 12)
                        color_block.add_subview(color_id_label)
                        
                        # 创建颜色名称标签（多行显示）
                        color_name_label = ui.Label()
                        color_name_label.text = color_name
                        # 根据颜色卡片大小动态调整字体大小
                        name_font_size = min(9, color_size // 4)
                        color_name_label.font = ("Arial", name_font_size)
                        color_name_label.text_color = "#666"
                        color_name_label.alignment = ui.ALIGN_CENTER
                        color_name_label.number_of_lines = 0  # 设置为多行显示
                        color_name_label.line_break_mode = ui.LB_WORD_WRAP  # 自动换行
                        color_name_label.frame = (0, color_size + 14, color_size, 30)
                        color_block.add_subview(color_name_label)
                        
                        # 设置点击动作（使用内部函数确保变量在作用域中）
                        def create_color_action(cid, cii, cv, bgv, color_name, rgb):
                            def action(sender):
                                try:
                                    # 更新已选颜色显示
                                    selected_color_preview.background_color = rgb if rgb else "#cccccc"
                                    selected_color_info.text = f"ID: {cid}, 名称: {color_name}"
                                    selected_color_info.text_color = "#27ae60"
                                    
                                    # 选择颜色
                                    self.select_color(cid, cii, cv)
                                    print(f"颜色选择成功: ID={cid}, 名称={color_name}")
                                    
                                    # 隐藏弹出窗口（在Pythonista中使用alpha值来隐藏）
                                    try:
                                        # 尝试隐藏颜色选择视图
                                        cv.alpha = 0.0  # 设置为完全透明
                                        print("Color view hidden successfully")
                                    except Exception as e:
                                        print(f"Error hiding color view: {e}")
                                    
                                    try:
                                        # 尝试隐藏背景视图
                                        bgv.alpha = 0.0  # 设置为完全透明
                                        print("Background view hidden successfully")
                                    except Exception as e:
                                        print(f"Error hiding background view: {e}")
                                except Exception as e:
                                    print(f"选择颜色失败: {e}")
                            return action
                        color_block.action = create_color_action(color_id, color_id_input, color_view, bg_view, color_name, rgb)
                        color_container.add_subview(color_block)
                        
                        scroll_content.add_subview(color_container)
                    except Exception as e:
                        print(f"处理颜色失败: {e}")
                        continue
            
            # 设置滚动视图内容大小
            scroll_view.content_size = (popup_width - 40, scroll_content.height)
            scroll_view.add_subview(scroll_content)
            color_view.add_subview(scroll_view)
            
            # 添加到主视图
            self.main_view.add_subview(bg_view)
            self.main_view.add_subview(color_view)
            # 不要覆盖current_content_view，因为它应该保持为零件添加页面
            print("Color selection view (popup) displayed successfully")
        except Exception as e:
            print(f"Error in show_color_selection_view: {e}")
    
    def select_color(self, color_id, color_id_input, color_view):
        """选择颜色并填充到输入框"""
        try:
            color_id_input.text = str(color_id)
            print(f"Selected color ID: {color_id}")
            
            # 尝试移除颜色选择视图
            try:
                # 首先尝试通过current_content_view移除，这是最可靠的方法
                if hasattr(self, 'current_content_view') and self.current_content_view:
                    try:
                        if hasattr(self.current_content_view, 'remove_from_superview'):
                            self.current_content_view.remove_from_superview()
                            print("Removed current_content_view")
                        else:
                            # 在Pythonista中，_ui.View对象没有remove_from_superview方法
                            print("current_content_view has no remove_from_superview method, setting to None")
                            self.current_content_view = None
                    except Exception as e:
                        print(f"Error removing current_content_view: {e}")
                else:
                    # 如果current_content_view不存在，尝试使用传入的color_view
                    if color_view:
                        try:
                            if hasattr(color_view, 'remove_from_superview'):
                                color_view.remove_from_superview()
                                print("Removed color_view")
                            else:
                                # 在Pythonista中，_ui.View对象没有remove_from_superview方法
                                print("color_view has no remove_from_superview method")
                        except Exception as e:
                            print(f"Error removing color_view: {e}")
            except Exception as e:
                print(f"Error removing view: {e}")
        except Exception as e:
            print(f"Error in select_color: {e}")
            import traceback
            traceback.print_exc()
    
    def import_colors(self):
        """导入颜色数据从RB文件夹的colors.csv文档"""
        try:
            import csv
            import os
            
            # 构建RB文件夹的colors.csv路径
            try:
                # 尝试使用__file__变量
                rb_folder = os.path.join(os.path.dirname(__file__), "RB")
            except NameError:
                # 如果__file__未定义（例如在Pythonista中），使用当前工作目录
                rb_folder = os.path.join(os.getcwd(), "RB")
            colors_csv_path = os.path.join(rb_folder, "colors.csv")
            
            print(f"尝试读取颜色文件: {colors_csv_path}")
            
            # 检查文件是否存在
            if not os.path.exists(colors_csv_path):
                print(f"错误: 文件不存在 - {colors_csv_path}")
                return
            
            # 读取CSV文件
            with open(colors_csv_path, 'r', encoding='utf-8') as csvfile:
                reader = csv.reader(csvfile)
                
                # 连接数据库
                conn = self.partwall._get_connection()
                cursor = conn.cursor()
                
                # 清除colors表的数据
                try:
                    cursor.execute('DELETE FROM colors')
                    print("已清除colors表的所有数据")
                except Exception as e:
                    print(f"清除colors表数据失败: {e}")
                
                imported_count = 0
                skipped_count = 0
                
                # 读取CSV表头，确定字段对应关系
                header = next(reader)
                header = [h.strip().lower() for h in header]
                print(f"CSV表头: {header}")
                
                # 确定字段索引
                id_index = None
                name_index = None
                rgb_index = None
                
                for i, col in enumerate(header):
                    if col == 'id':
                        id_index = i
                    elif col in ['name', 'color_name']:
                        name_index = i
                    elif col in ['rgb', 'hex']:
                        rgb_index = i
                
                print(f"字段索引: id={id_index}, name={name_index}, rgb={rgb_index}")
                
                # 检查必要字段
                if name_index is None:
                    print("错误: CSV文件缺少name字段")
                    return
                
                # 处理数据行
                for i, row in enumerate(reader):
                    print(f"处理第 {i+1} 行: {row}")
                    try:
                        # 获取字段值
                        color_id = None
                        if id_index is not None and id_index < len(row):
                            color_id_str = row[id_index].strip()
                            print(f"  颜色ID字段值: '{color_id_str}'")
                            if color_id_str:
                                try:
                                    color_id = int(color_id_str)
                                    print(f"  转换后的颜色ID: {color_id}")
                                except ValueError:
                                    print(f"跳过无效的颜色ID: {color_id_str}")
                        else:
                            print(f"  没有颜色ID字段或索引超出范围")
                        
                        color_name = row[name_index].strip() if name_index < len(row) else ""
                        print(f"  颜色名称字段值: '{color_name}'")
                        if not color_name:
                            print("跳过空颜色名称")
                            skipped_count += 1
                            continue
                        
                        rgb = None
                        if rgb_index is not None and rgb_index < len(row):
                            rgb = row[rgb_index].strip()
                            print(f"  RGB字段值: '{rgb}'")
                            # 确保RGB值以#开头
                            if rgb and not rgb.startswith('#'):
                                rgb = '#' + rgb
                                print(f"  处理后的RGB值: '{rgb}'")
                        else:
                            print(f"  没有RGB字段或索引超出范围")
                        
                        # 插入或更新颜色
                        print(f"  准备插入颜色: ID={color_id}, 名称={color_name}, RGB={rgb}")
                        try:
                            if color_id:
                                # 使用颜色ID作为主键
                                cursor.execute('''
                                    INSERT OR REPLACE INTO colors (id, color_name, rgb)
                                    VALUES (?, ?, ?)
                                ''', (color_id, color_name, rgb))
                                print(f"  成功插入颜色（带ID）: {color_name}")
                            else:
                                # 没有颜色ID，使用名称
                                cursor.execute('''
                                    INSERT OR REPLACE INTO colors (color_name, rgb)
                                    VALUES (?, ?)
                                ''', (color_name, rgb))
                                print(f"  成功插入颜色（不带ID）: {color_name}")
                            imported_count += 1
                            print(f"  当前导入计数: {imported_count}")
                        except Exception as e:
                            print(f"  插入颜色失败: {e}")
                            skipped_count += 1
                        
                    except Exception as e:
                        print(f"错误导入颜色: {e}")
                        skipped_count += 1
                
                # 提交事务
                conn.commit()
                conn.close()
                
                print(f"颜色导入完成: 成功 {imported_count}, 跳过 {skipped_count}")
                
                # 显示导入结果，包括颜色色块
                self.show_imported_colors(imported_count, skipped_count)
                
        except Exception as e:
            print(f"Error in import_colors: {e}")
            
            # 显示错误信息
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            error_view = ui.View()
            error_view.frame = (0, 150, screen_width, screen_height - 150)
            error_view.background_color = "#f5f5f5"
            
            error_label = ui.Label()
            error_label.text = f"导入颜色失败: {str(e)}"
            error_label.font = ("Arial", 16)
            error_label.text_color = "#e74c3c"
            error_label.alignment = ui.ALIGN_CENTER
            error_label.number_of_lines = 0
            error_label.frame = (50, 150, screen_width - 100, 100)
            error_view.add_subview(error_label)
            
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#3498db"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width // 2 - 100, 300, 200, 40)
            back_button.action = lambda sender: self.show_settings_view()
            error_view.add_subview(back_button)
            
            if hasattr(self, 'main_view'):
                if hasattr(self, 'current_content_view') and self.current_content_view:
                    try:
                        self.current_content_view.remove_from_superview()
                    except:
                        pass
                
                self.main_view.add_subview(error_view)
                self.current_content_view = error_view

    def show_imported_colors(self, imported_count, skipped_count):
        """显示导入的颜色，包括色块"""
        try:
            import ui
            import sqlite3
            
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 创建结果视图
            result_view = ui.View()
            result_view.frame = (0, 150, screen_width, screen_height - 150)
            result_view.background_color = "#f5f5f5"
            
            # 返回按钮
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#3498db"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width - 120, 20, 100, 40)
            back_button.action = lambda sender: self.show_settings_view()
            result_view.add_subview(back_button)
            
            # 标题
            title_label = ui.Label()
            title_label.text = "颜色导入结果"
            title_label.font = ("Arial", 24)
            title_label.text_color = "#2c3e50"
            title_label.alignment = ui.ALIGN_CENTER
            title_label.frame = (0, 80, screen_width, 50)
            result_view.add_subview(title_label)
            
            # 统计信息
            stats_label = ui.Label()
            stats_label.text = f"成功导入: {imported_count} 个颜色, 跳过: {skipped_count} 个颜色"
            stats_label.font = ("Arial", 16)
            stats_label.text_color = "#27ae60"
            stats_label.alignment = ui.ALIGN_CENTER
            stats_label.frame = (0, 140, screen_width, 30)
            result_view.add_subview(stats_label)
            
            # 颜色列表标题
            colors_title = ui.Label()
            colors_title.text = "导入的颜色:"
            colors_title.font = ("Arial", 16)
            colors_title.text_color = "#34495e"
            colors_title.frame = (40, 190, screen_width - 80, 30)
            result_view.add_subview(colors_title)
            
            # 查询数据库中的所有颜色
            conn = self.partwall._get_connection()
            cursor = conn.cursor()
            
            # 尝试不同的颜色表结构
            colors = []
            try:
                # 尝试使用color_name字段
                cursor.execute('SELECT id, color_name, rgb FROM colors ORDER BY id')
                colors = cursor.fetchall()
            except sqlite3.OperationalError:
                try:
                    # 尝试使用name字段
                    cursor.execute('SELECT id, name, rgb FROM colors ORDER BY id')
                    colors = cursor.fetchall()
                except Exception as e:
                    print(f"查询颜色失败: {e}")
            
            conn.close()
            
            if colors:
                # 创建滚动视图来容纳颜色列表
                scroll_view = ui.ScrollView()
                scroll_view.frame = (20, 230, screen_width - 40, screen_height - 280)
                scroll_view.content_size = (screen_width - 40, 100 + len(colors) * 60)
                scroll_view.shows_horizontal_scroll_indicator = False
                
                # 创建颜色项
                for i, color in enumerate(colors):
                    color_id = color[0]
                    color_name = color[1]
                    rgb = color[2]
                    
                    # 创建颜色项视图
                    color_item = ui.View()
                    color_item.frame = (20, 20 + i * 60, screen_width - 80, 50)
                    color_item.background_color = "#ffffff"
                    color_item.border_width = 1
                    color_item.border_color = "#ddd"
                    color_item.corner_radius = 8
                    
                    # 创建色块
                    color_block = ui.View()
                    color_block.frame = (10, 10, 30, 30)
                    color_block.corner_radius = 4
                    
                    # 设置色块颜色
                    if rgb and rgb.startswith('#'):
                        try:
                            color_block.background_color = rgb
                        except:
                            color_block.background_color = "#95a5a6"  # 默认灰色
                    else:
                        color_block.background_color = "#95a5a6"  # 默认灰色
                    
                    color_item.add_subview(color_block)
                    
                    # 颜色信息
                    color_info = ui.Label()
                    color_info.text = f"ID: {color_id}, 名称: {color_name}, RGB: {rgb or '无'}"
                    color_info.font = ("Arial", 14)
                    color_info.text_color = "#2c3e50"
                    color_info.frame = (50, 10, screen_width - 140, 30)
                    color_info.number_of_lines = 1
                    color_item.add_subview(color_info)
                    
                    scroll_view.add_subview(color_item)
                
                result_view.add_subview(scroll_view)
            else:
                # 没有颜色的提示
                no_colors_label = ui.Label()
                no_colors_label.text = "没有找到颜色数据"
                no_colors_label.font = ("Arial", 14)
                no_colors_label.text_color = "#7f8c8d"
                no_colors_label.alignment = ui.ALIGN_CENTER
                no_colors_label.frame = (40, 230, screen_width - 80, 30)
                result_view.add_subview(no_colors_label)
            
            # 添加结果视图到主视图
            if hasattr(self, 'main_view'):
                if hasattr(self, 'current_content_view') and self.current_content_view:
                    try:
                        self.current_content_view.remove_from_superview()
                    except:
                        pass
                
                self.main_view.add_subview(result_view)
                self.current_content_view = result_view
                print("Imported colors view added")
                
        except Exception as e:
            print(f"Error in show_imported_colors: {e}")
            
            # 显示错误信息
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            error_view = ui.View()
            error_view.frame = (0, 150, screen_width, screen_height - 150)
            error_view.background_color = "#f5f5f5"
            
            error_label = ui.Label()
            error_label.text = f"显示颜色失败: {str(e)}"
            error_label.font = ("Arial", 16)
            error_label.text_color = "#e74c3c"
            error_label.alignment = ui.ALIGN_CENTER
            error_label.number_of_lines = 0
            error_label.frame = (50, 150, screen_width - 100, 100)
            error_view.add_subview(error_label)
            
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#3498db"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width // 2 - 100, 300, 200, 40)
            back_button.action = lambda sender: self.show_settings_view()
            error_view.add_subview(back_button)
            
            if hasattr(self, 'main_view'):
                if hasattr(self, 'current_content_view') and self.current_content_view:
                    try:
                        self.current_content_view.remove_from_superview()
                    except:
                        pass
                
                self.main_view.add_subview(error_view)
                self.current_content_view = error_view

    def adjust_part_colors(self):
        """调整零件颜色，将文本颜色转换为color_id"""
        try:
            import sqlite3
            print("开始调整零件颜色...")
            
            # 连接数据库
            conn = self.partwall._get_connection()
            cursor = conn.cursor()
            
            # 检查colors表是否存在，如果不存在则创建
            try:
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS colors (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        color_name TEXT NOT NULL UNIQUE,
                        rgb TEXT,
                        bricklink_id INTEGER
                    )
                ''')
                conn.commit()
            except Exception as e:
                print(f"创建colors表失败: {e}")
                conn.close()
                return
            
            # 查找所有零件
            try:
                # 首先尝试使用color字段（旧结构）
                cursor.execute('SELECT id, color FROM parts')
                parts = cursor.fetchall()
                use_color_field = True
            except sqlite3.OperationalError:
                # 如果出错，尝试使用color_id字段
                try:
                    cursor.execute('SELECT id, color_id FROM parts')
                    parts = cursor.fetchall()
                    use_color_field = False
                except Exception as e:
                    print(f"查询零件失败: {e}")
                    conn.close()
                    return
            
            processed_count = 0
            updated_count = 0
            skipped_count = 0
            
            for part in parts:
                part_id, color_value = part
                
                # 检查color_value是否为文本（非数字）
                try:
                    # 尝试转换为数字
                    int(color_value)
                    # 是数字，跳过
                    skipped_count += 1
                except ValueError:
                    # 是文本，需要转换
                    color_name = str(color_value).strip()
                    if color_name:
                        try:
                            # 查找或创建颜色
                            cursor.execute('''
                                INSERT OR IGNORE INTO colors (color_name)
                                VALUES (?)
                            ''', (color_name,))
                            conn.commit()
                            
                            # 获取颜色ID
                            cursor.execute('''
                                SELECT id FROM colors WHERE name = ?
                            ''', (color_name,))
                            color_row = cursor.fetchone()
                            
                            if color_row:
                                color_id = color_row[0]
                                
                                # 更新零件的颜色
                                if use_color_field:
                                    cursor.execute('''
                                        UPDATE parts SET color = ?
                                        WHERE id = ?
                                    ''', (color_id, part_id))
                                else:
                                    cursor.execute('''
                                        UPDATE parts SET color_id = ?
                                        WHERE id = ?
                                    ''', (color_id, part_id))
                                
                                updated_count += 1
                            else:
                                print(f"获取颜色ID失败: {color_name}")
                                skipped_count += 1
                        except Exception as e:
                            print(f"处理零件 {part_id} 失败: {e}")
                            skipped_count += 1
                    else:
                        skipped_count += 1
                
                processed_count += 1
            
            # 提交事务
            conn.commit()
            conn.close()
            
            print(f"零件颜色调整完成:")
            print(f"- 处理零件数: {processed_count}")
            print(f"- 更新颜色数: {updated_count}")
            print(f"- 跳过零件数: {skipped_count}")
            
        except Exception as e:
            print(f"Error in adjust_part_colors: {e}")
    
    def show_all_colors(self):
        """显示所有颜色的详细信息"""
        try:
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建显示颜色内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 返回按钮
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#3498db"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width - 120, 20, 100, 40)
            back_button.action = lambda sender: self.show_settings_view()
            content_view.add_subview(back_button)
            
            # 标题
            title = ui.Label()
            title.text = "所有颜色"
            title.font = ("Arial", 24)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (0, 80, screen_width, 50)
            content_view.add_subview(title)
            
            # 连接数据库
            conn = self.partwall._get_connection()
            cursor = conn.cursor()
            
            # 查询所有颜色
            try:
                cursor.execute('SELECT id, color_name, rgb FROM colors ORDER BY id')
                colors = cursor.fetchall()
            except Exception as e:
                print(f"查询颜色失败: {e}")
                conn.close()
                # 显示错误信息
                error_label = ui.Label()
                error_label.text = "查询颜色失败"
                error_label.font = ("Arial", 16)
                error_label.text_color = "#e74c3c"
                error_label.alignment = ui.ALIGN_CENTER
                error_label.frame = (0, 150, screen_width, 50)
                content_view.add_subview(error_label)
                self.main_view.add_subview(content_view)
                self.current_content_view = content_view
                return
            
            conn.close()
            
            if colors:
                # 创建滚动视图
                scroll_view = ui.ScrollView()
                scroll_view.frame = (20, 150, screen_width - 40, content_view.height - 170)
                scroll_view.shows_vertical_scroll_indicator = True
                
                # 创建滚动内容视图
                scroll_content = ui.View()
                scroll_content_width = screen_width - 40
                scroll_content_height = len(colors) * 80
                scroll_content.frame = (0, 0, scroll_content_width, scroll_content_height)
                
                # 为每个颜色创建显示行
                for i, color in enumerate(colors):
                    color_id, color_name, rgb = color
                    
                    # 创建颜色行视图
                    color_row = ui.View()
                    color_row.frame = (0, i * 80, scroll_content_width, 70)
                    color_row.background_color = "#ffffff"
                    color_row.border_width = 1
                    color_row.border_color = "#ddd"
                    color_row.corner_radius = 5
                    
                    # 颜色ID标签
                    id_label = ui.Label()
                    id_label.text = f"ID: {color_id}"
                    id_label.font = ("Arial", 14)
                    id_label.text_color = "#34495e"
                    id_label.frame = (20, 10, 80, 20)
                    color_row.add_subview(id_label)
                    
                    # 颜色名称标签
                    name_label = ui.Label()
                    name_label.text = f"名称: {color_name}"
                    name_label.font = ("Arial", 14)
                    name_label.text_color = "#34495e"
                    name_label.frame = (120, 10, 200, 20)
                    color_row.add_subview(name_label)
                    
                    # RGB值标签
                    rgb_label = ui.Label()
                    rgb_text = f"RGB: {rgb}" if rgb else "RGB: 未设置"
                    rgb_label.text = rgb_text
                    rgb_label.font = ("Arial", 14)
                    rgb_label.text_color = "#34495e"
                    rgb_label.frame = (340, 10, 200, 20)
                    color_row.add_subview(rgb_label)
                    
                    # 如果有RGB值，显示颜色块
                    if rgb:
                        try:
                            # 解析RGB值
                            rgb_parts = rgb.strip('()').split(',')
                            if len(rgb_parts) == 3:
                                r, g, b = int(rgb_parts[0]), int(rgb_parts[1]), int(rgb_parts[2])
                                # 创建颜色块
                                color_block = ui.View()
                                color_block.frame = (scroll_content_width - 80, 10, 60, 50)
                                color_block.background_color = f"rgb({r}, {g}, {b})"
                                color_block.border_width = 1
                                color_block.border_color = "#ddd"
                                color_row.add_subview(color_block)
                        except:
                            pass
                    
                    scroll_content.add_subview(color_row)
                
                # 设置滚动视图内容大小
                scroll_view.content_size = (scroll_content_width, scroll_content_height)
                scroll_view.add_subview(scroll_content)
                content_view.add_subview(scroll_view)
            else:
                # 显示无颜色信息
                no_colors_label = ui.Label()
                no_colors_label.text = "暂无颜色信息"
                no_colors_label.font = ("Arial", 16)
                no_colors_label.text_color = "#7f8c8d"
                no_colors_label.alignment = ui.ALIGN_CENTER
                no_colors_label.frame = (0, 150, screen_width, 50)
                content_view.add_subview(no_colors_label)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("显示所有颜色完成")
        except Exception as e:
            print(f"Error in show_all_colors: {e}")

    def import_inventory_parts(self):
        """导入inventory_parts.csv文件到RB.db数据库"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 返回按钮（右上角）
            back_button = ui.Button()
            back_button.title = "返回"
            back_button.background_color = "#e74c3c"
            back_button.tint_color = "white"
            back_button.corner_radius = 8
            back_button.frame = (screen_width - 120, 20, 100, 40)
            back_button.action = lambda sender: self.show_settings_view()
            content_view.add_subview(back_button)
            
            # 标题
            title = ui.Label()
            title.text = "导入零件数据"
            title.font = ("Arial", 24)
            title.text_color = "#2c3e50"
            title.alignment = ui.ALIGN_CENTER
            title.frame = (0, 80, screen_width, 50)
            content_view.add_subview(title)
            
            # 尝试获取当前目录
            try:
                # 首先尝试使用__file__变量
                current_dir = os.path.dirname(__file__)
                print(f"Using __file__ directory: {current_dir}")
            except NameError:
                # 如果__file__未定义（例如在Pythonista中），使用当前工作目录
                import os
                current_dir = os.getcwd()
                print(f"__file__ not defined, using current working directory: {current_dir}")
            
            # 构建partwall.db文件路径（应用的主数据库）
            import os
            db_path = os.path.join(current_dir, 'partwall.db')
            print(f"Looking for partwall.db at: {db_path}")
            
            # 检查partwall.db是否存在
            if not os.path.exists(db_path):
                # 显示错误信息
                error_label = ui.Label()
                error_label.text = f"partwall.db not found at:\n{db_path}"
                error_label.font = ("Arial", 14)
                error_label.text_color = "#e74c3c"
                error_label.alignment = ui.ALIGN_CENTER
                error_label.number_of_lines = 0
                error_label.frame = (40, 160, screen_width - 80, 100)
                content_view.add_subview(error_label)
            else:
                # 尝试在RB文件夹中查找inventory_parts.csv文件
                import os
                rb_folder = os.path.join(current_dir, 'RB')
                csv_path = os.path.join(rb_folder, 'inventory_parts.csv')
                
                if os.path.exists(csv_path):
                    print(f"Found CSV file in RB folder: {csv_path}")
                else:
                    # 如果RB文件夹中没有找到，打开文件选择器让用户选择
                    import console
                    print(f"CSV file not found in RB folder: {csv_path}")
                    csv_path = console.open_file(filetypes=['.csv'])
                    
                    if not csv_path:
                        # 用户取消了文件选择
                        error_label = ui.Label()
                        error_label.text = "文件选择已取消"
                        error_label.font = ("Arial", 14)
                        error_label.text_color = "#e74c3c"
                        error_label.alignment = ui.ALIGN_CENTER
                        error_label.frame = (40, 160, screen_width - 80, 50)
                        content_view.add_subview(error_label)
                        return
                    else:
                        print(f"Selected CSV file: {csv_path}")
                
                # 读取CSV文件
                import csv
                rows_imported = 0
                rows_skipped = 0
                
                try:
                    # 连接到数据库
                    import sqlite3
                    conn = sqlite3.connect(db_path)
                    cursor = conn.cursor()
                    
                    # 检查inventory_parts表是否存在，如果不存在则创建
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_parts'")
                    table_exists = cursor.fetchone()
                    
                    if not table_exists:
                        # 创建inventory_parts表
                        cursor.execute('''
                            CREATE TABLE IF NOT EXISTS inventory_parts (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                part_num TEXT NOT NULL,
                                color_id INTEGER NOT NULL,
                                quantity INTEGER DEFAULT 0,
                                img_url TEXT,
                                last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                UNIQUE(part_num, color_id)
                            )
                        ''')
                        print("Created inventory_parts table in partwall.db")
                    else:
                        print("inventory_parts table already exists in partwall.db")
                    
                    # 读取CSV文件并导入数据
                    with open(csv_path, 'r', encoding='utf-8') as csvfile:
                        csv_reader = csv.DictReader(csvfile)
                        for row in csv_reader:
                            try:
                                part_num = row.get('part_num', '').strip()
                                color_id = int(row.get('color_id', 0))
                                quantity = int(row.get('quantity', 0))
                                img_url = row.get('img_url', '').strip()
                                
                                if part_num:
                                    # 使用INSERT OR IGNORE语句避免重复导入
                                    cursor.execute('''
                                        INSERT OR IGNORE INTO inventory_parts (part_num, color_id, quantity, img_url)
                                        VALUES (?, ?, ?, ?)
                                    ''', (part_num, color_id, quantity, img_url))
                                    
                                    if cursor.rowcount > 0:
                                        rows_imported += 1
                                    else:
                                        rows_skipped += 1
                            except Exception as row_error:
                                print(f"Error processing row: {row_error}")
                                rows_skipped += 1
                    
                    # 提交更改
                    conn.commit()
                    conn.close()
                    
                    # 显示导入结果
                    result_label = ui.Label()
                    result_label.text = f"导入完成！\n导入行数: {rows_imported}\n跳过行数: {rows_skipped}"
                    result_label.font = ("Arial", 16)
                    result_label.text_color = "#27ae60"
                    result_label.alignment = ui.ALIGN_CENTER
                    result_label.number_of_lines = 0
                    result_label.frame = (40, 160, screen_width - 80, 100)
                    content_view.add_subview(result_label)
                    
                    # 显示inventory_parts表的10行数据
                    self.show_inventory_parts_preview(db_path, content_view, screen_width, screen_height)
                    
                except Exception as import_error:
                    print(f"Error importing inventory parts: {import_error}")
                    import traceback
                    traceback.print_exc()
                    
                    # 显示错误信息
                    error_label = ui.Label()
                    error_label.text = f"导入失败:\n{str(import_error)}"
                    error_label.font = ("Arial", 14)
                    error_label.text_color = "#e74c3c"
                    error_label.alignment = ui.ALIGN_CENTER
                    error_label.number_of_lines = 0
                    error_label.frame = (40, 160, screen_width - 80, 100)
                    content_view.add_subview(error_label)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("Import inventory parts view displayed successfully")
        except Exception as e:
            print(f"Error in import_inventory_parts: {e}")
            import traceback
            traceback.print_exc()
            # 显示错误信息
            try:
                # 获取屏幕尺寸
                import ui
                screen_width = ui.get_screen_size()[0]
                screen_height = ui.get_screen_size()[1]
                
                # 创建内容视图
                content_view = ui.View()
                content_view.frame = (0, 150, screen_width, screen_height - 150)
                content_view.background_color = "#f5f5f5"
                
                # 返回按钮（右上角）
                back_button = ui.Button()
                back_button.title = "返回"
                back_button.background_color = "#e74c3c"
                back_button.tint_color = "white"
                back_button.corner_radius = 8
                back_button.frame = (screen_width - 120, 20, 100, 40)
                back_button.action = lambda sender: self.show_settings_view()
                content_view.add_subview(back_button)
                
                # 标题
                title = ui.Label()
                title.text = "导入零件数据"
                title.font = ("Arial", 24)
                title.text_color = "#2c3e50"
                title.alignment = ui.ALIGN_CENTER
                title.frame = (0, 80, screen_width, 50)
                content_view.add_subview(title)
                
                # 错误信息
                error_label = ui.Label()
                error_label.text = f"Error: {str(e)}"
                error_label.font = ("Arial", 14)
                error_label.text_color = "#e74c3c"
                error_label.alignment = ui.ALIGN_CENTER
                error_label.number_of_lines = 0
                error_label.frame = (40, 160, screen_width - 80, 100)
                content_view.add_subview(error_label)
                
                # 添加内容视图到主视图
                self.main_view.add_subview(content_view)
                self.current_content_view = content_view
            except:
                pass
    
    def show_inventory_parts_preview(self, db_path, content_view, screen_width, screen_height):
        """显示inventory_parts表的10行数据"""
        try:
            # 连接到数据库
            import sqlite3
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # 查询inventory_parts表的前10行数据
            cursor.execute('SELECT * FROM inventory_parts LIMIT 10')
            rows = cursor.fetchall()
            
            # 获取表结构
            cursor.execute("PRAGMA table_info(inventory_parts)")
            columns = cursor.fetchall()
            column_names = [col[1] for col in columns]
            
            conn.close()
            
            # 创建预览标题
            preview_title = ui.Label()
            preview_title.text = "数据预览（前10行）"
            preview_title.font = ("Arial", 14, True)
            preview_title.text_color = "#2c3e50"
            preview_title.alignment = ui.ALIGN_CENTER
            preview_title.frame = (40, 280, screen_width - 80, 30)
            content_view.add_subview(preview_title)
            
            # 创建滚动视图
            scroll_view = ui.ScrollView()
            scroll_view.frame = (20, 320, screen_width - 40, screen_height - 370)
            
            # 创建内容视图
            scroll_content = ui.View()
            
            # 计算内容高度
            row_height = 40
            content_height = len(rows) * row_height + 30
            scroll_content.frame = (0, 0, screen_width - 40, content_height)
            
            # 显示列名
            header_label = ui.Label()
            header_label.text = " | ".join(column_names[:5])  # 只显示前5列
            header_label.font = ("Arial", 10, True)
            header_label.text_color = "#2c3e50"
            header_label.frame = (10, 0, screen_width - 60, 20)
            scroll_content.add_subview(header_label)
            
            # 显示数据行
            for i, row in enumerate(rows):
                row_label = ui.Label()
                # 只显示前5列数据
                row_data = [str(row[j])[:15] for j in range(min(5, len(row)))]
                row_label.text = " | ".join(row_data)
                row_label.font = ("Arial", 10)
                row_label.text_color = "#34495e"
                row_label.number_of_lines = 1
                row_label.frame = (10, 25 + i * row_height, screen_width - 60, row_height)
                scroll_content.add_subview(row_label)
            
            scroll_view.content_size = (screen_width - 40, content_height)
            scroll_view.add_subview(scroll_content)
            content_view.add_subview(scroll_view)
            
            print("Inventory parts preview displayed successfully")
        except Exception as e:
            print(f"Error in show_inventory_parts_preview: {e}")
            import traceback
            traceback.print_exc()

    def show_system_warehouse_manage_view(self):
        """显示系统设置中的仓库管理视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建仓库管理内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 添加一个返回按钮（左上角）
            back_button = ui.Button()
            back_button.frame = (20, 20, 100, 40)
            back_button.title = "返回"
            back_button.background_color = "#3498db"
            back_button.tint_color = "white"
            back_button.corner_radius = 5
            back_button.action = lambda sender: self.show_settings_view()
            content_view.add_subview(back_button)
            
            # 添加仓库按钮
            add_button = ui.Button()
            add_button.frame = (screen_width - 120, 20, 100, 40)
            add_button.title = "添加仓库"
            add_button.background_color = "#27ae60"
            add_button.tint_color = "white"
            add_button.corner_radius = 5
            add_button.action = lambda sender: self.show_add_warehouse_view()
            content_view.add_subview(add_button)
            
            # 添加一个标题
            title_label = ui.Label()
            title_label.frame = (0, 80, screen_width, 40)
            title_label.text = "仓库管理（系统设置）"
            title_label.font = ("Arial", 24)
            title_label.text_color = "#333"
            title_label.alignment = ui.ALIGN_CENTER
            content_view.add_subview(title_label)
            
            # 获取仓库列表
            warehouses = self.partwall.list_warehouses()
            
            # 添加仓库列表
            if warehouses:
                # 创建一个滚动视图来显示仓库
                scroll_view = ui.ScrollView()
                scroll_view.frame = (20, 140, screen_width - 40, content_view.height - 160)
                
                # 创建一个容器视图来容纳所有仓库按钮
                scroll_content = ui.View()
                scroll_content.frame = (0, 0, screen_width - 40, len(warehouses) * 80)
                
                # 为每个仓库创建一个按钮
                for i, warehouse in enumerate(warehouses):
                    # 创建仓库按钮容器
                    container = ui.View()
                    container.frame = (0, i * 80, screen_width - 40, 70)
                    container.background_color = "#ffffff"
                    container.border_width = 1
                    container.border_color = "#ddd"
                    container.corner_radius = 5
                    
                    # 仓库名称按钮
                    warehouse_button = ui.Button()
                    warehouse_button.frame = (10, 10, container.width - 220, 50)
                    warehouse_button.title = f"{warehouse[0]}. {warehouse[1]}"
                    warehouse_button.background_color = "clear"
                    warehouse_button.tint_color = "#3498db"
                    warehouse_button.action = lambda sender, wid=warehouse[0]: self.show_box_view(wid)
                    container.add_subview(warehouse_button)
                    
                    # 重命名按钮
                    rename_button = ui.Button()
                    rename_button.frame = (container.width - 200, 10, 90, 50)
                    rename_button.title = "重命名"
                    rename_button.background_color = "#f39c12"
                    rename_button.tint_color = "white"
                    rename_button.corner_radius = 5
                    rename_button.action = lambda sender, wid=warehouse[0], name=warehouse[1]: self.show_rename_warehouse_view(wid, name)
                    container.add_subview(rename_button)
                    
                    # 删除按钮
                    delete_button = ui.Button()
                    delete_button.frame = (container.width - 100, 10, 80, 50)
                    delete_button.title = "删除"
                    delete_button.background_color = "#e74c3c"
                    delete_button.tint_color = "white"
                    delete_button.corner_radius = 5
                    delete_button.action = lambda sender, wid=warehouse[0]: self.show_delete_warehouse_confirm(wid)
                    container.add_subview(delete_button)
                    
                    scroll_content.add_subview(container)
                
                # 设置滚动视图的内容大小
                scroll_view.content_size = (screen_width - 40, len(warehouses) * 80)
                scroll_view.add_subview(scroll_content)
                content_view.add_subview(scroll_view)
            else:
                # 显示无仓库提示
                no_warehouse_label = ui.Label()
                no_warehouse_label.frame = (0, 140, screen_width, 40)
                no_warehouse_label.text = "暂无仓库"
                no_warehouse_label.font = ("Arial", 16)
                no_warehouse_label.text_color = "#999"
                no_warehouse_label.alignment = ui.ALIGN_CENTER
                content_view.add_subview(no_warehouse_label)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("System warehouse manage view content updated successfully")
        except Exception as e:
            print(f"Error in show_system_warehouse_manage_view: {e}")
    
    def show_system_box_manage_view(self):
        """显示系统设置中的盒子管理视图"""
        try:
            # 获取屏幕尺寸
            import ui
            screen_width = ui.get_screen_size()[0]
            screen_height = ui.get_screen_size()[1]
            
            # 移除当前内容视图（如果存在）
            if self.current_content_view:
                try:
                    self.current_content_view.remove_from_superview()
                except:
                    pass
            
            # 创建盒子管理内容视图
            content_view = ui.View()
            content_view.frame = (0, 150, screen_width, screen_height - 150)
            content_view.background_color = "#f5f5f5"
            
            # 添加一个返回按钮（左上角）
            back_button = ui.Button()
            back_button.frame = (20, 20, 100, 40)
            back_button.title = "返回"
            back_button.background_color = "#3498db"
            back_button.tint_color = "white"
            back_button.corner_radius = 5
            back_button.action = lambda sender: self.show_settings_view()
            content_view.add_subview(back_button)
            
            # 添加一个标题
            title_label = ui.Label()
            title_label.frame = (0, 80, screen_width, 40)
            title_label.text = "盒子管理（系统设置）"
            title_label.font = ("Arial", 24)
            title_label.text_color = "#333"
            title_label.alignment = ui.ALIGN_CENTER
            content_view.add_subview(title_label)
            
            # 获取所有仓库
            warehouses = self.partwall.list_warehouses()
            
            if warehouses:
                # 创建一个滚动视图来显示仓库和盒子
                scroll_view = ui.ScrollView()
                scroll_view.frame = (20, 140, screen_width - 40, content_view.height - 160)
                
                # 计算总高度
                total_height = 0
                for warehouse in warehouses:
                    boxes = self.partwall.list_boxes(warehouse[0])
                    total_height += 100 + len(boxes) * 60
                
                # 创建一个容器视图来容纳所有内容
                scroll_content = ui.View()
                scroll_content.frame = (0, 0, screen_width - 40, total_height)
                
                # 当前高度
                current_height = 0
                
                # 为每个仓库创建一个部分
                for warehouse in warehouses:
                    # 创建仓库标题
                    warehouse_title = ui.Label()
                    warehouse_title.frame = (0, current_height, screen_width - 40, 40)
                    warehouse_title.text = f"仓库: {warehouse[1]}"
                    warehouse_title.font = ("Arial", 18)
                    warehouse_title.text_color = "#2c3e50"
                    scroll_content.add_subview(warehouse_title)
                    current_height += 50
                    
                    # 获取仓库中的盒子
                    boxes = self.partwall.list_boxes(warehouse[0])
                    
                    if boxes:
                        # 为每个盒子创建一个条目
                        for box in boxes:
                            # 创建盒子容器
                            box_container = ui.View()
                            box_container.frame = (20, current_height, screen_width - 80, 50)
                            box_container.background_color = "#ffffff"
                            box_container.border_width = 1
                            box_container.border_color = "#ddd"
                            box_container.corner_radius = 5
                            
                            # 盒子信息
                            box_info = ui.Label()
                            box_info.frame = (10, 10, box_container.width - 120, 30)
                            box_info.text = f"{box[0]}. {box[1]}"
                            box_info.font = ("Arial", 14)
                            box_info.text_color = "#333"
                            box_container.add_subview(box_info)
                            
                            # 删除按钮
                            delete_button = ui.Button()
                            delete_button.frame = (box_container.width - 100, 10, 80, 30)
                            delete_button.title = "删除"
                            delete_button.background_color = "#e74c3c"
                            delete_button.tint_color = "white"
                            delete_button.corner_radius = 5
                            delete_button.action = lambda sender, wid=warehouse[0], box_num=box[0]: self.show_delete_box_confirm(wid, box_num)
                            box_container.add_subview(delete_button)
                            
                            scroll_content.add_subview(box_container)
                            current_height += 60
                    else:
                        # 无盒子提示
                        no_box_label = ui.Label()
                        no_box_label.frame = (20, current_height, screen_width - 80, 30)
                        no_box_label.text = "暂无盒子"
                        no_box_label.font = ("Arial", 14)
                        no_box_label.text_color = "#999"
                        scroll_content.add_subview(no_box_label)
                        current_height += 40
                    
                    current_height += 40
                
                # 设置滚动视图的内容大小
                scroll_view.content_size = (screen_width - 40, total_height)
                scroll_view.add_subview(scroll_content)
                content_view.add_subview(scroll_view)
            else:
                # 无仓库提示
                no_warehouse_label = ui.Label()
                no_warehouse_label.frame = (0, (content_view.height - 50) / 2, screen_width, 50)
                no_warehouse_label.text = "暂无仓库"
                no_warehouse_label.font = ("Arial", 16)
                no_warehouse_label.text_color = "#999"
                no_warehouse_label.alignment = ui.ALIGN_CENTER
                content_view.add_subview(no_warehouse_label)
            
            # 添加内容视图到主视图
            self.main_view.add_subview(content_view)
            self.current_content_view = content_view
            
            print("System box manage view content updated successfully")
        except Exception as e:
            print(f"Error in show_system_box_manage_view: {e}")
    
    def init_database(self):
        """执行数据库初始化"""
        try:
            success = self.partwall.init_database()
            self.show_settings_view()
        except Exception as e:
            print(f"Error in init_database: {e}")
    
    def perform_search(self, part_num, content_view):
        """执行零件搜索"""
        try:
            import ui
            if part_num:
                results = self.partwall.search_part(part_num)
                
                # 清除现有的结果视图
                result_views = []
                for i, subview in enumerate(content_view.subviews):
                    if subview.frame.y >= 240:
                        result_views.append(subview)
                for view in result_views:
                    try:
                        # 检查视图是否有remove_from_superview方法
                        if hasattr(view, 'remove_from_superview'):
                            view.remove_from_superview()
                        else:
                            # 在Pythonista中，_ui.View对象没有remove_from_superview方法
                            # 我们可以通过设置alpha为0来隐藏视图
                            view.alpha = 0
                    except Exception as e:
                        pass
                
                if results:
                    # 获取零件名称
                    part_name = ""
                    try:
                        # 尝试从legoparts表中获取零件名称（忽略大小写）
                        conn = self.partwall._get_connection()
                        cursor = conn.cursor()
                        cursor.execute('SELECT name FROM legoparts WHERE part_num = ? COLLATE NOCASE LIMIT 1', (part_num,))
                        part_row = cursor.fetchone()
                        if part_row:
                            part_name = part_row[0]
                        else:
                            # 如果没有找到，尝试使用LIKE查询（忽略大小写）
                            cursor.execute('SELECT name FROM legoparts WHERE part_num LIKE ? COLLATE NOCASE LIMIT 1', (part_num,))
                            part_row = cursor.fetchone()
                            if part_row:
                                part_name = part_row[0]
                        conn.close()
                    except Exception as e:
                        pass
                    
                    # 创建结果标题
                    result_title = ui.Label()
                    result_title.text = f"零件 {part_num} 搜索结果"
                    result_title.font = ("Arial", 18)
                    result_title.text_color = "#2c3e50"
                    result_title.alignment = ui.ALIGN_CENTER
                    result_title.frame = (0, 240, content_view.width, 40)
                    content_view.add_subview(result_title)
                    
                    # 添加零件名称显示
                    if part_name:
                        part_name_label = ui.Label()
                        part_name_label.text = f"零件名称: {part_name}"
                        part_name_label.font = ("Arial", 14)
                        part_name_label.text_color = "#3498db"
                        part_name_label.alignment = ui.ALIGN_CENTER
                        part_name_label.frame = (0, 280, content_view.width, 30)
                        content_view.add_subview(part_name_label)
                    
                    # 创建滚动视图来容纳零件网格
                    # 调整滚动视图位置，为零件名称标签腾出空间
                    scroll_view = ui.ScrollView()
                    scroll_view.frame = (20, 320, content_view.width - 40, content_view.height - 340)
                    
                    # 计算每个零件卡片的大小和位置
                    card_width = (content_view.width - 80) / 5  # 5个零件一行，左右各20边距
                    card_height = 200  # 增加卡片高度以容纳更多信息
                    
                    # 创建滚动内容视图
                    scroll_content = ui.View()
                    scroll_content.frame = (0, 0, content_view.width - 40, ((len(results) + 4) // 5) * (card_height + 20))
                    
                    # 为每个搜索结果创建一个卡片
                    for i, result in enumerate(results):
                        part_num, color_value, quantity, warehouse_name, box_number, box_name = result
                        # 确保color_value是整数类型的颜色ID
                        try:
                            color_id = int(color_value)
                        except ValueError:
                            # 如果color_value是文本（颜色名称），尝试从colors表中获取颜色ID
                            color_id = 0
                            try:
                                conn = self.partwall._get_connection()
                                cursor = conn.cursor()
                                # 尝试使用color_name或name字段
                                try:
                                    cursor.execute('SELECT id FROM colors WHERE color_name = ?', (color_value,))
                                    color_row = cursor.fetchone()
                                    if not color_row:
                                        cursor.execute('SELECT id FROM colors WHERE name = ?', (color_value,))
                                        color_row = cursor.fetchone()
                                except sqlite3.OperationalError:
                                    cursor.execute('SELECT id FROM colors WHERE name = ?', (color_value,))
                                    color_row = cursor.fetchone()
                                if color_row:
                                    color_id = color_row[0]
                                conn.close()
                            except Exception as e:
                                pass
                        
                        # 计算行列位置
                        row = i // 5
                        col = i % 5
                        
                        # 创建零件卡片
                        card = ui.View()
                        card.frame = (col * (card_width + 10), row * (card_height + 20), card_width, card_height)
                        card.background_color = "#ffffff"
                        card.border_width = 1
                        card.border_color = "#ddd"
                        card.corner_radius = 8
                        
                        # 添加零件图片
                        # 创建图片视图
                        img_view = ui.ImageView()
                        img_view.frame = (10, 10, card_width - 20, 80)
                        img_view.background_color = "#ecf0f1"
                        img_view.corner_radius = 5
                        img_view.content_mode = ui.CONTENT_SCALE_ASPECT_FIT
                        
                        # 尝试获取并显示零件图片
                        try:
                            # 从partwall.db数据库的inventory_parts表中获取零件图片URL
                            img_url = self.get_part_image_url(part_num, color_id)
                            
                            if img_url:
                                # 下载图片
                                img_path = self.download_image(img_url, part_num, color_id)
                                
                                if img_path:
                                    # 检查图片文件是否存在
                                    import os
                                    if os.path.exists(img_path):
                                        # 加载并显示图片
                                        import ui
                                        try:
                                            img = ui.Image.named(img_path)
                                            if img:
                                                img_view.image = img
                                            else:
                                                # 图片加载失败，显示占位符
                                                placeholder_label = ui.Label()
                                                placeholder_label.frame = (0, 0, card_width - 20, 80)
                                                placeholder_label.text = "Image"
                                                placeholder_label.font = ("Arial", 12)
                                                placeholder_label.text_color = "#7f8c8d"
                                                placeholder_label.alignment = ui.ALIGN_CENTER
                                                img_view.add_subview(placeholder_label)
                                        except Exception as img_load_error:
                                            # 显示错误占位符
                                            placeholder_label = ui.Label()
                                            placeholder_label.frame = (0, 0, card_width - 20, 80)
                                            placeholder_label.text = "Load Error"
                                            placeholder_label.font = ("Arial", 12)
                                            placeholder_label.text_color = "#e74c3c"
                                            placeholder_label.alignment = ui.ALIGN_CENTER
                                            img_view.add_subview(placeholder_label)
                                    else:
                                        # 图片文件不存在
                                        placeholder_label = ui.Label()
                                        placeholder_label.frame = (0, 0, card_width - 20, 80)
                                        placeholder_label.text = "File"
                                        placeholder_label.font = ("Arial", 12)
                                        placeholder_label.text_color = "#7f8c8d"
                                        placeholder_label.alignment = ui.ALIGN_CENTER
                                        img_view.add_subview(placeholder_label)
                                else:
                                    # 下载失败，显示占位符
                                    placeholder_label = ui.Label()
                                    placeholder_label.frame = (0, 0, card_width - 20, 80)
                                    placeholder_label.text = "Download"
                                    placeholder_label.font = ("Arial", 12)
                                    placeholder_label.text_color = "#7f8c8d"
                                    placeholder_label.alignment = ui.ALIGN_CENTER
                                    img_view.add_subview(placeholder_label)
                            else:
                                # 没有找到图片URL，显示占位符
                                placeholder_label = ui.Label()
                                placeholder_label.frame = (0, 0, card_width - 20, 80)
                                placeholder_label.text = "No Image"
                                placeholder_label.font = ("Arial", 12)
                                placeholder_label.text_color = "#7f8c8d"
                                placeholder_label.alignment = ui.ALIGN_CENTER
                                img_view.add_subview(placeholder_label)
                        except Exception as e:
                            # 出错时显示占位符
                            placeholder_label = ui.Label()
                            placeholder_label.frame = (0, 0, card_width - 20, 80)
                            placeholder_label.text = "Error"
                            placeholder_label.font = ("Arial", 12)
                            placeholder_label.text_color = "#e74c3c"
                            placeholder_label.alignment = ui.ALIGN_CENTER
                            img_view.add_subview(placeholder_label)
                        
                        card.add_subview(img_view)
                        
                        # 移除零件型号显示，不再需要在卡片上显示零件型号
                        # 零件型号已经在结果标题中显示
                        
                        # 添加零件信息
                        # 获取颜色名称
                        color_name = self.get_color_name(color_id)
                        
                        # 添加颜色信息（向上移动）
                        color_label = ui.Label()
                        color_label.text = f"颜色: {color_name}"
                        color_label.font = ("Arial", 10)
                        color_label.text_color = "#2c3e50"
                        color_label.alignment = ui.ALIGN_LEFT
                        color_label.number_of_lines = 1
                        color_label.frame = (10, 100, card_width - 20, 20)
                        card.add_subview(color_label)
                        
                        # 添加数量信息（向上移动）
                        quantity_label = ui.Label()
                        quantity_label.text = f"数量: {quantity}"
                        quantity_label.font = ("Arial", 10)
                        quantity_label.text_color = "#2c3e50"
                        quantity_label.alignment = ui.ALIGN_LEFT
                        quantity_label.number_of_lines = 1
                        quantity_label.frame = (10, 120, card_width - 20, 20)
                        card.add_subview(quantity_label)
                        
                        # 添加仓库信息（向上移动）
                        warehouse_label = ui.Label()
                        warehouse_label.text = f"仓库: {warehouse_name}"
                        warehouse_label.font = ("Arial", 10)
                        warehouse_label.text_color = "#2c3e50"
                        warehouse_label.alignment = ui.ALIGN_LEFT
                        warehouse_label.number_of_lines = 1
                        warehouse_label.frame = (10, 140, card_width - 20, 20)
                        card.add_subview(warehouse_label)
                        
                        # 添加盒子信息（向上移动）
                        box_label = ui.Label()
                        box_label.text = f"盒子: {box_number} ({box_name})"
                        box_label.font = ("Arial", 10)
                        box_label.text_color = "#2c3e50"
                        box_label.alignment = ui.ALIGN_LEFT
                        box_label.number_of_lines = 1
                        box_label.frame = (10, 160, card_width - 20, 20)
                        card.add_subview(box_label)
                        
                        scroll_content.add_subview(card)
                    
                    # 设置滚动视图的内容大小
                    scroll_view.content_size = (content_view.width - 40, ((len(results) + 4) // 5) * (card_height + 20))
                    scroll_view.add_subview(scroll_content)
                    content_view.add_subview(scroll_view)
                else:
                    # 无结果提示
                    no_result_label = ui.Label()
                    no_result_label.text = f"未找到型号为 {part_num} 的零件"
                    no_result_label.font = ("Arial", 16)
                    no_result_label.text_color = "#e74c3c"
                    no_result_label.alignment = ui.ALIGN_CENTER
                    no_result_label.frame = (40, 240, content_view.width - 80, 50)
                    content_view.add_subview(no_result_label)
        except Exception as e:
            pass

class WarehouseDataSource:
    """仓库数据源"""
    def __init__(self, warehouses, app):
        self.warehouses = warehouses
        self.app = app
    
    def tableview_number_of_rows(self, tableview, section):
        return len(self.warehouses)
    
    def tableview_cell_for_row(self, tableview, section, row):
        cell = ui.TableViewCell()
        warehouse = self.warehouses[row]
        cell.text_label.text = f"{warehouse[0]}. {warehouse[1]}"
        # 移除可能不存在的常量设置
        return cell
    
    def tableview_did_select(self, tableview, section, row):
        warehouse = self.warehouses[row]
        self.app.show_box_view(warehouse[0])
    
    def tableview_accessory_button_tapped(self, tableview, section, row):
        """点击附件按钮时触发（重命名仓库）"""
        warehouse = self.warehouses[row]
        self.app.show_rename_warehouse_view(warehouse[0], warehouse[1])

class BoxDataSource:
    """盒子数据源"""
    def __init__(self, boxes, warehouse_id, app):
        self.boxes = boxes
        self.warehouse_id = warehouse_id
        self.app = app
    
    def tableview_number_of_rows(self, tableview, section):
        return len(self.boxes)
    
    def tableview_cell_for_row(self, tableview, section, row):
        cell = ui.TableViewCell()
        box = self.boxes[row]
        cell.text_label.text = f"{box[0]}. {box[1]}"
        # 移除可能不存在的常量设置
        return cell
    
    def tableview_did_select(self, tableview, section, row):
        box = self.boxes[row]
        self.app.show_part_view(self.warehouse_id, box[0])
    
    def tableview_accessory_button_tapped(self, tableview, section, row):
        """点击附件按钮时触发（重命名盒子）"""
        box = self.boxes[row]
        self.app.show_rename_box_view(self.warehouse_id, box[0], box[1])

class PartDataSource:
    """零件数据源"""
    def __init__(self, parts, warehouse_id, box_number, app):
        self.parts = parts
        self.warehouse_id = warehouse_id
        self.box_number = box_number
        self.app = app
    
    def tableview_number_of_rows(self, tableview, section):
        return len(self.parts)
    
    def tableview_cell_for_row(self, tableview, section, row):
        cell = ui.TableViewCell()
        part = self.parts[row]
        cell.text_label.text = f"{part[0]} - {part[1]} (数量: {part[2]})"
        # 移除可能不存在的 detail_text_label 设置
        return cell

class WarehousePickerDataSource:
    """仓库选择器数据源"""
    def __init__(self, warehouses):
        self.warehouses = warehouses
    
    def pickerview_number_of_components(self, pickerview):
        return 1
    
    def pickerview_number_of_rows(self, pickerview, component):
        return len(self.warehouses)
    
    def pickerview_title_for_row(self, pickerview, row, component):
        return self.warehouses[row][1]

class WarehousePickerDelegate:
    """仓库选择器委托"""
    def __init__(self, warehouses):
        self.warehouses = warehouses
    
    def pickerview_did_select_row(self, pickerview, row, component):
        # 选择仓库时的处理
        pass

if __name__ == '__main__':
    try:
        app = PartWallApp()
        app.show_main_view()
    except Exception as e:
        print(f"Error in main: {e}")
