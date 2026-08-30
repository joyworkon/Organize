-- 062 恢复丢数据修复 pgTAP（P2-03 恢复演练）
-- 覆盖：restore_backup_v2_full 恢复笔记页面字段（icon/cover_url/cover_position/
-- parent_note_id 层级）、synced_blocks、db_databases/db_rows；counts 报告；
-- 属主隔离；老备份（无这些键/页面字段）仍兼容。
BEGIN;
SELECT plan(15);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('62300001-0000-0000-0000-000000000001', 'r62_a@test'),
    ('62300002-0000-0000-0000-000000000002', 'r62_b@test'),
    ('62300003-0000-0000-0000-000000000003', 'r62_c@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ========== 1. 空账户恢复含页面字段 + 同步区块 + 数据库块的 payload ==========
set role authenticated;
set request.jwt.claim.sub to '62300001-0000-0000-0000-000000000001';

create temp table r62_result as
select restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', '[]'::jsonb,
      'notes', jsonb_build_array(
        jsonb_build_object(
          'id', '62310000-0000-0000-0000-000000000001',
          'title', '父页', 'content', '{"type":"doc","content":[]}'::jsonb,
          'icon', '🗂', 'cover_url', 'https://example.com/cover.png',
          'cover_position', 30,
          'is_pinned', false, 'full_width', false,
          'font_family', 'default', 'small_font', false,
          'created_at', now(), 'updated_at', now()
        ),
        jsonb_build_object(
          'id', '62310000-0000-0000-0000-000000000002',
          'title', '子页',
          'content', '{"type":"doc","content":[{"type":"syncedBlock","attrs":{"syncedId":"62320000-0000-0000-0000-000000000001"}}]}'::jsonb,
          'parent_note_id', '62310000-0000-0000-0000-000000000001',
          'is_pinned', false,
          'created_at', now(), 'updated_at', now()
        )
      ),
      'tags', '[]'::jsonb,
      'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
      'tasks', '[]'::jsonb, 'task_dependencies', '[]'::jsonb,
      'task_checklists', '[]'::jsonb, 'task_tags', '[]'::jsonb,
      'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
      'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb,
      'note_versions', '[]'::jsonb,
      'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
      'note_suggestions', '[]'::jsonb,
      'synced_blocks', jsonb_build_array(jsonb_build_object(
        'id', '62320000-0000-0000-0000-000000000001',
        'content', '[{"type":"paragraph"}]'::jsonb,
        'created_at', now(), 'updated_at', now()
      )),
      'db_databases', jsonb_build_array(jsonb_build_object(
        'id', '62330000-0000-0000-0000-000000000001',
        'parent_note_id', '62310000-0000-0000-0000-000000000001',
        'title', '演练库',
        'schema', '[{"id":"p1","name":"名称","type":"text"}]'::jsonb,
        'views', '[{"id":"v1","type":"table","config":{}}]'::jsonb,
        'created_at', now(), 'updated_at', now()
      )),
      'db_rows', jsonb_build_array(
        jsonb_build_object(
          'id', '62340000-0000-0000-0000-000000000001',
          'database_id', '62330000-0000-0000-0000-000000000001',
          'sort', 0, 'values', '{"p1":"第一行"}'::jsonb,
          'created_at', now(), 'updated_at', now()
        ),
        jsonb_build_object(
          'id', '62340000-0000-0000-0000-000000000002',
          'database_id', '62330000-0000-0000-0000-000000000001',
          'sort', 1, 'values', '{"p1":"第二行"}'::jsonb,
          'created_at', now(), 'updated_at', now()
        )
      ),
      'task_lists', '[]'::jsonb, 'task_reminders', '[]'::jsonb,
      'task_attachments', '[]'::jsonb, 'task_activities', '[]'::jsonb,
      'task_templates', '[]'::jsonb, 'countdown_days', '[]'::jsonb,
      'memos', '[]'::jsonb, 'task_item_refs', '[]'::jsonb
    )
  )) as result;

SELECT is(
  (SELECT result->>'status' FROM r62_result),
  'restored',
  '含页面字段与区块数据的 payload 整体恢复成功'
);

SELECT is(
  (SELECT parent_note_id FROM notes
   WHERE user_id = '62300001-0000-0000-0000-000000000001' AND title = '子页'),
  '62310000-0000-0000-0000-000000000001'::uuid,
  '笔记父子层级在恢复后保留'
);

