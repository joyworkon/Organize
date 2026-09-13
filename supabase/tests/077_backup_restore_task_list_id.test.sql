-- 077 备份恢复链补写 tasks.list_id pgTAP（B01）
--
-- 覆盖：
--   1. 空账户恢复携带 list_id 的 payload：任务落库后 list_id 指向恢复的 task_lists 行
--      （077 前 restore 链从不写 list_id——往返后任务全部脱列）
--   2. payload 不带 list_id 键（v4 及更早文件）恢复后 list_id 为 null
--   3. payload 携带不存在的 list_id → FK 违例整体失败（fail-closed，无部分写入）
--   4. parent_task_id 层级与循环预检保持 040 原语义（自引用拒绝）
BEGIN;
SELECT plan(9);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('77100001-0000-0000-0000-000000000001', 'p077_b@test'),
    ('77100002-0000-0000-0000-000000000002', 'p077_c@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ========== 1. 空账户 B 恢复带 list_id 的 payload ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '77100001-0000-0000-0000-000000000001';

CREATE TEMP TABLE p077_result AS
SELECT restore_backup_v2_full(jsonb_build_object(
  'restore_payload_version', 1,
  'data', jsonb_build_object(
    'reading_items', '[]'::jsonb,
    'notes', '[]'::jsonb,
    'tags', '[]'::jsonb,
    'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
    'tasks', jsonb_build_array(
      jsonb_build_object(
        'id', '77120000-0000-0000-0000-000000000001',
        'title', '列表任务',
        'status', 'todo', 'priority', 'high', 'category', 'work',
        'is_pinned', false, 'sort_order', 0,
        'list_id', '77130000-0000-0000-0000-000000000001',
        'created_at', now(), 'updated_at', now()
      ),
      jsonb_build_object(
        'id', '77120000-0000-0000-0000-000000000002',
        'title', '子任务',
        'status', 'todo', 'priority', 'medium', 'category', 'work',
        'is_pinned', false, 'sort_order', 1,
        'parent_task_id', '77120000-0000-0000-0000-000000000001',
        'created_at', now(), 'updated_at', now()
      )
    ),
    'task_dependencies', '[]'::jsonb,
    'task_checklists', '[]'::jsonb, 'task_tags', '[]'::jsonb,
    'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
    'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb,
    'note_versions', '[]'::jsonb,
    'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
    'note_suggestions', '[]'::jsonb,
    'synced_blocks', '[]'::jsonb,
    'db_databases', '[]'::jsonb, 'db_rows', '[]'::jsonb,
    'task_lists', jsonb_build_array(jsonb_build_object(
      'id', '77130000-0000-0000-0000-000000000001',
      'name', '工作', 'icon', null, 'color', null,
      'sort_order', 0, 'is_default', true,
      'created_at', now(), 'updated_at', now()
    )),
    'task_reminders', '[]'::jsonb, 'task_attachments', '[]'::jsonb,
    'task_activities', '[]'::jsonb, 'task_templates', '[]'::jsonb,
    'countdown_days', '[]'::jsonb,
    'memos', '[]'::jsonb, 'task_item_refs', '[]'::jsonb, 'memo_notes', '[]'::jsonb
  )
)) AS result;

RESET ROLE;

SELECT is((SELECT result->>'status' FROM p077_result), 'restored',
  '带 list_id 的 payload 恢复成功');
SELECT is((SELECT count(*)::integer FROM public.tasks
   WHERE user_id = '77100001-0000-0000-0000-000000000001'), 2,
  '两行任务落库');
SELECT is((SELECT t.list_id FROM public.tasks t
   WHERE t.user_id = '77100001-0000-0000-0000-000000000001'
     AND t.title = '列表任务'),
  '77130000-0000-0000-0000-000000000001'::uuid,
  'list_id 补写指向恢复的 task_lists 行（077 核心断言）');
SELECT is((SELECT t.list_id FROM public.tasks t
   WHERE t.user_id = '77100001-0000-0000-0000-000000000001'
     AND t.title = '子任务'), NULL,
  'payload 无 list_id 键的任务保持 null（旧文件兼容）');
SELECT is((SELECT t.parent_task_id FROM public.tasks t
   WHERE t.user_id = '77100001-0000-0000-0000-000000000001'
     AND t.title = '子任务'),
  '77120000-0000-0000-0000-000000000001'::uuid,
  'parent_task_id 层级保持 040 语义');

-- ========== 2. 携带不存在的 list_id → FK 违例整体失败 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '77100002-0000-0000-0000-000000000002';
SELECT throws_ok(
  $$SELECT restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', '[]'::jsonb, 'notes', '[]'::jsonb, 'tags', '[]'::jsonb,
      'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
      'tasks', jsonb_build_array(jsonb_build_object(
        'id', '77120000-0000-0000-0000-000000000011',
        'title', '悬空列表任务',
        'status', 'todo', 'priority', 'high', 'category', 'work',
        'is_pinned', false, 'sort_order', 0,
        'list_id', '7713ffff-0000-0000-0000-000000000099',
        'created_at', now(), 'updated_at', now()
      )),
      'task_dependencies', '[]'::jsonb, 'task_checklists', '[]'::jsonb,
      'task_tags', '[]'::jsonb, 'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
      'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb, 'note_versions', '[]'::jsonb,
      'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
      'note_suggestions', '[]'::jsonb, 'synced_blocks', '[]'::jsonb,
      'db_databases', '[]'::jsonb, 'db_rows', '[]'::jsonb,
      'task_lists', '[]'::jsonb, 'task_reminders', '[]'::jsonb,
      'task_attachments', '[]'::jsonb, 'task_activities', '[]'::jsonb,
      'task_templates', '[]'::jsonb, 'countdown_days', '[]'::jsonb,
      'memos', '[]'::jsonb, 'task_item_refs', '[]'::jsonb, 'memo_notes', '[]'::jsonb
    )
  ))$$,
  NULL, '悬空 list_id 触发 FK 违例，恢复整体失败（fail-closed）');
