-- 051 复选框状态同步「真实变迁」语义 + move_note_block 乐观锁递增 pgTAP 测试
-- 覆盖：
--   A) 取消勾选不把 in_progress/cancelled 抹成 todo；勾选完成 todo；
--      取消勾选把 done 回退为 todo 并清 completed_at
--   B) move_note_block 移动块的同时递增源/目标笔记 content_revision
BEGIN;
SELECT plan(12);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('48510001-0000-0000-0000-000000000001', 'p051@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 绑定笔记 + 四种状态的任务
INSERT INTO notes (id, user_id, title, content, content_revision) VALUES
  ('48520000-0000-0000-0000-000000000001', '48510001-0000-0000-0000-000000000001',
   '笔记', '{"type":"doc","content":[]}'::jsonb, 3);

INSERT INTO tasks (id, user_id, title, status, sync_version) VALUES
  ('48530000-0000-0000-0000-000000000001', '48510001-0000-0000-0000-000000000001', '进行中', 'in_progress', 0),
  ('48530000-0000-0000-0000-000000000002', '48510001-0000-0000-0000-000000000001', '已放弃', 'cancelled', 0),
  ('48530000-0000-0000-0000-000000000003', '48510001-0000-0000-0000-000000000001', '待办', 'todo', 0);

INSERT INTO tasks (id, user_id, title, status, sync_version, completed_at) VALUES
  ('48530000-0000-0000-0000-000000000004', '48510001-0000-0000-0000-000000000001', '已完成', 'done', 0, now() - interval '1 hour');

-- move_note_block 用的一对笔记
INSERT INTO notes (id, user_id, title, content, content_revision) VALUES
  ('48520000-0000-0000-0000-000000000002', '48510001-0000-0000-0000-000000000001',
   '源笔记',
   '{"type":"doc","content":[
      {"type":"paragraph","attrs":{"id":"b1"},"content":[{"type":"text","text":"要移动的块"}]},
      {"type":"paragraph","attrs":{"id":"b2"}}]}'::jsonb, 5),
  ('48520000-0000-0000-0000-000000000003', '48510001-0000-0000-0000-000000000001',
   '目标笔记',
   '{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"t1"}}]}'::jsonb, 2);

set role authenticated;
set request.jwt.claim.sub to '48510001-0000-0000-0000-000000000001';

-- ========== A1. 取消勾选（todo）不抹掉 in_progress / cancelled ==========
SELECT is(
  save_note_with_tasks(
    '48520000-0000-0000-0000-000000000001',
    '{"type":"doc","content":[]}'::jsonb, 3,
    null,
    '[{"task_id":"48530000-0000-0000-0000-000000000001","title":"进行中","status":"todo"},
      {"task_id":"48530000-0000-0000-0000-000000000002","title":"已放弃","status":"todo"}]'::jsonb,
    null, null, null
  ) ->> 'status',
  'ok', 'A1: 保存成功'
);
SELECT is((SELECT status FROM tasks WHERE id = '48530000-0000-0000-0000-000000000001'), 'in_progress',
  'A1: in_progress 不被复选框抹成 todo');
SELECT is((SELECT status FROM tasks WHERE id = '48530000-0000-0000-0000-000000000002'), 'cancelled',
  'A2: cancelled 不被复选框复活为 todo');

-- ========== A2. 勾选完成 todo：status=done 且 completed_at 落值 ==========
SELECT is(
  save_note_with_tasks(
    '48520000-0000-0000-0000-000000000001',
    '{"type":"doc","content":[]}'::jsonb, 4,
    null,
    '[{"task_id":"48530000-0000-0000-0000-000000000003","title":"待办","status":"done"}]'::jsonb,
    null, null, null
  ) ->> 'status',
  'ok', 'A2: 保存成功'
);
SELECT is((SELECT status FROM tasks WHERE id = '48530000-0000-0000-0000-000000000003'), 'done',
  'A2: todo 被勾选为 done');
SELECT isnt((SELECT completed_at FROM tasks WHERE id = '48530000-0000-0000-0000-000000000003'), NULL,
  'A2: 完成时间已记录');

-- ========== A3. 取消勾选把 done 回退为 todo，并清 completed_at ==========
SELECT is(
  save_note_with_tasks(
    '48520000-0000-0000-0000-000000000001',
    '{"type":"doc","content":[]}'::jsonb, 5,
    null,
    '[{"task_id":"48530000-0000-0000-0000-000000000004","title":"已完成","status":"todo"}]'::jsonb,
    null, null, null
  ) ->> 'status',
  'ok', 'A3: 保存成功'
);
SELECT is((SELECT status FROM tasks WHERE id = '48530000-0000-0000-0000-000000000004'), 'todo',
  'A3: done 回退为 todo');
SELECT is((SELECT completed_at FROM tasks WHERE id = '48530000-0000-0000-0000-000000000004'), NULL,
  'A3: 回退后清除完成时间');

-- ========== B. move_note_block 递增源/目标笔记 revision ==========
SELECT move_note_block(
  '48520000-0000-0000-0000-000000000002',
  '48520000-0000-0000-0000-000000000003',
  'b1'
);
SELECT is((SELECT content_revision FROM notes WHERE id = '48520000-0000-0000-0000-000000000002'), 6,
  'B: 源笔记 revision 5→6');
SELECT is((SELECT content_revision FROM notes WHERE id = '48520000-0000-0000-0000-000000000003'), 3,
  'B: 目标笔记 revision 2→3');
SELECT is((SELECT content->'content'->1->'attrs'->>'id' FROM notes WHERE id = '48520000-0000-0000-0000-000000000003'), 'b1',
  'B: 块已移到目标末尾');

SELECT * FROM finish();
ROLLBACK;