SELECT is(
  (SELECT icon FROM notes
   WHERE user_id = '62300001-0000-0000-0000-000000000001' AND title = '父页'),
  '🗂',
  '笔记图标在恢复后保留'
);

SELECT is(
  (SELECT row(cover_url, cover_position)::text FROM notes
   WHERE user_id = '62300001-0000-0000-0000-000000000001' AND title = '父页'),
  row('https://example.com/cover.png', 30)::text,
  '封面 URL 与位置在恢复后保留'
);

SELECT is(
  (SELECT count(*) FROM synced_blocks
   WHERE user_id = '62300001-0000-0000-0000-000000000001'
     AND id = '62320000-0000-0000-0000-000000000001'
     AND content = '[{"type":"paragraph"}]'::jsonb),
  1::bigint,
  'synced_blocks 随恢复落库（正文引用不断链）'
);

SELECT is(
  (SELECT parent_note_id FROM db_databases
   WHERE user_id = '62300001-0000-0000-0000-000000000001' AND title = '演练库'),
  '62310000-0000-0000-0000-000000000001'::uuid,
  'db_databases 恢复且挂在原父笔记下'
);

SELECT is(
  (SELECT count(*) FROM db_rows
   WHERE user_id = '62300001-0000-0000-0000-000000000001'
     AND database_id = '62330000-0000-0000-0000-000000000001'),
  2::bigint,
  'db_rows 全量恢复并挂在正确的库下'
);

SELECT is(
  (SELECT "values"->>'p1' FROM db_rows
   WHERE id = '62340000-0000-0000-0000-000000000002'),
  '第二行',
  'db_rows 行数据（values）原样恢复'
);

SELECT is(
  (SELECT result->'counts'->>'synced_blocks' FROM r62_result), '1',
  'counts.synced_blocks 与实际写入一致'
);
SELECT is(
  (SELECT result->'counts'->>'db_databases' FROM r62_result), '1',
  'counts.db_databases 与实际写入一致'
);
SELECT is(
  (SELECT result->'counts'->>'db_rows' FROM r62_result), '2',
  'counts.db_rows 与实际写入一致'
);

SELECT is(
  (SELECT count(*) FROM synced_blocks
   WHERE user_id <> '62300001-0000-0000-0000-000000000001')
  + (SELECT count(*) FROM db_databases
   WHERE user_id <> '62300001-0000-0000-0000-000000000001'),
  0::bigint,
  '区块数据不会写到他人账户（属主隔离）'
);

-- ========== 2. 老备份（无区块键、笔记无页面字段）兼容 ==========
set request.jwt.claim.sub to '62300003-0000-0000-0000-000000000003';

create temp table r62_legacy as
select restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', '[]'::jsonb,
      'notes', jsonb_build_array(jsonb_build_object(
        'id', '62310000-0000-0000-0000-000000000003',
        'title', '老笔记', 'content', '{"type":"doc","content":[]}'::jsonb,
        'is_pinned', false,
        'created_at', now(), 'updated_at', now()
      )),
      'tags', '[]'::jsonb,
      'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
      'tasks', '[]'::jsonb, 'task_dependencies', '[]'::jsonb,
      'task_checklists', '[]'::jsonb, 'task_tags', '[]'::jsonb,
      'lessons', '[]'::jsonb, 'lesson_tags', '[]'::jsonb,
      'highlights', '[]'::jsonb, 'favorites', '[]'::jsonb,
      'note_versions', '[]'::jsonb,
      'note_comment_threads', '[]'::jsonb, 'note_comments', '[]'::jsonb,
      'note_suggestions', '[]'::jsonb
      -- 故意不含 synced_blocks / db_databases / db_rows / 任务工作台键
    )
  )) as result;

SELECT is(
  (SELECT result->>'status' FROM r62_legacy),
  'restored',
  '老备份（缺区块键与页面字段）恢复不受影响'
);

SELECT is(
  (SELECT result->'counts'->>'synced_blocks' FROM r62_legacy), '0',
  '老备份恢复的 counts.synced_blocks 为 0'
);

SELECT is(
  (SELECT cover_position FROM notes
   WHERE user_id = '62300003-0000-0000-0000-000000000003' AND title = '老笔记'),
  50::smallint,
  '老备份笔记的封面位置回填为默认值 50'
);

reset role;
SELECT * FROM finish();
ROLLBACK;
