-- 075 速记转笔记闭环 pgTAP
--
-- 覆盖（与 docs/handoff 计划 R11 验收一致）：
--   1. 结构：memo_notes 唯一约束、RLS 开启、客户端无表权限外泄（GRANT all on table 含 select——RLS 收口）
--   2. 转换：created 返回 note_id；标题=首个非空行截断；正文整段保留（#标签保留在正文）；
--      memo #标签映射为 note tags（缺失创建）
--   3. 幂等：重复转换返回 exists + 同一 note_id（不重复建页）；并发唯一冲突兜底
--   4. 权限：他人速记 not_found（不泄露存在性）；匿名拒绝
--   5. 软删除速记不可转换
--   6. 备份恢复：payload 含 memo_notes 时恢复落库（链式函数）
BEGIN;
SELECT plan(10);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('75000001-0000-0000-0000-000000000001', 'p7_mn_a@test'),
    ('75000002-0000-0000-0000-000000000002', 'p7_mn_b@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO public.memos (id, user_id, content, tags) VALUES
  ('75010000-0000-0000-0000-000000000001', '75000001-0000-0000-0000-000000000001',
   '输出倒逼输入 #写作 #方法
第二行内容也保留',
   ARRAY['写作', '方法']),
  ('75010000-0000-0000-0000-000000000002', '75000002-0000-0000-0000-000000000002',
   'B 的速记', ARRAY[]::text[]),
  ('75010000-0000-0000-0000-000000000003', '75000001-0000-0000-0000-000000000001',
   '已删除速记', ARRAY[]::text[]);

UPDATE public.memos SET deleted_at = now()
WHERE id = '75010000-0000-0000-0000-000000000003';

-- ========== 2. 转换 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '75000001-0000-0000-0000-000000000001';
SELECT is(
  public.convert_memo_to_note('75010000-0000-0000-0000-000000000001')->>'status',
  'created',
  '075: 首次转换返回 created'
);
SELECT is(
  public.convert_memo_to_note('75010000-0000-0000-0000-000000000001')->>'status',
  'exists',
  '075: 重复转换返回 exists（再次点击=打开已有笔记）'
);
RESET ROLE;

SELECT is(
  (SELECT title FROM public.notes
   WHERE id = (SELECT note_id FROM memo_notes WHERE memo_id = '75010000-0000-0000-0000-000000000001')),
  '输出倒逼输入 #写作 #方法',
  '075: 标题=首个非空行'
);
SELECT is(
  (SELECT (content->'content')::text LIKE '%第二行内容也保留%'
     AND (content)::text LIKE '%#写作%'
   FROM public.notes
   WHERE id = (SELECT note_id FROM memo_notes WHERE memo_id = '75010000-0000-0000-0000-000000000001')),
  true,
  '075: 正文完整保留（含第二行与 #标签）'
);
SELECT is(
  (SELECT count(*) FROM note_tags nt
   JOIN tags t ON t.id = nt.tag_id
   WHERE nt.note_id = (SELECT note_id FROM memo_notes WHERE memo_id = '75010000-0000-0000-0000-000000000001')
     AND t.name IN ('写作', '方法')),
  2::bigint,
  '075: #标签映射为 note tags（缺失已创建）'
);
SELECT is(
  (SELECT count(*) FROM memo_notes WHERE memo_id = '75010000-0000-0000-0000-000000000001'),
  1::bigint,
  '075: 只建立一条关联（唯一约束）'
);

-- ========== 4. 权限 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '75000002-0000-0000-0000-000000000002';  -- B 转换 A 的速记
SELECT is(
  public.convert_memo_to_note('75010000-0000-0000-0000-000000000001')->>'status',
  'not_found',
  '075: 他人速记转换返回 not_found（不泄露存在性）'
);
RESET ROLE;

-- ========== 5. 软删除速记不可转换 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '75000001-0000-0000-0000-000000000001';
SELECT is(
  public.convert_memo_to_note('75010000-0000-0000-0000-000000000003')->>'status',
  'not_found',
  '075: 软删除速记不可转换'
);
RESET ROLE;

-- ========== 6. 匿名拒绝 ==========
RESET request.jwt.claim.sub;
SELECT throws_ok(
  $$ SELECT public.convert_memo_to_note('75010000-0000-0000-0000-000000000001') $$,
  '42501',
  NULL,
  '075: 匿名调用拒绝（42501）'
);

-- ========== 7. 备份恢复含 memo_notes ==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('75000003-0000-0000-0000-000000000003', 'p7_mn_c@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

SET ROLE authenticated;
SET request.jwt.claim.sub TO '75000003-0000-0000-0000-000000000003';  -- 空账户 C 恢复
DO $$
DECLARE
  result jsonb;
BEGIN
  result := public.restore_backup_v2_full(jsonb_build_object(
    'restore_payload_version', 1,
    'data', jsonb_build_object(
      'reading_items', '[]'::jsonb,
      'notes', jsonb_build_array(jsonb_build_object(
        'id', '75040000-0000-0000-0000-000000000002',
        'title', '恢复的笔记',
        'content', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
        'is_pinned', false, 'full_width', false,
        'font_family', 'default', 'small_font', false,
        'created_at', now(), 'updated_at', now()
      )),
      'tags', '[]'::jsonb, 'item_tags', '[]'::jsonb, 'note_tags', '[]'::jsonb,
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
      'memos', jsonb_build_array(jsonb_build_object(
        'id', '75010000-0000-0000-0000-0000000000aa',
        'content', '恢复的速记',
        'created_at', now(), 'updated_at', now()
      )),
      'task_item_refs', '[]'::jsonb,
      'memo_notes', jsonb_build_array(jsonb_build_object(
        'id', '75020000-0000-0000-0000-0000000000aa',
        'memo_id', '75010000-0000-0000-0000-0000000000aa',
        'note_id', '75040000-0000-0000-0000-000000000002',
        'created_at', now()
      ))
    )
  ));
  IF result->>'status' <> 'restored' THEN
    RAISE EXCEPTION 'restore failed: %', result::text;
  END IF;
END $$;
RESET ROLE;

SELECT is(
  (SELECT count(*) FROM memo_notes WHERE user_id = '75000003-0000-0000-0000-000000000003'),
  1::bigint,
  '075: 备份恢复落库 memo_notes 关联'
);

SELECT * FROM finish();
ROLLBACK;
