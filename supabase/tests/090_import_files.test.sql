-- 090 文件导入（阶段 D）pgTAP
--
-- 覆盖：
--   1. 鉴权：anon 直读两表被拒（permission denied，fail-closed）
--   2. RLS 隔离：B（authenticated）看不到 A 的任务与文件
--   3. retry_key 唯一约束：同键重复插入被拒（幂等重试的落库保证）
--   4. status check 约束：非法状态写入被拒
--   5. 任务删除级联清理文件；reading_item 删除后 reading_item_id 置空（不删文件行）
--   6. import-files 桶为私有 + 三条对象策略存在（insert/select/delete 限定本人目录）
--   7. authenticated 表级 GRANT 齐备（RLS 之外的第二层）

BEGIN;
SELECT plan(16);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('90000001-0000-0000-0000-000000000001', 'p9_imp_a@test', '{}'),
    ('90000002-0000-0000-0000-000000000002', 'p9_imp_b@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO public.import_tasks (id, user_id, status) VALUES
  ('90000000-0000-0000-0000-0000000000a1', '90000001-0000-0000-0000-000000000001', 'processing');

INSERT INTO public.import_files
  (id, task_id, user_id, file_name, mime, size, kind, storage_path, status, retry_key) VALUES
  ('90000000-0000-0000-0000-0000000000f1', '90000000-0000-0000-0000-0000000000a1',
   '90000001-0000-0000-0000-000000000001', '报告.pdf', 'application/pdf', 1024, 'pdf',
   '90000001-0000-0000-0000-000000000001/x.pdf', 'saved', 'p9-retry-1');

-- 关联阅读条目（set null 验证用）
INSERT INTO public.reading_items (id, user_id, url, title, content, reading_status) VALUES
  ('90000000-0000-0000-0000-0000000000b1', '90000001-0000-0000-0000-000000000001',
   'urn:organize:import:p9test', '导入条目', '<p>正文</p>', 'unread');

-- ========== 1. anon 直读被拒 ==========
SET ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.import_tasks$$,
  'permission denied for table import_tasks', 'anon 直读 import_tasks 被拒');
SELECT throws_ok($$SELECT count(*) FROM public.import_files$$,
  'permission denied for table import_files', 'anon 直读 import_files 被拒');
RESET ROLE;

-- ========== 2. RLS 隔离（B 看不到 A 的行）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '90000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.import_tasks), 0::bigint,
  '090: B 看不到 A 的导入任务');
SELECT is((SELECT count(*) FROM public.import_files), 0::bigint,
  '090: B 看不到 A 的导入文件');
SELECT is((SELECT count(*) FROM public.import_tasks WHERE id = '90000000-0000-0000-0000-0000000000a1'),
  0::bigint, '090: B 按 id 也读不到 A 的任务（RLS 行级）');

-- ========== 3. retry_key 唯一（幂等重试）==========
SET request.jwt.claim.sub TO '90000001-0000-0000-0000-000000000001';  -- A
SELECT lives_ok(
  $$INSERT INTO public.import_files (task_id, file_name, kind, retry_key) VALUES
    ('90000000-0000-0000-0000-0000000000a1', '笔记.md', 'markdown', 'p9-retry-2')$$,
  '090: 新 retry_key 可插入');
SELECT throws_ok(
  $$INSERT INTO public.import_files (task_id, file_name, kind, retry_key) VALUES
    ('90000000-0000-0000-0000-0000000000a1', '报告副本.pdf', 'pdf', 'p9-retry-1')$$,
  'duplicate key value violates unique constraint "import_files_user_id_retry_key_key"',
  '090: 同用户同 retry_key 重复插入被拒（重试幂等）');

-- ========== 4. status check 约束 ==========
SELECT throws_ok(
  $$UPDATE public.import_files SET status = 'bogus' WHERE retry_key = 'p9-retry-1'$$,
  'new row for relation "import_files" violates check constraint "import_files_status_check"',
  '090: 非法 status 写入被拒');
RESET ROLE;

-- ========== 5. 级联与 set null（postgres 直操）==========
UPDATE public.import_files SET reading_item_id = '90000000-0000-0000-0000-0000000000b1'
  WHERE retry_key = 'p9-retry-1';
SELECT is((SELECT reading_item_id FROM public.import_files WHERE retry_key = 'p9-retry-1'),
  '90000000-0000-0000-0000-0000000000b1'::uuid,
  '090: reading_item_id 可关联阅读条目');
DELETE FROM public.reading_items WHERE id = '90000000-0000-0000-0000-0000000000b1';
SELECT is((SELECT reading_item_id IS NULL FROM public.import_files WHERE retry_key = 'p9-retry-1'),
  true, '090: 阅读条目删除后 reading_item_id 置空（文件行不消失）');
SELECT is((SELECT count(*) FROM public.import_files
  WHERE task_id = '90000000-0000-0000-0000-0000000000a1'), 2::bigint,
  '090: 任务下两条文件行就绪');
DELETE FROM public.import_tasks WHERE id = '90000000-0000-0000-0000-0000000000a1';
SELECT is((SELECT count(*) FROM public.import_files
  WHERE task_id = '90000000-0000-0000-0000-0000000000a1'), 0::bigint,
  '090: 任务删除级联清理文件行');

-- ========== 6. 私有桶与对象策略 ==========
SELECT is((SELECT public FROM storage.buckets WHERE id = 'import-files'), false,
  '090: import-files 桶为私有（原件不随分享公开）');
SELECT is((SELECT count(*) FROM pg_policies WHERE tablename = 'objects'
  AND policyname LIKE '%import files%'), 4::bigint,
  '093 起为四条对象策略（上传/读取/更新/删除限定本人目录；更新为重试 upsert 既有原件所需）');

-- ========== 7. 表级 GRANT ==========
SELECT is(has_table_privilege('authenticated', 'public.import_tasks', 'INSERT'), true,
  '090: authenticated 可插 import_tasks');
SELECT is(has_table_privilege('authenticated', 'public.import_files', 'UPDATE'), true,
  '090: authenticated 可更新 import_files');

SELECT * FROM finish();
ROLLBACK;
