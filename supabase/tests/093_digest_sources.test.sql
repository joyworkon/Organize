-- 093 整理稿溯源 pgTAP（阶段 4）
--
-- 覆盖：
--   1. RLS：B 看不到 A 的溯源行；anon 直读被拒
--   2. 归属：B 知道 A 的整理稿 id 也挂不了溯源行（digest 复合外键）
--   3. hash 格式 check；来源类型 check；(digest, type, source) 唯一
--   4. 整理稿（reading_item）删除 cascade 清溯源行
--   5. 恢复链 v9：digest_sources 落库到恢复者名下、counts 如实

BEGIN;
SELECT plan(10);

DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('93000001-0000-0000-0000-000000000001', 'p93_a@test', '{}'),
    ('93000002-0000-0000-0000-000000000002', 'p93_b@test', '{}'),
    ('93000003-0000-0000-0000-000000000003', 'p93_c@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- A：整理稿（digest URN 的阅读条目）+ 溯源行
INSERT INTO public.reading_items (id, user_id, url, title, content, reading_status) VALUES
  ('93000000-0000-0000-0000-0000000000e1', '93000001-0000-0000-0000-000000000001',
   'urn:organize:digest:abc123', '主题整理稿', '<p>整理</p>', 'unread');
INSERT INTO public.digest_sources (id, digest_id, user_id, source_type, source_id, content_hash) VALUES
  ('93000000-0000-0000-0000-00000000001a', '93000000-0000-0000-0000-0000000000e1',
   '93000001-0000-0000-0000-000000000001', 'reading', '93000000-0000-0000-0000-0000000000b1',
   repeat('a', 64));

-- ========== 1/2. RLS 与归属 ==========
SET ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.digest_sources$$,
  'permission denied for table digest_sources', '093: anon 直读被拒');
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub TO '93000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.digest_sources), 0::bigint,
  '093: B 看不到 A 的溯源行');
SELECT throws_ok(
  $$INSERT INTO public.digest_sources (digest_id, source_type, source_id, content_hash) VALUES
    ('93000000-0000-0000-0000-0000000000e1', 'reading', '93000000-0000-0000-0000-0000000000c1',
     repeat('b', 64))$$,
  'insert or update on table "digest_sources" violates foreign key constraint "digest_sources_digest_id_user_id_fkey"',
  '093: B 知道 A 的整理稿 id 也挂不了溯源行');

-- ========== 3. check 约束 ==========
SET request.jwt.claim.sub TO '93000001-0000-0000-0000-000000000001';  -- A
SELECT throws_ok(
  $$INSERT INTO public.digest_sources (digest_id, source_type, source_id, content_hash) VALUES
    ('93000000-0000-0000-0000-0000000000e1', 'video', '93000000-0000-0000-0000-0000000000b1',
     repeat('a', 64))$$,
  'new row for relation "digest_sources" violates check constraint "digest_sources_source_type_check"',
  '093: 非法来源类型被拒');
SELECT throws_ok(
  $$INSERT INTO public.digest_sources (digest_id, source_type, source_id, content_hash) VALUES
    ('93000000-0000-0000-0000-0000000000e1', 'memo', '93000000-0000-0000-0000-0000000000b1',
     'not-a-hash')$$,
  'new row for relation "digest_sources" violates check constraint "digest_sources_content_hash_check"',
  '093: 非 sha256 hash 被拒');
SELECT throws_ok(
  $$INSERT INTO public.digest_sources (digest_id, source_type, source_id, content_hash) VALUES
    ('93000000-0000-0000-0000-0000000000e1', 'reading', '93000000-0000-0000-0000-0000000000b1',
     repeat('a', 64))$$,
  'duplicate key value violates unique constraint "digest_sources_digest_id_source_type_source_id_key"',
  '093: 同整理稿同来源重复溯源被拒（幂等）');
RESET ROLE;

-- ========== 4. 级联 ==========
DELETE FROM public.reading_items WHERE id = '93000000-0000-0000-0000-0000000000e1';
SELECT is((SELECT count(*) FROM public.digest_sources
  WHERE digest_id = '93000000-0000-0000-0000-0000000000e1'), 0::bigint,
  '093: 整理稿删除 cascade 清溯源行');

-- ========== 5. 恢复链 v9 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '93000002-0000-0000-0000-000000000002';  -- B（空账户）

CREATE TEMP TABLE p93_restore AS
SELECT restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', jsonb_build_array(jsonb_build_object(
        'id', '93000000-0000-0000-0000-0000000000e2',
        'url', 'urn:organize:digest:def456', 'title', 'B 恢复的整理稿',
        'content', '<p>整理</p>', 'excerpt', '', 'cover_image', null,
        'reading_status', 'unread', 'reading_progress', 0, 'is_pinned', false,
        'created_at', now(), 'updated_at', now()
      )),
      'notes', '[]'::jsonb, 'tags', '[]'::jsonb,
      'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
      'tasks', '[]'::jsonb, 'task_dependencies', '[]'::jsonb, 'task_checklists', '[]'::jsonb,
      'task_tags', '[]'::jsonb, 'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
      'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb, 'note_versions', '[]'::jsonb,
      'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
      'note_suggestions', '[]'::jsonb, 'synced_blocks', '[]'::jsonb,
      'db_databases', '[]'::jsonb, 'db_rows', '[]'::jsonb,
      'task_lists', '[]'::jsonb, 'task_reminders', '[]'::jsonb, 'task_attachments', '[]'::jsonb,
      'task_activities', '[]'::jsonb, 'task_templates', '[]'::jsonb, 'countdown_days', '[]'::jsonb,
      'memos', '[]'::jsonb, 'task_item_refs', '[]'::jsonb, 'memo_notes', '[]'::jsonb,
      'canvas_documents', '[]'::jsonb, 'import_tasks', '[]'::jsonb, 'import_files', '[]'::jsonb,
      'collections', '[]'::jsonb, 'collection_items', '[]'::jsonb,
      'digest_sources', jsonb_build_array(jsonb_build_object(
        'id', '93000000-0000-0000-0000-00000000001b',
        'digest_id', '93000000-0000-0000-0000-0000000000e2',
        'source_type', 'memo', 'source_id', '93000000-0000-0000-0000-0000000000d9',
        'content_hash', repeat('c', 64), 'created_at', now()
      ))
    )
  )) AS result;

SELECT is((SELECT result->>'status' FROM p93_restore), 'restored',
  '093: 空账户恢复 v9 payload（含溯源表）成功');
SELECT is((SELECT result->'counts'->>'digest_sources' FROM p93_restore), '1',
  '093: counts.digest_sources 如实');
SELECT is((SELECT count(*) FROM public.digest_sources
  WHERE digest_id = '93000000-0000-0000-0000-0000000000e2'
    AND user_id = '93000002-0000-0000-0000-000000000002'), 1::bigint,
  '093: 溯源行属主统一为恢复者');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
