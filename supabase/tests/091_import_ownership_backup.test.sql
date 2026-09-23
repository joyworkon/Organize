-- 091 数据归属约束 + 孤儿资产回收 + 备份恢复链 v7 pgTAP（阶段 2）
--
-- 覆盖：
--   1. 跨用户关联不可能（DB 层复合外键）：B 知道 A 的 task_id / reading_item_id
--      也无法把自己的导入行挂到 A 的任务/条目上
--   2. 同用户关联不受影响；阅读条目删除只置空 reading_item_id（user_id 保持）
--   3. 任务删除级联清理文件行，且 import-files 桶内资产对象被触发器一并回收（孤儿=0）
--   4. restore_backup_v2_full（v7）：B 恢复含 import_tasks/import_files 的 payload，
--      属主统一落 B、counts 如实；A（非空）被拒；v6 老 payload（缺两表键）仍可恢复
--   5. 恢复函数权限口径与 087 一致（Supabase 默认 EXECUTE 之下保证 authenticated 可用）

BEGIN;
SELECT plan(17);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('91000001-0000-0000-0000-000000000001', 'p91_a@test', '{}'),
    ('91000002-0000-0000-0000-000000000002', 'p91_b@test', '{}'),
    ('91000003-0000-0000-0000-000000000003', 'p91_c@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- A：阅读条目 + 任务 + 文件行（行内已关联 A 自己的条目；路径 = API 层 {uid}/{taskId}/{rowId} 约定）
INSERT INTO public.reading_items (id, user_id, url, title, content, reading_status) VALUES
  ('91000000-0000-0000-0000-0000000000b1', '91000001-0000-0000-0000-000000000001',
   'urn:organize:import:p91', 'A 的条目', '<p>正文</p>', 'unread');
INSERT INTO public.import_tasks (id, user_id, status) VALUES
  ('91000000-0000-0000-0000-0000000000a1', '91000001-0000-0000-0000-000000000001', 'processing');
INSERT INTO public.import_files
  (id, task_id, user_id, file_name, mime, size, kind, storage_path, status, retry_key, reading_item_id) VALUES
  ('91000000-0000-0000-0000-0000000000f1', '91000000-0000-0000-0000-0000000000a1',
   '91000001-0000-0000-0000-000000000001', '报告.pdf', 'application/pdf', 1024, 'pdf',
   '91000001-0000-0000-0000-000000000001/91000000-0000-0000-0000-0000000000a1/91000000-0000-0000-0000-0000000000f1.pdf',
   'saved', 'p91-retry-1', '91000000-0000-0000-0000-0000000000b1');

-- B 自己的任务（跨用户攻击实验的合法挂载点）
INSERT INTO public.import_tasks (id, user_id, status) VALUES
  ('91000000-0000-0000-0000-0000000000a2', '91000002-0000-0000-0000-000000000002', 'processing');

-- ========== 1. 跨用户关联不可能 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '91000002-0000-0000-0000-000000000002';  -- B

SELECT throws_ok(
  $$INSERT INTO public.import_files (task_id, file_name, kind, retry_key) VALUES
    ('91000000-0000-0000-0000-0000000000a1', '攻击.pdf', 'pdf', 'p91-atk-task')$$,
  'insert or update on table "import_files" violates foreign key constraint "import_files_task_id_user_id_fkey"',
  '091: B 知道 A 的 task_id 也不能建立跨用户任务关联（复合外键）');

SELECT throws_ok(
  $$INSERT INTO public.import_files
      (task_id, file_name, kind, retry_key, reading_item_id) VALUES
    ('91000000-0000-0000-0000-0000000000a2', '攻击.md', 'markdown', 'p91-atk-item',
     '91000000-0000-0000-0000-0000000000b1')$$,
  'insert or update on table "import_files" violates foreign key constraint "import_files_reading_item_id_user_id_fkey"',
  '091: B 知道 A 的阅读条目 id 也不能建立跨用户条目关联');

SELECT is((SELECT count(*) FROM public.import_files
  WHERE id = '91000000-0000-0000-0000-0000000000f1'), 0::bigint,
  '091: B 读不到 A 的文件行（RLS 行级隔离不回退）');
RESET ROLE;

-- ========== 2. 同用户关联不受影响；set null 语义 ==========
UPDATE public.import_files SET reading_item_id = '91000000-0000-0000-0000-0000000000b1'
  WHERE retry_key = 'p91-retry-1';
SELECT is((SELECT reading_item_id FROM public.import_files WHERE retry_key = 'p91-retry-1'),
  '91000000-0000-0000-0000-0000000000b1'::uuid,
  '091: 同用户条目关联仍可建立');

DELETE FROM public.reading_items WHERE id = '91000000-0000-0000-0000-0000000000b1';
SELECT is((SELECT reading_item_id IS NULL FROM public.import_files WHERE retry_key = 'p91-retry-1'),
  true, '091: 条目删除置空 reading_item_id');
SELECT is((SELECT user_id FROM public.import_files WHERE retry_key = 'p91-retry-1'),
  '91000001-0000-0000-0000-000000000001'::uuid,
  '091: 条目删除不动 user_id（列级 SET NULL，文件行保留）');

-- ========== 3. 任务删除级联 + 孤儿资产回收 ==========
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('import-files',
   '91000001-0000-0000-0000-000000000001/91000000-0000-0000-0000-0000000000a1/91000000-0000-0000-0000-0000000000f1.pdf'),
  ('import-files',
   '91000001-0000-0000-0000-000000000001/91000000-0000-0000-0000-0000000000a1/91000000-0000-0000-0000-0000000000f1-img1.png'),
  ('import-files', 'unrelated/keep-me.pdf');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id = 'import-files'
  AND name LIKE '%/91000000-0000-0000-0000-0000000000f1%'), 2::bigint,
  '091: 前置——该行名下两个对象（原件+嵌入图）');

