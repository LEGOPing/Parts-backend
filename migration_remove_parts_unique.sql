-- ============================================
-- 迁移脚本：移除 parts 表的唯一约束
-- 目的：允许同一盒子内相同零件（型号+颜色）存在多条记录
-- ============================================

-- 步骤1：先查看当前约束名（执行下面这行查询）
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'public.parts'::regclass;

-- 步骤2：删除唯一约束
-- 如果约束名是 parts_box_part_color_key，执行：
-- ALTER TABLE public.parts DROP CONSTRAINT IF EXISTS parts_box_part_color_key;

-- 如果约束名不同，将上面的约束名替换为实际查到的名称
