-- 035 任务日期清除语义 pgTAP 测试
-- 覆盖：新路径清除（只清 schedule）、旧路径清除（只清 due_date）、
--       清除后不被回填、正常双向同步不回归
BEGIN;
SELECT plan(6);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('45000001-0000-0000-0000-000000000001', 'tc_a@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 准备：带完整日期的任务
INSERT INTO tasks (id, user_id, title, status, category, due_date, schedule_start_at, schedule_end_at) VALUES
('46000001-0000-0000-0000-000000000001','45000001-0000-0000-0000-000000000001','清除测试','todo','work',
 '2026-08-20T10:00:00Z','2026-08-20T10:00:00Z','2026-08-20T12:00:00Z')
ON CONFLICT (id) DO UPDATE SET
  due_date='2026-08-20T10:00:00Z',
  schedule_start_at='2026-08-20T10:00:00Z',
  schedule_end_at='2026-08-20T12:00:00Z';

-- ========== 1. 新路径清除：只清 schedule_start_at/end（不碰 due_date）==========
UPDATE tasks SET schedule_start_at=null, schedule_end_at=null
WHERE id='46000001-0000-0000-0000-000000000001';

SELECT is(
  (SELECT (due_date IS NULL)::int FROM tasks WHERE id='46000001-0000-0000-0000-000000000001'),
  1, '只清 schedule → due_date 同步清空（不被旧值回填复活）'
);
SELECT is(
  (SELECT (schedule_start_at IS NULL AND schedule_end_at IS NULL)::int FROM tasks WHERE id='46000001-0000-0000-0000-000000000001'),
  1, '只清 schedule → schedule 保持清空'
);

-- ========== 2. 旧路径清除：只清 due_date（不碰 schedule）==========
UPDATE tasks SET due_date='2026-08-21T10:00:00Z', schedule_end_at='2026-08-21T12:00:00Z'
WHERE id='46000001-0000-0000-0000-000000000001';
-- 此时 schedule_start_at 由 trigger 同步为 due_date（旧路径填充）
UPDATE tasks SET due_date=null
WHERE id='46000001-0000-0000-0000-000000000001';

SELECT is(
  (SELECT (schedule_start_at IS NULL AND schedule_end_at IS NULL)::int FROM tasks WHERE id='46000001-0000-0000-0000-000000000001'),
  1, '只清 due_date → schedule 同步清空'
);
SELECT is(
  (SELECT (due_date IS NULL)::int FROM tasks WHERE id='46000001-0000-0000-0000-000000000001'),
  1, '只清 due_date → due_date 保持清空（不被 schedule 回填）'
);

-- ========== 3. 正常双向同步不回归 ==========
-- 旧路径：写 due_date → start 同步
UPDATE tasks SET due_date='2026-09-05T09:00:00Z'
WHERE id='46000001-0000-0000-0000-000000000001';
SELECT is(
  (SELECT (schedule_start_at IS NOT NULL)::int FROM tasks WHERE id='46000001-0000-0000-0000-000000000001'),
  1, '回归：写 due_date → schedule_start_at 同步填充'
);

-- 新路径：写 schedule → due_date = coalesce(end, start)
UPDATE tasks SET schedule_start_at='2026-09-06T09:00:00Z', schedule_end_at='2026-09-06T11:00:00Z'
WHERE id='46000001-0000-0000-0000-000000000001';
SELECT is(
  (SELECT date_trunc('day', due_date)::date::text FROM tasks WHERE id='46000001-0000-0000-0000-000000000001'),
  '2026-09-06', '回归：写 schedule → due_date = coalesce(end, start)'
);

SELECT * FROM finish();
ROLLBACK;