DELETE FROM public.import_tasks WHERE id = '91000000-0000-0000-0000-0000000000a1';
SELECT is((SELECT count(*) FROM public.import_files
  WHERE task_id = '91000000-0000-0000-0000-0000000000a1'), 0::bigint,
  '091: 任务删除级联清理文件行');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id = 'import-files'
  AND name LIKE '%/91000000-0000-0000-0000-0000000000f1%'), 0::bigint,
  '091: 该行资产（原件+嵌入图）被触发器一并回收');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id = 'import-files'
  AND name = 'unrelated/keep-me.pdf'), 1::bigint,
  '091: 无关对象不被误删');

-- ========== 4. 恢复链 v7（双账号）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '91000002-0000-0000-0000-000000000002';  -- B

-- 清掉攻击实验用的任务，恢复后 counts 断言才干净
DELETE FROM public.import_tasks WHERE id = '91000000-0000-0000-0000-0000000000a2';

CREATE TEMP TABLE p91_restore_result AS
SELECT restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', jsonb_build_array(jsonb_build_object(
        'id', '91000000-0000-0000-0000-0000000000b2',
        'url', 'urn:organize:import:p91r', 'title', '恢复的条目',
        'content', '<p>正文</p>', 'excerpt', '', 'cover_image', null,
        'reading_status', 'unread', 'reading_progress', 0, 'is_pinned', false,
        'created_at', now(), 'updated_at', now()
      )),
      'notes', '[]'::jsonb, 'tags', '[]'::jsonb,
      'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
      'tasks', '[]'::jsonb, 'task_dependencies', '[]'::jsonb,
      'task_checklists', '[]'::jsonb, 'task_tags', '[]'::jsonb,
      'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
      'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb,
      'note_versions', '[]'::jsonb,
      'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
      'note_suggestions', '[]'::jsonb,
      'synced_blocks', '[]'::jsonb,
      'db_databases', '[]'::jsonb, 'db_rows', '[]'::jsonb,
      'task_lists', '[]'::jsonb, 'task_reminders', '[]'::jsonb,
      'task_attachments', '[]'::jsonb, 'task_activities', '[]'::jsonb,
      'task_templates', '[]'::jsonb, 'countdown_days', '[]'::jsonb,
      'memos', '[]'::jsonb, 'task_item_refs', '[]'::jsonb, 'memo_notes', '[]'::jsonb,
      'canvas_documents', '[]'::jsonb,
      'import_tasks', jsonb_build_array(jsonb_build_object(
        'id', '91000000-0000-0000-0000-0000000000a3',
        'status', 'saved', 'created_at', now(), 'updated_at', now()
      )),
      'import_files', jsonb_build_array(jsonb_build_object(
        'id', '91000000-0000-0000-0000-0000000000f2',
        'task_id', '91000000-0000-0000-0000-0000000000a3',
        'file_name', '恢复.pdf', 'mime', 'application/pdf', 'size', 2048, 'kind', 'pdf',
        'storage_path', '91000001-0000-0000-0000-000000000001/91000000-0000-0000-0000-0000000000a1/91000000-0000-0000-0000-0000000000f1.pdf',
        'status', 'saved', 'error', null,
        'reading_item_id', '91000000-0000-0000-0000-0000000000b2',
        'page_count', 12, 'retry_key', 'p91-restore-1',
        'created_at', now(), 'updated_at', now()
      ))
    )
  )) AS result;

