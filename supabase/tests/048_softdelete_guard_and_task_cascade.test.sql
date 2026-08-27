-- 048 软删除边界加固 pgTAP 测试
-- 覆盖：save RPC 拒绝已软删笔记、垃圾桶任务分支按子树级联软删与恢复
BEGIN;
SELECT plan(7);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('49000001-0000-0000-0000-000000000001', 'sd_a@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ========== 场景一：save_note_with_tasks 拒绝已软删笔记 ==========
INSERT INTO notes (id, user_id, title, content, content_revision) VALUES
  ('49010000-0000-0000-0000-000000000001', '49000001-0000-0000-0000-000000000001',
   '软删笔记', '{"type":"doc","content":[]}'::jsonb, 3);
UPDATE notes SET deleted_at = now()
WHERE id = '49010000-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claim.sub to '49000001-0000-0000-0000-000000000001';

SELECT is(
  (save_note_with_tasks(
    '49010000-0000-0000-0000-000000000001',
    '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    3,
    '被覆盖的标题'
  ) ->> 'status'),
  'not_found',
  '保存 RPC 对已软删笔记返回 not_found'
);

reset role;

SELECT is(
  (SELECT title FROM notes WHERE id = '49010000-0000-0000-0000-000000000001'),
  '软删笔记',
  '垃圾箱里的内容未被滞留保存改动'
);
SELECT is(
  (SELECT content_revision FROM notes WHERE id = '49010000-0000-0000-0000-000000000001'),
  3,
  'revision 未因软删后的保存尝试而变化'
);

-- ========== 场景二：mutate_trash task 分支子树级联 ==========
-- 结构：001 根
--   ├─ 002 子（存活）
--   │    └─ 004 孙（存活）
--   └─ 003 子（比父任务早 2 小时独立删除）
INSERT INTO tasks (id, user_id, title, status, category) VALUES
  ('49020000-0000-0000-0000-000000000001', '49000001-0000-0000-0000-000000000001', '父任务', 'todo', 'work');
INSERT INTO tasks (id, user_id, title, status, category, parent_task_id) VALUES
  ('49020000-0000-0000-0000-000000000002', '49000001-0000-0000-0000-000000000001', '子任务', 'todo', 'work',
   '49020000-0000-0000-0000-000000000001');
INSERT INTO tasks (id, user_id, title, status, category, parent_task_id) VALUES
  ('49020000-0000-0000-0000-000000000003', '49000001-0000-0000-0000-000000000001', '更早独立删除的子任务', 'todo', 'work',
   '49020000-0000-0000-0000-000000000001');
INSERT INTO tasks (id, user_id, title, status, category, parent_task_id) VALUES
  ('49020000-0000-0000-0000-000000000004', '49000001-0000-0000-0000-000000000001', '孙任务', 'todo', 'work',
   '49020000-0000-0000-0000-000000000002');

-- 把 003 回拨为"更早独立删除"
UPDATE tasks SET deleted_at = now() - interval '2 hours'
WHERE id = '49020000-0000-0000-0000-000000000003';

-- 软删父任务：级联到 002 与 004；003 已在桶里（时间更早）不受影响
set role authenticated;
set request.jwt.claim.sub to '49000001-0000-0000-0000-000000000001';

SELECT is(
  mutate_trash('soft_delete', 'task', ARRAY['49020000-0000-0000-0000-000000000001']::uuid[]),
  3,
  '软删父任务级联影响父+子+孙共 3 行（跳过早已删除的 003）'
);

reset role;

SELECT is(
  (SELECT count(*)::int FROM tasks
   WHERE id IN ('49020000-0000-0000-0000-000000000001','49020000-0000-0000-0000-000000000002','49020000-0000-0000-0000-000000000004')
     AND deleted_at IS NOT NULL),
  3,
  '父/子/孙全部进入垃圾箱'
);

-- 恢复父任务：同窗口入桶的子孙一并复活；003 保持已删
set role authenticated;
set request.jwt.claim.sub to '49000001-0000-0000-0000-000000000001';

SELECT is(
  mutate_trash('restore', 'task', ARRAY['49020000-0000-0000-0000-000000000001']::uuid[]),
  3,
  '恢复父任务连带复活同窗口入桶的子孙共 3 行'
);

reset role;

SELECT is(
  (SELECT count(*)::int FROM tasks
   WHERE id IN ('49020000-0000-0000-0000-000000000001','49020000-0000-0000-0000-000000000002','49020000-0000-0000-0000-000000000004')
     AND deleted_at IS NULL),
  3,
  '父/子/孙全部恢复为未删除'
);
SELECT is(
  (SELECT (deleted_at IS NOT NULL)::int FROM tasks WHERE id = '49020000-0000-0000-0000-000000000003'),
  1,
  '更早独立删除的子任务不随父恢复，仍在垃圾箱'
);

SELECT * FROM finish();
ROLLBACK;
