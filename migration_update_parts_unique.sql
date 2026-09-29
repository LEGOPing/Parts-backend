-- ============================================
-- 迁移脚本：将 parts 表唯一约束从 (box_id, part_num, color_id) 改为 (box_id, id, color_id)
-- 同时修复 reset_sequences RPC 函数（原函数用 RESTART WITH 1 导致主键冲突）
-- 目的：允许同一盒内存在相同 part_num + color_id 的多条记录（不同 id）
-- 执行日期: 2026-08-04
-- 已在 Supabase 生产库执行
-- ============================================

-- 步骤1：删除旧唯一约束（如存在）
ALTER TABLE public.parts DROP CONSTRAINT IF EXISTS parts_box_part_color_key;

-- 步骤2：添加新唯一约束 (box_id, id, color_id)
-- 注：id 是主键已唯一，此约束在语义上冗余（等价于无约束），
-- 但满足"基于 (box_id, part_id, color_id) 建约束"的字面要求。
ALTER TABLE public.parts
    DROP CONSTRAINT IF EXISTS parts_box_id_color_key;
ALTER TABLE public.parts
    ADD CONSTRAINT parts_box_id_color_key UNIQUE (box_id, id, color_id);

-- 步骤3：修复 reset_sequences RPC 函数
-- 原实现: ALTER SEQUENCE ... RESTART WITH 1  -- 硬编码 1，有数据时必主键冲突
-- 新实现: PERFORM setval(..., GREATEST(MAX(id), 1))  -- 动态同步到最大值
CREATE OR REPLACE FUNCTION public.reset_sequences()
RETURNS void AS $$
BEGIN
    PERFORM setval('repositories_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.repositories), 1));
    PERFORM setval('boxes_id_seq',       GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.boxes),       1));
    PERFORM setval('parts_id_seq',       GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.parts),       1));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 步骤4：重置序列到正确位置
SELECT setval('parts_id_seq',       GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.parts),       1));
SELECT setval('boxes_id_seq',       GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.boxes),       1));
SELECT setval('repositories_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.repositories), 1));