SELECT is((SELECT result->>'status' FROM p91_restore_result), 'restored',
  '091: 空账户恢复 v7 payload（含 import 两表）成功');
SELECT is((SELECT result->'counts'->>'import_tasks' FROM p91_restore_result), '1',
  '091: counts.import_tasks 如实');
SELECT is((SELECT result->'counts'->>'import_files' FROM p91_restore_result), '1',
  '091: counts.import_files 如实');
SELECT is((SELECT count(*) FROM public.import_files
  WHERE id = '91000000-0000-0000-0000-0000000000f2'
    AND user_id = '91000002-0000-0000-0000-000000000002'
    AND task_id = '91000000-0000-0000-0000-0000000000a3'
    AND reading_item_id = '91000000-0000-0000-0000-0000000000b2'), 1::bigint,
  '091: 恢复的文件行属主统一为恢复者（B），关联完整');

-- 非空账户（A）恢复被拒：先给 A 补一条活跃阅读条目（前序用例已删光 A 的数据）
RESET ROLE;
INSERT INTO public.reading_items (id, user_id, url, title, content, reading_status) VALUES
  ('91000000-0000-0000-0000-0000000000b9', '91000001-0000-0000-0000-000000000001',
   'urn:organize:import:p91live', 'A 的在库条目', '<p>正文</p>', 'unread');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '91000001-0000-0000-0000-000000000001';  -- A
SELECT is((restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object('reading_items', '[]'::jsonb, 'notes', '[]'::jsonb,
      'tags', '[]'::jsonb, 'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
      'tasks', '[]'::jsonb, 'task_dependencies', '[]'::jsonb, 'task_checklists', '[]'::jsonb,
      'task_tags', '[]'::jsonb, 'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
      'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb, 'note_versions', '[]'::jsonb,
      'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
      'note_suggestions', '[]'::jsonb, 'synced_blocks', '[]'::jsonb,
      'db_databases', '[]'::jsonb, 'db_rows', '[]'::jsonb,
      'task_lists', '[]'::jsonb, 'task_reminders', '[]'::jsonb, 'task_attachments', '[]'::jsonb,
      'task_activities', '[]'::jsonb, 'task_templates', '[]'::jsonb, 'countdown_days', '[]'::jsonb,
      'memos', '[]'::jsonb, 'task_item_refs', '[]'::jsonb, 'memo_notes', '[]'::jsonb,
      'canvas_documents', '[]'::jsonb, 'import_tasks', '[]'::jsonb, 'import_files', '[]'::jsonb)
  )) ->> 'status'), 'not_empty',
  '091: 非空账户恢复被整体拒绝（双账号口径）');

-- v6 老 payload（缺 import 两表键）仍可恢复（C 空账户）
SET request.jwt.claim.sub TO '91000003-0000-0000-0000-000000000003';  -- C
SELECT is((restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object('reading_items', '[]'::jsonb, 'notes', '[]'::jsonb,
      'tags', '[]'::jsonb, 'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
      'tasks', '[]'::jsonb, 'task_dependencies', '[]'::jsonb, 'task_checklists', '[]'::jsonb,
      'task_tags', '[]'::jsonb, 'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
      'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb, 'note_versions', '[]'::jsonb,
      'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
      'note_suggestions', '[]'::jsonb, 'synced_blocks', '[]'::jsonb,
      'db_databases', '[]'::jsonb, 'db_rows', '[]'::jsonb,
      'task_lists', '[]'::jsonb, 'task_reminders', '[]'::jsonb, 'task_attachments', '[]'::jsonb,
      'task_activities', '[]'::jsonb, 'task_templates', '[]'::jsonb, 'countdown_days', '[]'::jsonb,
      'memos', '[]'::jsonb, 'task_item_refs', '[]'::jsonb, 'memo_notes', '[]'::jsonb,
      'canvas_documents', '[]'::jsonb)
  )) ->> 'status'), 'restored',
  '091: v6 老 payload（缺 import 两表键）仍可恢复');
RESET ROLE;

-- ========== 5. 恢复函数权限口径（与 087 一致：authenticated 可用）==========
SELECT is(has_function_privilege('authenticated', 'public.restore_backup_v2_full(jsonb)', 'EXECUTE'),
  true, '091: authenticated 有恢复函数 EXECUTE');

SELECT * FROM finish();
ROLLBACK;