RESET ROLE;

-- 整体失败不留部分写入：C 的任务行不存在
SELECT is((SELECT count(*)::integer FROM public.tasks
   WHERE user_id = '77100002-0000-0000-0000-000000000002'), 0,
  '失败的恢复不留下部分写入');

-- ========== 3. 自引用 parent_task_id 预检保持 040 语义 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '77100002-0000-0000-0000-000000000002';
SELECT throws_ok(
  $$SELECT restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', '[]'::jsonb, 'notes', '[]'::jsonb, 'tags', '[]'::jsonb,
      'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
      'tasks', jsonb_build_array(jsonb_build_object(
        'id', '77120000-0000-0000-0000-000000000021',
        'title', '自引用任务',
        'status', 'todo', 'priority', 'high', 'category', 'work',
        'is_pinned', false, 'sort_order', 0,
        'parent_task_id', '77120000-0000-0000-0000-000000000021',
        'created_at', now(), 'updated_at', now()
      )),
      'task_dependencies', '[]'::jsonb, 'task_checklists', '[]'::jsonb,
      'task_tags', '[]'::jsonb, 'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
      'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb, 'note_versions', '[]'::jsonb,
      'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
      'note_suggestions', '[]'::jsonb, 'synced_blocks', '[]'::jsonb,
      'db_databases', '[]'::jsonb, 'db_rows', '[]'::jsonb,
      'task_lists', '[]'::jsonb, 'task_reminders', '[]'::jsonb,
      'task_attachments', '[]'::jsonb, 'task_activities', '[]'::jsonb,
      'task_templates', '[]'::jsonb, 'countdown_days', '[]'::jsonb,
      'memos', '[]'::jsonb, 'task_item_refs', '[]'::jsonb, 'memo_notes', '[]'::jsonb
    )
  ))$$,
  NULL, '自引用 parent_task_id 预检拒绝（040 语义不变）');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.tasks
   WHERE user_id = '77100002-0000-0000-0000-000000000002'), 0,
  '预检拒绝同样不留部分写入');

SELECT * FROM finish();
ROLLBACK;
