-- 058 备份恢复 v4 pgTAP（P0-04）
-- 覆盖：restore_backup_v2_full 恢复 memos 与 task_item_refs（双账号 + 属主正确）；
-- 非空账户拒绝（not_empty，整链语义不变）；v3 老 payload（缺两表键）仍可恢复。
BEGIN;
SELECT plan(10);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('48300001-0000-0000-0000-000000000001', 'p04_a@test'),
    ('48300002-0000-0000-0000-000000000002', 'p04_b@test'),
    ('48300003-0000-0000-0000-000000000003', 'p04_c@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 用户 A 的既有数据（模拟「导出源」；恢复 payload 里的 ID 由本测试直接给出）
INSERT INTO tasks (id, user_id, title) VALUES
  ('48310000-0000-0000-0000-000000000001', '48300001-0000-0000-0000-000000000001', 'A的任务');
INSERT INTO notes (id, user_id, title, content) VALUES
  ('48320000-0000-0000-0000-000000000001', '48300001-0000-0000-0000-000000000001',
   'A的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb);

-- ========== 1. B（空账户）恢复含 memos/task_item_refs 的 v4 payload ==========
set role authenticated;
set request.jwt.claim.sub to '48300002-0000-0000-0000-000000000002';

create temp table p04_restore_result as
select restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', '[]'::jsonb,
      'notes', jsonb_build_array(jsonb_build_object(
        'id', '48320000-0000-0000-0000-000000000002',
        'title', '恢复的笔记',
        'content', '{"type":"doc","content":[{"type":"taskItem","attrs":{"taskId":"48310000-0000-0000-0000-000000000002"}}]}'::jsonb,
        'created_at', now(), 'updated_at', now()
      )),
      'tags', '[]'::jsonb,
      'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
      'tasks', jsonb_build_array(jsonb_build_object(
        'id', '48310000-0000-0000-0000-000000000002',
        'title', '恢复的任务',
        'status', 'todo', 'priority', 'medium', 'category', 'work',
        'is_pinned', false,
        'created_at', now(), 'updated_at', now()
      )),
      'task_dependencies', '[]'::jsonb,
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
      'memos', jsonb_build_array(jsonb_build_object(
        'id', '48330000-0000-0000-0000-000000000002',
        'content', '恢复的速记 #测试',
        'tags', '{"测试"}'::text[],
        'created_at', now(), 'updated_at', now()
      )),
      'task_item_refs', jsonb_build_array(jsonb_build_object(
        'id', '48340000-0000-0000-0000-000000000002',
        'task_id', '48310000-0000-0000-0000-000000000002',
        'note_id', '48320000-0000-0000-0000-000000000002',
        'block_id', 'blk-1',
        'created_at', now()
      ))
    )
  )) as result;

SELECT is(
  (SELECT result->>'status' FROM p04_restore_result),
  'restored',
  '空账户恢复 v4 payload（含 memos/task_item_refs）整体成功'
);

SELECT is(
  (SELECT count(*) FROM memos
   WHERE user_id = '48300002-0000-0000-0000-000000000002'
     AND content = '恢复的速记 #测试' AND tags = '{"测试"}'::text[]),
  1::bigint,
  'memos 按属主与内容落库'
);

SELECT is(
  (SELECT count(*) FROM task_item_refs
   WHERE user_id = '48300002-0000-0000-0000-000000000002'
     AND task_id = '48310000-0000-0000-0000-000000000002'
     AND note_id = '48320000-0000-0000-0000-000000000002'
     AND block_id = 'blk-1'),
  1::bigint,
  'task_item_refs 按属主与引用关系落库'
);

SELECT is(
  (SELECT count(*) FROM task_item_refs
   WHERE user_id = '48300002-0000-0000-0000-000000000002'
     AND task_id = '48310000-0000-0000-0000-000000000001'),
  0::bigint,
  '不会把引用挂到他人（A）的任务上（同租户约束 + 属主写入）'
);

-- counts 报告包含两张新表（与实际写入一致）
SELECT is(
  (SELECT result->'counts'->>'memos' FROM p04_restore_result),
  '1',
  'counts.memos 与实际写入一致'
);
SELECT is(
  (SELECT result->'counts'->>'task_item_refs' FROM p04_restore_result),
  '1',
  'counts.task_item_refs 与实际写入一致'
);

-- ========== 2. 非空账户拒绝 ==========
SELECT is(
  (restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', '[]'::jsonb, 'notes', '[]'::jsonb, 'tags', '[]'::jsonb,
      'memos', jsonb_build_array(jsonb_build_object(
        'id', '48330000-0000-0000-0000-000000000003',
        'content', '不应恢复', 'tags', '{}'::text[],
        'created_at', now(), 'updated_at', now()
      ))
    )
  )) ->> 'status'),
  'not_empty',
  '非空账户恢复被整体拒绝（不写入 memos）'
);

SELECT is(
  (SELECT count(*) FROM memos WHERE content = '不应恢复'),
  0::bigint,
  '被拒绝的恢复没有留下任何写入'
);

-- ========== 3. v3 老 payload（缺 memos/task_item_refs 键）仍可完成 ==========
set request.jwt.claim.sub to '48300003-0000-0000-0000-000000000003';

SELECT is(
  (restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', '[]'::jsonb, 'notes', '[]'::jsonb, 'tags', '[]'::jsonb,
      'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb, 'tasks', '[]'::jsonb,
      'task_dependencies', '[]'::jsonb, 'task_checklists', '[]'::jsonb,
      'task_tags', '[]'::jsonb, 'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
      'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb, 'note_versions', '[]'::jsonb,
      'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
      'note_suggestions', '[]'::jsonb, 'synced_blocks', '[]'::jsonb,
      'db_databases', '[]'::jsonb, 'db_rows', '[]'::jsonb,
      'task_lists', '[]'::jsonb, 'task_reminders', '[]'::jsonb,
      'task_attachments', '[]'::jsonb, 'task_activities', '[]'::jsonb,
      'task_templates', '[]'::jsonb, 'countdown_days', '[]'::jsonb
      -- 故意不含 memos / task_item_refs 键（v3 形状）
    )
  )) ->> 'status'),
  'restored',
  'v3 老 payload（缺新表键）coalesce 兜底后仍恢复成功'
);

SELECT is(
  (SELECT count(*) FROM memos WHERE user_id = '48300003-0000-0000-0000-000000000003'),
  0::bigint,
  'v3 恢复的 memos 为空（无中生有）'
);

reset role;
SELECT * FROM finish();
ROLLBACK;
