-- 067 笔记 CRDT blob 存储 pgTAP
--
-- 覆盖（与 067 文件头的承诺一一对应）：
--   1. 结构：表存在、ydoc 为 bytea、notes 级联删除、RLS 启用、客户端无直接表权限
--   2. EXECUTE 分层：authenticated 可调、anon 不可调（get/save 两侧）
--   3. 读矩阵：owner/editor/viewer 均可读；陌生人/匿名 null（不可区分）；无 blob 返回 null
--   4. 写矩阵：owner/editor 可写（upsert 覆盖）；viewer/陌生人 forbidden；匿名拒绝
--   5. 新鲜度：非协作写入（notes 行更新）后旧 blob 过期（get null），重新落库自愈
--   6. 边界：空 payload invalid_argument；超 4MB ydoc_too_large；软删后读写全拒；
--      硬删级联清行
--
-- 约定同 063/064/065/066：ACL 以 postgres 直插（本文件不测 grant_resource，063 已
-- 覆盖）；断言不依赖表级 GRANT 错误文案。
BEGIN;
SELECT plan(30);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('67000001-0000-0000-0000-000000000001', 'p7_ydoc_a@test', '{}'),
    ('67000002-0000-0000-0000-000000000002', 'p7_ydoc_b@test', '{}'),
    ('67000003-0000-0000-0000-000000000003', 'p7_ydoc_c@test', '{}'),
    ('67000004-0000-0000-0000-000000000004', 'p7_ydoc_d@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- W1: A owner、B member（editor 授权走它）；W2: C owner、A member（viewer 授权走它）
INSERT INTO public.workspaces (id, name, kind, owner_id) VALUES
  ('67010000-0000-0000-0000-000000000001', 'YDOC-W1', 'team', '67000001-0000-0000-0000-000000000001'),
  ('67010000-0000-0000-0000-000000000002', 'YDOC-W2', 'team', '67000003-0000-0000-0000-000000000003');

INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('67010000-0000-0000-0000-000000000001', '67000001-0000-0000-0000-000000000001', 'owner'),
  ('67010000-0000-0000-0000-000000000001', '67000002-0000-0000-0000-000000000002', 'member'),
  ('67010000-0000-0000-0000-000000000002', '67000003-0000-0000-0000-000000000003', 'owner'),
  ('67010000-0000-0000-0000-000000000002', '67000001-0000-0000-0000-000000000001', 'member');

-- N1：A 的笔记，对 W1 = editor（B）、对 W2 = viewer（C）；N2：A 的笔记，无授权无 blob
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('67020000-0000-0000-0000-000000000001', '67000001-0000-0000-0000-000000000001',
   'A的协作笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'),
  ('67020000-0000-0000-0000-000000000002', '67000001-0000-0000-0000-000000000001',
   'A的私有笔记', '{"type":"doc","content":[{"type":"paragraph"}]}');

INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('67010000-0000-0000-0000-000000000001', 'note', '67020000-0000-0000-0000-000000000001', 'editor',
   '67000001-0000-0000-0000-000000000001'),
  ('67010000-0000-0000-0000-000000000002', 'note', '67020000-0000-0000-0000-000000000001', 'viewer',
   '67000001-0000-0000-0000-000000000001');

-- ========== 1. 结构 ==========
SELECT has_table('public', 'note_ydocs', 'note_ydocs 表存在');
SELECT col_type_is('public', 'note_ydocs', 'ydoc', 'bytea', 'ydoc 是 bytea');
SELECT ok((SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.note_ydocs'::regclass
       AND confrelid = 'public.notes'::regclass
       AND contype = 'f' AND confdeltype = 'c')),
  'note_ydocs.note_id 外键级联 notes 硬删');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.note_ydocs'::regclass),
  'note_ydocs 启用 RLS');
SELECT is(has_table_privilege('authenticated', 'public.note_ydocs', 'SELECT'), false,
  'authenticated 无直接 SELECT');
SELECT is(has_table_privilege('authenticated', 'public.note_ydocs', 'INSERT'), false,
  'authenticated 无直接 INSERT（写只能走 RPC）');
SELECT is(has_table_privilege('anon', 'public.note_ydocs', 'SELECT'), false,
  'anon 无直接 SELECT');

-- ========== 2. EXECUTE 分层 ==========
SELECT is(has_function_privilege('authenticated', 'public.get_note_ydoc(uuid)', 'EXECUTE'), true,
  'authenticated 可调 get_note_ydoc');
SELECT is(has_function_privilege('anon', 'public.get_note_ydoc(uuid)', 'EXECUTE'), false,
  'anon 不可调 get_note_ydoc');
SELECT is(has_function_privilege('anon', 'public.save_note_ydoc(uuid, text)', 'EXECUTE'), false,
  'anon 不可调 save_note_ydoc');

-- ========== 3. 读矩阵 ==========
-- owner 对无 blob 的笔记：null（不是错误，播种前是常态）
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000001-0000-0000-0000-000000000001';  -- A
SELECT is(public.get_note_ydoc('67020000-0000-0000-0000-000000000002'), NULL,
  '无 blob 时 get 返回 null（owner，可区分于 forbidden）');
RESET ROLE;

-- owner 写入 v1 → 内容逐字节落库；get 往返一致
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000001-0000-0000-0000-000000000001';  -- A
SELECT lives_ok(
  $$ SELECT public.save_note_ydoc('67020000-0000-0000-0000-000000000001',
       encode('ydoc-blob-v1'::bytea, 'base64')) $$,
  'owner 保存 blob 成功');
