-- 066 协作者归属列 notes.last_edit_by pgTAP
--
-- 覆盖（与 066 文件头的承诺一一对应）：
--   1. 结构：列存在、类型 uuid；v1 / v2 的函数体都写 last_edit_by
--   2. 属主 v1 保存 → 归属 = 属主
--   3. editor v2 保存 → 归属 = 协作者（调用者），而行的 user_id 仍是属主
--      ——「谁编辑的」与「这行是谁的」是两个维度，这正是本列存在的意义
--   4. viewer 保存被拒 → 归属不变
--   5. 乐观锁冲突 → 归属不变
--   6. 幂等重放命中缓存 → revision 与归属都不再推进
--   7. 匿名拒绝
--
-- 约定同 063/064/065：断言不依赖表级 GRANT 错误文案；ACL 以 postgres 直插
--（本文件不测 grant_resource，063 已覆盖）；「先读后调」不放进同一个表达式。
BEGIN;
SELECT plan(19);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('66000001-0000-0000-0000-000000000001', 'p6_edit_a@test', '{"full_name":"A 全名"}'),
    ('66000002-0000-0000-0000-000000000002', 'p6_edit_b@test', '{"full_name":"B 全名"}'),
    ('66000003-0000-0000-0000-000000000003', 'p6_edit_c@test', '{"full_name":"C 全名"}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- W1: A owner、B member（editor 授权走它）；W2: C owner、A member（viewer 授权走它）
INSERT INTO public.workspaces (id, name, kind, owner_id) VALUES
  ('66010000-0000-0000-0000-000000000001', 'EDIT-W1', 'team', '66000001-0000-0000-0000-000000000001'),
  ('66010000-0000-0000-0000-000000000002', 'EDIT-W2', 'team', '66000003-0000-0000-0000-000000000003');

INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('66010000-0000-0000-0000-000000000001', '66000001-0000-0000-0000-000000000001', 'owner'),
  ('66010000-0000-0000-0000-000000000001', '66000002-0000-0000-0000-000000000002', 'member'),
  ('66010000-0000-0000-0000-000000000002', '66000003-0000-0000-0000-000000000003', 'owner'),
  ('66010000-0000-0000-0000-000000000002', '66000001-0000-0000-0000-000000000001', 'member');

-- N1：A 的笔记；对 W1 = editor（B），对 W2 = viewer（C）
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('66020000-0000-0000-0000-000000000001', '66000001-0000-0000-0000-000000000001',
   'A的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}');

INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('66010000-0000-0000-0000-000000000001', 'note', '66020000-0000-0000-0000-000000000001', 'editor',
   '66000001-0000-0000-0000-000000000001'),
  ('66010000-0000-0000-0000-000000000002', 'note', '66020000-0000-0000-0000-000000000001', 'viewer',
   '66000001-0000-0000-0000-000000000001');

-- ========== 1. 结构 ==========
SELECT has_column('public', 'notes', 'last_edit_by',
  'notes 有归属列 last_edit_by（065 的 hasnt_column 钉子已按计划翻转）');
SELECT col_type_is('public', 'notes', 'last_edit_by', 'uuid',
  'last_edit_by 是 uuid');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'save_note_with_tasks' LIMIT 1)
  LIKE '%last_edit_by = v_user%', 'v1（051 重述）写入归属');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'save_note_with_tasks_v2' LIMIT 1)
  LIKE '%last_edit_by = v_user%', 'v2（065 重述）写入归属');

-- ========== 2. 初值：NULL 是诚实值（不回填、创建不造归属）==========
SELECT is((SELECT last_edit_by FROM public.notes
    WHERE id = '66020000-0000-0000-0000-000000000001')::text, NULL,
  '列引入前的行归属为 NULL（不假造「属主编辑过」）');

-- ========== 3. 属主 v1：归属 = 属主 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '66000001-0000-0000-0000-000000000001';  -- A
SELECT is((public.save_note_with_tasks(
    p_note_id := '66020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := 0)->>'status',
  'ok', '属主 v1 保存成功'));
RESET ROLE;
SELECT is((SELECT last_edit_by FROM public.notes
    WHERE id = '66020000-0000-0000-0000-000000000001')::text,
  '66000001-0000-0000-0000-000000000001', 'v1 保存后归属 = 属主 A');

-- ========== 4. editor v2：归属 = 协作者，属主行不被搬走 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '66000002-0000-0000-0000-000000000002';  -- B
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '66020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"heading","attrs":{"level":2}}]}'::jsonb,
    p_expected_note_revision := 1)->>'status',
  'ok', 'editor B 的 v2 保存成功'));
RESET ROLE;
SELECT is((SELECT last_edit_by FROM public.notes
    WHERE id = '66020000-0000-0000-0000-000000000001')::text,
  '66000002-0000-0000-0000-000000000002', 'v2 保存后归属 = 协作者 B（调用者）');
SELECT is((SELECT user_id FROM public.notes
    WHERE id = '66020000-0000-0000-0000-000000000001')::text,
  '66000001-0000-0000-0000-000000000001', '行的属主仍是 A（归属列不动属主权）');
SELECT is((SELECT content_revision FROM public.notes
    WHERE id = '66020000-0000-0000-0000-000000000001')::text, '2',
  'revision 正常推进到 2');

-- ========== 5. viewer 与冲突都不改归属 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '66000003-0000-0000-0000-000000000003';  -- C（W2 viewer）
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '66020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := 2)->>'status',
  'forbidden', 'viewer C 存不进'));
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub TO '66000001-0000-0000-0000-000000000001';  -- A（stale revision）
SELECT is((public.save_note_with_tasks(
    p_note_id := '66020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := 0)->>'status',
  'conflict_note', '属主旧 revision 撞乐观锁'));
RESET ROLE;
SELECT is((SELECT last_edit_by FROM public.notes
    WHERE id = '66020000-0000-0000-0000-000000000001')::text,
  '66000002-0000-0000-0000-000000000002', '被拒的调用不碰归属（仍 = B）');

-- ========== 6. 幂等重放不再推进任何东西 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '66000001-0000-0000-0000-000000000001';  -- A
SELECT is((public.save_note_with_tasks(
    p_note_id := '66020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := 2,
    p_mutation_id := '66080000-0000-0000-0000-000000000001')->>'status',
  'ok', 'A 带幂等键的真实保存成功'));
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub TO '66000001-0000-0000-0000-000000000001';  -- A
SELECT is((public.save_note_with_tasks(
    p_note_id := '66020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := 2,
    p_mutation_id := '66080000-0000-0000-0000-000000000001')->>'status',
  'ok', '同幂等键重放命中缓存'));
RESET ROLE;
SELECT is((SELECT content_revision FROM public.notes
    WHERE id = '66020000-0000-0000-0000-000000000001')::text, '3',
  '重放不再推进 revision');
SELECT is((SELECT last_edit_by FROM public.notes
    WHERE id = '66020000-0000-0000-0000-000000000001')::text,
  '66000001-0000-0000-0000-000000000001', '重放后归属不变（仍 = A）');

-- ========== 7. 匿名拒绝 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '';
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '66020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 3)->>'status',
  'forbidden', '匿名（auth.uid() 为空）直接 forbidden'));
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
