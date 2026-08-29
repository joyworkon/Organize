-- 056 数据库越权热修 pgTAP（P0-02）
-- 覆盖：
--   1. prune_note_versions 属主校验：B 不可裁剪 A 的版本（P0-01 前任意认证用户可），
--      A 可裁剪自己的（自动版本时间分级照常生效、命名版本保留）
--   2. 父子同租户复合外键：A 不能把自己的子记录挂到 B 的父资源（七处关系）
--   3. EXECUTE 分层：anon/public 无客户端 RPC；cron 系列 service_role 专用
BEGIN;
SELECT plan(18);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('48200001-0000-0000-0000-000000000001', 'p02_a@test'),
    ('48200002-0000-0000-0000-000000000002', 'p02_b@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO task_lists (id, user_id, name) VALUES
  ('48210000-0000-0000-0000-000000000001', '48200001-0000-0000-0000-000000000001', 'A清单'),
  ('48210000-0000-0000-0000-000000000002', '48200002-0000-0000-0000-000000000002', 'B清单');

INSERT INTO tasks (id, user_id, list_id, title) VALUES
  ('48220000-0000-0000-0000-000000000001', '48200001-0000-0000-0000-000000000001',
   '48210000-0000-0000-0000-000000000001', 'A的任务'),
  ('48220000-0000-0000-0000-000000000002', '48200002-0000-0000-0000-000000000002',
   '48210000-0000-0000-0000-000000000002', 'B的任务');

INSERT INTO notes (id, user_id, title, content) VALUES
  ('48230000-0000-0000-0000-000000000001', '48200001-0000-0000-0000-000000000001',
   'A的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb),
  ('48230000-0000-0000-0000-000000000002', '48200002-0000-0000-0000-000000000002',
   'B的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb);

-- A 的笔记：两条自动版本（同一小时内，裁剪应只留最新）+ 一条命名版本
INSERT INTO note_versions (id, note_id, content, message, created_at) VALUES
  ('48240000-0000-0000-0000-000000000001', '48230000-0000-0000-0000-000000000001',
   '{"type":"doc","content":[]}'::jsonb, NULL, now()),
  ('48240000-0000-0000-0000-000000000002', '48230000-0000-0000-0000-000000000001',
   '{"type":"doc","content":[]}'::jsonb, NULL, now() + interval '1 minute'),
  ('48240000-0000-0000-0000-000000000003', '48230000-0000-0000-0000-000000000001',
   '{"type":"doc","content":[]}'::jsonb, '保留我', now() - interval '2 hour');

-- B 的笔记：一条版本（A 的越权裁剪不得触及）
INSERT INTO note_versions (id, note_id, content, message) VALUES
  ('48240000-0000-0000-0000-000000000004', '48230000-0000-0000-0000-000000000002',
   '{"type":"doc","content":[]}'::jsonb, NULL);

-- B 的笔记上的评论线程（A 不能把评论挂上来）
INSERT INTO note_comment_threads (id, note_id, block_id, user_id) VALUES
  ('48250000-0000-0000-0000-000000000001', '48230000-0000-0000-0000-000000000002',
   'blk-b-1', '48200002-0000-0000-0000-000000000002');

-- ========== 1. prune_note_versions 属主校验 ==========
set role authenticated;
set request.jwt.claim.sub to '48200002-0000-0000-0000-000000000002';  -- 用户 B

SELECT throws_ok(
  'SELECT prune_note_versions(''48230000-0000-0000-0000-000000000001'')',
  'Note not found or access denied',
  'B 裁剪 A 的版本必须被拒（P0-01 前任意认证用户可裁剪他人版本）'
);

SELECT is(
  (SELECT count(*) FROM note_versions WHERE note_id = '48230000-0000-0000-0000-000000000001'),
  3::bigint,
  '越权裁剪失败后 A 的版本数量不变'
);

set request.jwt.claim.sub to '48200001-0000-0000-0000-000000000001';  -- 用户 A

SELECT lives_ok(
  'SELECT prune_note_versions(''48230000-0000-0000-0000-000000000001'')',
  'A 裁剪自己的版本正常执行'
);

SELECT is(
  (SELECT count(*) FROM note_versions WHERE note_id = '48230000-0000-0000-0000-000000000001'),
  2::bigint,
  '同一小时的两条自动版本只留最新（时间分级照常）+ 命名版本保留'
);

SELECT is(
  (SELECT count(*) FROM note_versions WHERE note_id = '48230000-0000-0000-0000-000000000001' AND message IS NOT NULL),
  1::bigint,
  '命名版本「保留我」不被清理'
);

-- ========== 2. 父子同租户复合外键 ==========
set request.jwt.claim.sub to '48200001-0000-0000-0000-000000000001';  -- 用户 A

SELECT throws_ok(
  'INSERT INTO task_reminders (user_id, task_id, anchor, offset_minutes) VALUES
   (''48200001-0000-0000-0000-000000000001'', ''48220000-0000-0000-0000-000000000002'', ''start'', -10)',
  '23503',
  'A 不能给 B 的任务挂提醒'
);

SELECT lives_ok(
  'INSERT INTO task_reminders (user_id, task_id, anchor, offset_minutes) VALUES
   (''48200001-0000-0000-0000-000000000001'', ''48220000-0000-0000-0000-000000000001'', ''start'', -10)',
  'A 给自己的任务挂提醒正常（正常路径未被误伤）'
);

SELECT throws_ok(
  'INSERT INTO task_attachments (user_id, task_id, name, path) VALUES
   (''48200001-0000-0000-0000-000000000001'', ''48220000-0000-0000-0000-000000000002'', ''x.pdf'', ''a/b.pdf'')',
  '23503',
  'A 不能给 B 的任务挂附件'
);

SELECT throws_ok(
  'INSERT INTO task_item_refs (user_id, task_id, note_id, block_id) VALUES
   (''48200001-0000-0000-0000-000000000001'', ''48220000-0000-0000-0000-000000000002'',
    ''48230000-0000-0000-0000-000000000001'', ''blk-1'')',
  '23503',
  'A 不能引用 B 的任务（引用关系 task 侧）'
);

SELECT throws_ok(
  'INSERT INTO task_item_refs (user_id, task_id, note_id, block_id) VALUES
   (''48200001-0000-0000-0000-000000000001'', ''48220000-0000-0000-0000-000000000001'',
    ''48230000-0000-0000-0000-000000000002'', ''blk-2'')',
  '23503',
  'A 不能引用 B 的笔记（引用关系 note 侧）'
);

SELECT throws_ok(
  'INSERT INTO task_dependencies (task_id, depends_on_task_id, user_id) VALUES
   (''48220000-0000-0000-0000-000000000001'', ''48220000-0000-0000-0000-000000000002'',
    ''48200001-0000-0000-0000-000000000001'')',
  '23503',
  'A 不能把自己的任务依赖到 B 的任务'
);

SELECT throws_ok(
  'INSERT INTO note_comment_threads (note_id, block_id, user_id) VALUES
   (''48230000-0000-0000-0000-000000000002'', ''blk-a-1'', ''48200001-0000-0000-0000-000000000001'')',
  '23503',
  'A 不能在 B 的笔记上开评论线程'
);

SELECT throws_ok(
  'INSERT INTO note_comments (thread_id, user_id, body) VALUES
   (''48250000-0000-0000-0000-000000000001'', ''48200001-0000-0000-0000-000000000001'', ''hi'')',
  '23503',
  'A 不能在 B 的评论线程下留言'
);

SELECT throws_ok(
  'INSERT INTO tasks (id, user_id, list_id, title, parent_task_id) VALUES
   (''48220000-0000-0000-0000-000000000003'', ''48200001-0000-0000-0000-000000000001'',
    ''48210000-0000-0000-0000-000000000001'', ''A的子任务'', ''48220000-0000-0000-0000-000000000002'')',
  '23503',
  'A 不能把自己的子任务挂到 B 的任务下（跨租户级联删除/置空向量）'
);

-- ========== 3. EXECUTE 分层 ==========
reset role;

SELECT is(
  has_function_privilege('anon', 'prune_note_versions(uuid)', 'EXECUTE'),
  false, 'anon 不可调用 prune_note_versions'
);
SELECT is(
  has_function_privilege('authenticated', 'prune_note_versions(uuid)', 'EXECUTE'),
  true, 'authenticated 可调用 prune_note_versions（save_note_named_version 内部链路需要）'
);
SELECT is(
  has_function_privilege('anon', 'claim_due_task_reminder_deliveries(integer)', 'EXECUTE'),
  false, 'anon 不可调用 cron 提醒投递'
);
SELECT is(
  has_function_privilege('authenticated', 'claim_due_task_reminder_deliveries(integer)', 'EXECUTE'),
  false, 'authenticated 不可调用 cron 提醒投递（service_role 专用）'
);
SELECT is(
  has_function_privilege('service_role', 'claim_due_task_reminder_deliveries(integer)', 'EXECUTE'),
  true, 'service_role 可调用 cron 提醒投递'
);
SELECT is(
  has_function_privilege('anon', 'get_public_share(text)', 'EXECUTE'),
  true, 'anon 可调用公开分享读取（匿名分享页依赖）'
);

SELECT * FROM finish();
ROLLBACK;