RESET ROLE;
SELECT is((SELECT convert_from(ydoc, 'utf8') FROM public.note_ydocs
    WHERE note_id = '67020000-0000-0000-0000-000000000001'),
  'ydoc-blob-v1', '落库内容逐字节一致');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000001-0000-0000-0000-000000000001';  -- A
SELECT is(public.get_note_ydoc('67020000-0000-0000-0000-000000000001'),
  encode('ydoc-blob-v1'::bytea, 'base64'), 'owner get 往返一致');
RESET ROLE;

-- 新鲜度规则（067 头第 2 条）：非协作写入（只动 notes 行）让 blob 过期 → get 返回
-- null（走播种路径），防止旧 CRDT 状态遮蔽新内容；重新落库后自愈
UPDATE public.notes SET content = content
 WHERE id = '67020000-0000-0000-0000-000000000001';  -- updated_at 被触发器推新
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000001-0000-0000-0000-000000000001';  -- A
SELECT is(public.get_note_ydoc('67020000-0000-0000-0000-000000000001'), NULL,
  'notes 更新后旧 blob 视为过期（get 返回 null，不遮蔽非协作写入）');
SELECT lives_ok(
  $$ SELECT public.save_note_ydoc('67020000-0000-0000-0000-000000000001',
       encode('ydoc-blob-v3'::bytea, 'base64')) $$,
  '过期后重新落库成功');
SELECT is(public.get_note_ydoc('67020000-0000-0000-0000-000000000001'),
  encode('ydoc-blob-v3'::bytea, 'base64'), '重新落库后恢复可读（自愈）');
RESET ROLE;

-- editor 写入 v2（upsert 覆盖）→ owner/viewer 读到 v2
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000002-0000-0000-0000-000000000002';  -- B
SELECT lives_ok(
  $$ SELECT public.save_note_ydoc('67020000-0000-0000-0000-000000000001',
       encode('ydoc-blob-v2'::bytea, 'base64')) $$,
  'editor 保存 blob 成功');
SELECT is(public.get_note_ydoc('67020000-0000-0000-0000-000000000001'),
  encode('ydoc-blob-v2'::bytea, 'base64'), 'editor 读到最新 blob');
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000003-0000-0000-0000-000000000003';  -- C
SELECT is(public.get_note_ydoc('67020000-0000-0000-0000-000000000001'),
  encode('ydoc-blob-v2'::bytea, 'base64'), 'viewer 可读 blob（连接需要拿文档）');
RESET ROLE;

-- viewer / 陌生人 / 匿名：写全拒；读 null（不可区分）
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000003-0000-0000-0000-000000000003';  -- C
SELECT throws_ok(
  $$ SELECT public.save_note_ydoc('67020000-0000-0000-0000-000000000001',
       encode('x'::bytea, 'base64')) $$,
  'P0001', 'forbidden', 'viewer 不能写 blob');
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000004-0000-0000-0000-000000000004';  -- D
SELECT is(public.get_note_ydoc('67020000-0000-0000-0000-000000000001'), NULL,
  '陌生人 get 返回 null（不泄漏存在性）');
SELECT throws_ok(
  $$ SELECT public.save_note_ydoc('67020000-0000-0000-0000-000000000001',
       encode('x'::bytea, 'base64')) $$,
  'P0001', 'forbidden', '陌生人不能写 blob');
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub TO '';  -- 匿名口径同 066：auth.uid() 为空
SELECT is(public.get_note_ydoc('67020000-0000-0000-0000-000000000001'), NULL,
  '匿名 get 返回 null');
SELECT throws_ok(
  $$ SELECT public.save_note_ydoc('67020000-0000-0000-0000-000000000001',
       encode('x'::bytea, 'base64')) $$,
  'P0001', 'invalid_argument', '匿名保存拒绝（invalid_argument，非 forbidden）');
RESET ROLE;

-- ========== 4. 边界 ==========
-- 空 payload
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000001-0000-0000-0000-000000000001';  -- A
SELECT throws_ok(
  $$ SELECT public.save_note_ydoc('67020000-0000-0000-0000-000000000001', '') $$,
  'P0001', 'invalid_argument', '空 payload 拒绝');
-- 超 4MB（约 5.6M 个 base64 字符解码后 > 4MB）
SELECT throws_ok(
  $$ SELECT public.save_note_ydoc('67020000-0000-0000-0000-000000000001',
       repeat('a', 5600000)) $$,
  'P0001', 'ydoc_too_large', '超 4MB 拒绝（ydoc_too_large）');
RESET ROLE;

-- 软删后读写全拒（先软删，断言后恢复供级联测试复用）
UPDATE public.notes SET deleted_at = now()
 WHERE id = '67020000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SET request.jwt.claim.sub TO '67000001-0000-0000-0000-000000000001';  -- A
SELECT is(public.get_note_ydoc('67020000-0000-0000-0000-000000000001'), NULL,
  '软删后 get 返回 null');
SELECT throws_ok(
  $$ SELECT public.save_note_ydoc('67020000-0000-0000-0000-000000000001',
       encode('x'::bytea, 'base64')) $$,
  'P0001', 'forbidden', '软删后保存拒绝');
RESET ROLE;
UPDATE public.notes SET deleted_at = NULL
 WHERE id = '67020000-0000-0000-0000-000000000001';

-- 硬删级联清行
DELETE FROM public.notes WHERE id = '67020000-0000-0000-0000-000000000001';
SELECT is((SELECT count(*) FROM public.note_ydocs
    WHERE note_id = '67020000-0000-0000-0000-000000000001')::int, 0,
  '笔记硬删后 blob 行级联清除，不留幽灵 blob');

SELECT * FROM finish();
ROLLBACK;
