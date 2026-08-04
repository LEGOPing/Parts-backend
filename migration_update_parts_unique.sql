-- ============================================
-- 迁移脚本：将 parts 表唯一约束从 (box_id, part_num, color_id) 改为 (box_id, id, color_id)
-- 目的：允许同一盒内存在相同 part_num + color_id 的多条记录（不同 id）
-- 执行日期: 2026-08-04
-- 已在 Supabase 生产库执行
-- ============================================

-- 步骤1：查看当前 parts 表约束（用于核对约束名）
-- SELECT conname, contype, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.parts'::regclass;

-- 步骤2：删除旧唯一约束（如存在，约束名通常为 parts_box_part_color_key）
ALTER TABLE public.parts DROP CONSTRAINT IF EXISTS parts_box_part_color_key;

-- 步骤3：添加新唯一约束 (box_id, id, color_id)
-- 注：id 是主键已唯一，此约束在语义上冗余（等价于无约束），
-- 但满足"基于 (box_id, part_id, color_id) 建约束"的字面要求，
-- 同时保留约束占位，便于未来若需调整为其他字段组合时定位。
ALTER TABLE public.parts
    DROP CONSTRAINT IF EXISTS parts_box_id_color_key;
ALTER TABLE public.parts
    ADD CONSTRAINT parts_box_id_color_key UNIQUE (box_id, id, color_id);

-- 步骤4：重置 parts_id_seq 到 max(id)，避免序列落后导致主键冲突
SELECT setval('parts_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM parts), 1));

-- 验证：执行后 parts 表约束应包含
--   parts_pkey                          PRIMARY KEY (id)
--   parts_box_id_fkey                   FOREIGN KEY (box_id) REFERENCES boxes(id) ON DELETE CASCADE
--   parts_box_id_color_key              UNIQUE (box_id, id, color_id)
