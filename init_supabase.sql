-- ============================================
-- 乐高零件管理系统 - Supabase PostgreSQL 建表脚本
-- 创建时间: 2026-07-28
-- ============================================

-- 1. 仓库表 (repositories)
CREATE TABLE IF NOT EXISTS repositories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repositories_name ON repositories(name);

-- 2. 盒子表 (boxes)
CREATE TABLE IF NOT EXISTS boxes (
    id SERIAL PRIMARY KEY,
    box_number INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    repository_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_boxes_box_number ON boxes(box_number);
CREATE INDEX IF NOT EXISTS idx_boxes_name ON boxes(name);
CREATE INDEX IF NOT EXISTS idx_boxes_repository_id ON boxes(repository_id);

-- 3. 颜色表 (colors)
CREATE TABLE IF NOT EXISTS colors (
    id SERIAL PRIMARY KEY,
    color_name VARCHAR(255) NOT NULL,
    rgb VARCHAR(20),
    bricklink_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_colors_color_name ON colors(color_name);

-- 4. 零件表 (parts)
-- 注意：唯一约束使用 (box_id, id, color_id) 而非 (box_id, part_num, color_id)
-- 由于 id 是主键已唯一，此约束允许同一盒内存在相同 part_num + color_id 的多条记录
-- 业务上支持"同盒同型号同颜色重号"，例如不同批次入库分别记录
CREATE TABLE IF NOT EXISTS parts (
    id SERIAL PRIMARY KEY,
    part_num VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    color_id INTEGER NOT NULL,
    is_new BOOLEAN DEFAULT FALSE,
    quantity INTEGER DEFAULT 0,
    box_id INTEGER REFERENCES boxes(id) ON DELETE CASCADE,
    CONSTRAINT parts_box_id_color_key UNIQUE (box_id, id, color_id)
);

CREATE INDEX IF NOT EXISTS idx_parts_part_num ON parts(part_num);
CREATE INDEX IF NOT EXISTS idx_parts_name ON parts(name);
CREATE INDEX IF NOT EXISTS idx_parts_color_id ON parts(color_id);
CREATE INDEX IF NOT EXISTS idx_parts_box_id ON parts(box_id);

-- 添加表注释
COMMENT ON TABLE repositories IS '仓库表 - 存储乐高零件仓库信息';
COMMENT ON TABLE boxes IS '盒子表 - 存储仓库内的分类盒子';
COMMENT ON TABLE colors IS '颜色表 - 存储乐高颜色信息';
COMMENT ON TABLE parts IS '零件表 - 存储具体的乐高零件';

-- 添加列注释
COMMENT ON COLUMN boxes.box_number IS '盒子编号';
COMMENT ON COLUMN boxes.repository_id IS '所属仓库ID';
COMMENT ON COLUMN parts.part_num IS '零件型号 (如 3001)';
COMMENT ON COLUMN parts.color_id IS '颜色ID';
COMMENT ON COLUMN parts.is_new IS '是否为新零件';
COMMENT ON COLUMN parts.quantity IS '库存数量';
COMMENT ON COLUMN parts.box_id IS '所属盒子ID';
COMMENT ON COLUMN colors.rgb IS 'RGB颜色值';
COMMENT ON COLUMN colors.bricklink_id IS 'BrickLink颜色ID';

-- 初始化数据：预置一些常见颜色
INSERT INTO colors (color_name, rgb, bricklink_id) VALUES
    ('红色', '#C91A09', 21),
    ('蓝色', '#0055BF', 23),
    ('绿色', '#237841', 24),
    ('黄色', '#F2CD37', 2),
    ('白色', '#FFFFFF', 1),
    ('黑色', '#05131D', 11),
    ('灰色', '#959A9B', 199),
    ('深灰色', '#6C6E68', 199),
    ('棕色', '#583927', 88),
    ('粉色', '#F6A7B0', 25),
    ('橙色', '#E07A2C', 4),
    ('紫色', '#6B3F87', 26),
    ('青色', '#0E7C9E', 28),
    ('金色', '#D4B16A', 212),
    ('银色', '#A0A5A9', 199)
ON CONFLICT DO NOTHING;

-- ============================================
-- 重置自增序列函数（供前端 RPC 调用，替代 CloudBase 后端）
-- SECURITY DEFINER: 以函数所有者(postgres)身份执行，使 anon key 也能调用
-- ============================================
CREATE OR REPLACE FUNCTION reset_sequences()
RETURNS void AS $$
BEGIN
    ALTER SEQUENCE repositories_id_seq RESTART WITH 1;
    ALTER SEQUENCE boxes_id_seq RESTART WITH 1;
    ALTER SEQUENCE parts_id_seq RESTART WITH 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 允许 anon 和 authenticated 角色调用
GRANT EXECUTE ON FUNCTION reset_sequences() TO anon;
GRANT EXECUTE ON FUNCTION reset_sequences() TO authenticated;
