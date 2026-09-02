-- 072 可编辑公开链接 + 匿名实时协同 pgTAP（Track B 后端）
--
-- 覆盖（对应任务书 B5 + 072 文件头承诺）：
--   1. 结构：access_mode 列/默认值/一致性约束存在；新行默认 public_read；
--      四个 token 型 RPC 的 EXECUTE 分层（anon 可调是本卡核心）
--   2. get_public_share 返回 access_mode；disabled 行 = missing
--   3. resolve_share_access 矩阵：public_edit→editor、public_read→viewer、
--      disabled/过期/错 resource_id/伪造 token/reading_item 分享 → null（不可区分）
--   4. save_public_note：public_edit ok + revision+1 + 属主 scope 写 + last_edit_by null；
--      public_read/disabled/过期/软删/非笔记分享/空 content → forbidden；
--      stale revision → conflict_note（与 v2 同形）；匿名保存产生版本行
--   5. token ydoc RPC：editor 读写、viewer 只读且写 raise、新鲜度规则、4MB、软删
--   6. 结构断言：save_note_ydoc_by_token 用 is distinct from 判权；
--      save_public_note 显式调 prune_note_versions_for
-- 身份切换沿 063/067 约定；匿名口径 = request.jwt.claim.sub 置空（token 型 RPC 不依赖 uid）
BEGIN;
SELECT plan(72);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('72000001-0000-0000-0000-000000000001', 'p7_pedit_a@test'),
    ('72000002-0000-0000-0000-000000000002', 'p7_pedit_b@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('72200000-0000-0000-0000-000000000001', '72000001-0000-0000-0000-000000000001',
   'A的公开笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'),
  ('72200000-0000-0000-0000-000000000002', '72000002-0000-0000-0000-000000000002',
   'B的公开笔记', '{"type":"doc","content":[{"type":"paragraph"}]}');

INSERT INTO public.reading_items (id, user_id, url, title) VALUES
  ('72300000-0000-0000-0000-000000000001', '72000001-0000-0000-0000-000000000001',
   'https://example.com/a', 'A的文章');

INSERT INTO public.shares
  (owner_id, resource_type, resource_id, token, is_public, access_mode, expires_at) VALUES
  ('72000001-0000-0000-0000-000000000001', 'note', '72200000-0000-0000-0000-000000000001',
   '72s-token-edit-000000000001', true, 'public_edit', NULL),
  ('72000001-0000-0000-0000-000000000001', 'note', '72200000-0000-0000-0000-000000000001',
   '72s-token-read-000000000002', true, 'public_read', NULL),
  ('72000001-0000-0000-0000-000000000001', 'note', '72200000-0000-0000-0000-000000000001',
   '72s-token-off-000000000003', false, 'disabled', NULL),
  ('72000001-0000-0000-0000-000000000001', 'note', '72200000-0000-0000-0000-000000000001',
   '72s-token-exp-000000000004', true, 'public_edit', now() - interval '1 hour'),
  ('72000001-0000-0000-0000-000000000001', 'reading_item', '72300000-0000-0000-0000-000000000001',
   '72s-token-art-000000000005', true, 'public_edit', NULL),
  ('72000002-0000-0000-0000-000000000002', 'note', '72200000-0000-0000-0000-000000000002',
   '72s-token-bn-0000000000006', true, 'public_edit', NULL);

-- ========== 1. 结构 ==========
SELECT col_type_is('public', 'shares', 'access_mode', 'text', 'shares.access_mode 是 text');
SELECT ok((SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'shares_access_mode_is_public_consistency'
       AND conrelid = 'public.shares'::regclass
       AND contype = 'c')),
  'access_mode 与 is_public 的一致性约束存在');

-- 新行默认 public_read（等价 backfill 落点：老公开行无需改写即为 public_read）
INSERT INTO public.shares
  (owner_id, resource_type, resource_id, token, is_public)
VALUES ('72000001-0000-0000-0000-000000000001', 'note', '72200000-0000-0000-0000-000000000001',
        '72s-token-default-00000007', true);
SELECT is((SELECT access_mode FROM public.shares WHERE token = '72s-token-default-00000007'),
  'public_read', '不指定 access_mode 的新行默认 public_read');
DELETE FROM public.shares WHERE token = '72s-token-default-00000007';

-- 一致性约束负例：disabled ↔ not is_public 必须成对
SELECT throws_ok(
  $$UPDATE public.shares SET is_public = true WHERE token = '72s-token-off-000000000003'$$,
  'new row for relation "shares" violates check constraint "shares_access_mode_is_public_consistency"',
  'disabled 行不得单独置 is_public=true');
SELECT throws_ok(
  $$UPDATE public.shares SET access_mode = 'public_edit' WHERE token = '72s-token-off-000000000003'$$,
  'new row for relation "shares" violates check constraint "shares_access_mode_is_public_consistency"',
  'is_public=false 行不得单独改成公开态');
SELECT lives_ok(
  $$UPDATE public.shares SET access_mode = 'disabled', is_public = false
    WHERE token = '72s-token-read-000000000002'$$,
  '成对写入（关闭）合法');
UPDATE public.shares SET access_mode = 'public_read', is_public = true
 WHERE token = '72s-token-read-000000000002';

-- EXECUTE 分层：token 型 RPC anon / authenticated / service_role 分层
SELECT is(has_function_privilege('anon', 'public.resolve_share_access(text, uuid)', 'EXECUTE'), true,
  'anon 可调 resolve_share_access（collab-server 用 anon key 判权）');
SELECT is(has_function_privilege('anon', 'public.save_public_note(text, jsonb, integer, text, uuid)', 'EXECUTE'), true,
  'anon 可调 save_public_note');
SELECT is(has_function_privilege('anon', 'public.get_note_ydoc_by_token(text, uuid)', 'EXECUTE'), true,
  'anon 可调 get_note_ydoc_by_token');
SELECT is(has_function_privilege('anon', 'public.save_note_ydoc_by_token(text, uuid, text)', 'EXECUTE'), true,
  'anon 可调 save_note_ydoc_by_token');
SELECT is(has_function_privilege('authenticated', 'public.resolve_share_access(text, uuid)', 'EXECUTE'), true,
  'authenticated 可调 resolve_share_access（同房间登录用户）');
SELECT is(has_function_privilege('service_role', 'public.save_public_note(text, jsonb, integer, text, uuid)', 'EXECUTE'), true,
  'service_role 可调 save_public_note');

-- ========== 2. get_public_share 返回 access_mode ==========
SELECT is((SELECT status FROM public.get_public_share('72s-token-edit-000000000001')), 'active',
  'public_edit 分享 active');
SELECT is((SELECT access_mode FROM public.get_public_share('72s-token-edit-000000000001')), 'public_edit',
  'get_public_share 带回 access_mode=public_edit');
SELECT is((SELECT access_mode FROM public.get_public_share('72s-token-read-000000000002')), 'public_read',
  'get_public_share 带回 access_mode=public_read');
SELECT is((SELECT status FROM public.get_public_share('72s-token-off-000000000003')), 'missing',
  'disabled 分享对匿名 = missing（is_public 一致性兜住）');
SELECT is((SELECT status FROM public.get_public_share('72s-token-exp-000000000004')), 'expired',
  '过期分享仍报 expired');

-- ========== 3. resolve_share_access 矩阵（匿名身份，token 型 RPC 不依赖 uid）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '';  -- 匿名口径同 066/067
SELECT is(public.resolve_share_access('72s-token-edit-000000000001', '72200000-0000-0000-0000-000000000001'),
  'editor', 'public_edit → editor');
SELECT is(public.resolve_share_access('72s-token-read-000000000002', '72200000-0000-0000-0000-000000000001'),
  'viewer', 'public_read → viewer');
SELECT is(public.resolve_share_access('72s-token-off-000000000003', '72200000-0000-0000-0000-000000000001'), NULL,
  'disabled → null');
SELECT is(public.resolve_share_access('72s-token-exp-000000000004', '72200000-0000-0000-0000-000000000001'), NULL,
  '过期 → null');
SELECT is(public.resolve_share_access('72s-token-edit-000000000001', '72200000-0000-0000-0000-000000000002'), NULL,
  '错 resource_id → null');
SELECT is(public.resolve_share_access('72s-token-bn-0000000000006', '72200000-0000-0000-0000-000000000001'), NULL,
  'B 的 token 配 A 的笔记（token-resource 不匹配）→ null');
SELECT is(public.resolve_share_access('72s-token-bn-0000000000006', '72200000-0000-0000-0000-000000000002'),
  'editor', 'B 的 token 配 B 自己的笔记 → editor（配对正例控制）');
SELECT is(public.resolve_share_access('72s-token-art-000000000005', '72300000-0000-0000-0000-000000000001'), NULL,
  'reading_item 分享不给任何角色（实时房间是 note 命名空间）');
SELECT is(public.resolve_share_access('72s-no-such-token-00000000', '72200000-0000-0000-0000-000000000001'), NULL,
  '伪造 token → null');
SELECT is(public.resolve_share_access(NULL, '72200000-0000-0000-0000-000000000001'), NULL, 'null token → null');
-- token 型 RPC 是 DEFINER 且不依赖调用者身份，后续 RPC 断言以 postgres + 空 uid
--（claim.sub 已置空）调用等价匿名；直接表操作须回 postgres 以绕过 RLS
RESET ROLE;

-- ========== 4. save_public_note（匿名语义：claim.sub 仍为空）==========
SELECT is((SELECT content_revision FROM public.notes
    WHERE id = '72200000-0000-0000-0000-000000000001')::int, 0, '前置：N1 初始 revision = 0');
SELECT is(public.save_public_note('72s-token-edit-000000000001',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"匿名第一笔"}]}]}'::jsonb,
    0)->>'status', 'ok', '匿名经 public_edit 保存成功');
SELECT is((SELECT content_revision FROM public.notes
    WHERE id = '72200000-0000-0000-0000-000000000001')::int, 1, 'content_revision +1');
SELECT is((SELECT content->'content'->0->'content'->0->>'text' FROM public.notes
    WHERE id = '72200000-0000-0000-0000-000000000001'), '匿名第一笔', 'content 实际写入');
SELECT is((SELECT last_edit_by FROM public.notes
    WHERE id = '72200000-0000-0000-0000-000000000001'), NULL, 'last_edit_by 为 null（匿名不署名）');
SELECT is((SELECT user_id FROM public.notes WHERE id = '72200000-0000-0000-0000-000000000001'),
  '72000001-0000-0000-0000-000000000001', '行仍属 A（以属主 scope 写，不改归属）');
SELECT is((SELECT count(*) FROM public.note_versions
    WHERE note_id = '72200000-0000-0000-0000-000000000001')::int, 1,
  '匿名保存经触发器产生版本行（显式裁剪由结构断言钉住）');

-- 改题（p_title）；expected null = 不校验乐观锁（节流快照语义）
SELECT is(public.save_public_note('72s-token-edit-000000000001',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"匿名第一笔"}]}]}'::jsonb,
    NULL, '匿名改题')->>'status', 'ok', 'p_title 生效、expected null 跳过校验');
SELECT is((SELECT title FROM public.notes WHERE id = '72200000-0000-0000-0000-000000000001'),
  '匿名改题', 'title 被更新');
SELECT is((SELECT content_revision FROM public.notes
    WHERE id = '72200000-0000-0000-0000-000000000001')::int, 2, 'revision 累计 +1');

-- stale revision → conflict_note（与 v2 同形，回带 current_revision）
SELECT is(public.save_public_note('72s-token-edit-000000000001', '{"type":"doc"}'::jsonb, 0)->>'status',
  'conflict_note', 'stale revision → conflict_note');
SELECT is(public.save_public_note('72s-token-edit-000000000001', '{"type":"doc"}'::jsonb, 0)->>'current_revision',
  '2', 'conflict_note 回带 current_revision');

-- 负例矩阵：统一 forbidden，不区分原因
SELECT is(public.save_public_note('72s-token-read-000000000002', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'forbidden', 'public_read 分享不能保存');
SELECT is(public.save_public_note('72s-token-off-000000000003', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'forbidden', 'disabled 分享不能保存');
SELECT is(public.save_public_note('72s-token-exp-000000000004', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'forbidden', '过期分享不能保存');
SELECT is(public.save_public_note('72s-token-art-000000000005', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'forbidden', 'reading_item 分享的 token 不能保存笔记');
SELECT is(public.save_public_note('72s-no-such-token-00000000', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'forbidden', '伪造 token 拒绝');
SELECT is(public.save_public_note('72s-token-edit-000000000001', NULL, NULL)->>'status',
  'forbidden', '空 content 拒绝');
SELECT is(public.save_public_note('72s-token-edit-000000000001', '["not","an","object"]'::jsonb, NULL)->>'status',
  'forbidden', '数组 content 拒绝（必须 jsonb object）');
SELECT is(public.save_public_note('72s-token-edit-000000000001', '"just a string"'::jsonb, NULL)->>'status',
  'forbidden', '标量 content 拒绝');
SELECT is(public.save_public_note('72s-token-edit-000000000001',
    jsonb_build_object('k', repeat('x', 4 * 1024 * 1024 + 10)), NULL)->>'status',
  'forbidden', '超 4MB content 拒绝（与 ydoc 通道同口径）');
SELECT is(public.save_public_note('72s-token-edit-000000000001',
    '{"type":"doc"}'::jsonb, NULL, repeat('题', 256))->>'status',
  'forbidden', 'title 超 255 拒绝');

-- 属主漂移（纵深防御）：分享行指向的笔记属主被直接改掉 → resolve 一律 null
UPDATE public.notes SET user_id = '72000002-0000-0000-0000-000000000002'
 WHERE id = '72200000-0000-0000-0000-000000000001';
SELECT is(public.resolve_share_access('72s-token-edit-000000000001', '72200000-0000-0000-0000-000000000001'),
  NULL, '笔记属主漂移后分享失效（防跨租户）');
SELECT is(public.save_public_note('72s-token-edit-000000000001', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'forbidden', '属主漂移后保存拒绝');
UPDATE public.notes SET user_id = '72000001-0000-0000-0000-000000000001'
 WHERE id = '72200000-0000-0000-0000-000000000001';

-- 软删：拒绝；恢复后同 token 再用（不区分原因）
UPDATE public.notes SET deleted_at = now()
 WHERE id = '72200000-0000-0000-0000-000000000001';
SELECT is(public.save_public_note('72s-token-edit-000000000001', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'forbidden', '软删笔记不能保存');
UPDATE public.notes SET deleted_at = NULL
 WHERE id = '72200000-0000-0000-0000-000000000001';

-- ========== 5. token 版 ydoc RPC ==========
SELECT lives_ok(
  $$SELECT public.save_note_ydoc_by_token('72s-token-edit-000000000001',
       '72200000-0000-0000-0000-000000000001', encode('ydoc-tok-v1'::bytea, 'base64'))$$,
  '匿名 editor（public_edit）保存 blob 成功');
SELECT is(public.get_note_ydoc_by_token('72s-token-edit-000000000001',
    '72200000-0000-0000-0000-000000000001'),
  encode('ydoc-tok-v1'::bytea, 'base64'), '匿名 editor 读回 blob 一致');
SELECT is(public.get_note_ydoc_by_token('72s-token-read-000000000002',
    '72200000-0000-0000-0000-000000000001'),
  encode('ydoc-tok-v1'::bytea, 'base64'), '匿名 viewer（public_read）可读 blob（连接要拿文档）');
SELECT throws_ok(
  $$SELECT public.save_note_ydoc_by_token('72s-token-read-000000000002',
       '72200000-0000-0000-0000-000000000001', encode('x'::bytea, 'base64'))$$,
  'P0001', 'forbidden', 'viewer 不能写 blob');
SELECT lives_ok(
  $$SELECT public.save_note_ydoc_by_token('72s-token-edit-000000000001',
       '72200000-0000-0000-0000-000000000001', encode('ydoc-tok-v2'::bytea, 'base64'))$$,
  'editor 再次保存（upsert 覆盖）');
SELECT is(public.get_note_ydoc_by_token('72s-token-edit-000000000001',
    '72200000-0000-0000-0000-000000000001'),
  encode('ydoc-tok-v2'::bytea, 'base64'), 'upsert 后读到 v2');

-- 新鲜度规则（067 原样保留）：blob 落后于 notes.updated_at → get null（走播种路径）
UPDATE public.note_ydocs SET updated_at = now() - interval '1 hour'
 WHERE note_id = '72200000-0000-0000-0000-000000000001';
SELECT is(public.get_note_ydoc_by_token('72s-token-edit-000000000001',
    '72200000-0000-0000-0000-000000000001'), NULL,
  'blob 落后于 notes 更新 → get 返回 null（不遮蔽快照写入）');
SELECT lives_ok(
  $$SELECT public.save_note_ydoc_by_token('72s-token-edit-000000000001',
       '72200000-0000-0000-0000-000000000001', encode('ydoc-tok-v3'::bytea, 'base64'))$$,
  '重新落库自愈');
SELECT is(public.get_note_ydoc_by_token('72s-token-edit-000000000001',
    '72200000-0000-0000-0000-000000000001'),
  encode('ydoc-tok-v3'::bytea, 'base64'), '自愈后恢复可读');

-- 边界与负例
SELECT throws_ok(
  $$SELECT public.save_note_ydoc_by_token('72s-token-edit-000000000001',
       '72200000-0000-0000-0000-000000000001', repeat('a', 5600000))$$,
  'P0001', 'ydoc_too_large', '超 4MB 拒绝');
SELECT is(public.get_note_ydoc_by_token('72s-token-off-000000000003',
    '72200000-0000-0000-0000-000000000001'), NULL, 'disabled → get null');
SELECT throws_ok(
  $$SELECT public.save_note_ydoc_by_token('72s-token-off-000000000003',
       '72200000-0000-0000-0000-000000000001', encode('x'::bytea, 'base64'))$$,
  'P0001', 'forbidden', 'disabled → 不能写');
SELECT is(public.get_note_ydoc_by_token('72s-token-edit-000000000001',
    '72200000-0000-0000-0000-000000000002'), NULL, 'token 配别的笔记 → get null');
SELECT throws_ok(
  $$SELECT public.save_note_ydoc_by_token('72s-token-edit-000000000001',
       '72200000-0000-0000-0000-000000000002', encode('x'::bytea, 'base64'))$$,
  'P0001', 'forbidden', 'token 配别的笔记 → 不能写');
SELECT is(public.get_note_ydoc_by_token('72s-token-art-000000000005',
    '72200000-0000-0000-0000-000000000001'), NULL, 'reading_item 分享 token → get null');

-- 软删后读写全拒
UPDATE public.notes SET deleted_at = now()
 WHERE id = '72200000-0000-0000-0000-000000000001';
SELECT is(public.get_note_ydoc_by_token('72s-token-edit-000000000001',
    '72200000-0000-0000-0000-000000000001'), NULL, '软删后 get null');
SELECT throws_ok(
  $$SELECT public.save_note_ydoc_by_token('72s-token-edit-000000000001',
       '72200000-0000-0000-0000-000000000001', encode('x'::bytea, 'base64'))$$,
  'P0001', 'forbidden', '软删后保存拒绝');
UPDATE public.notes SET deleted_at = NULL
 WHERE id = '72200000-0000-0000-0000-000000000001';

-- ========== 6. 结构断言（钉住关键坑）==========
SELECT ok((SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'save_note_ydoc_by_token') LIKE '%is distinct from%',
  'save_note_ydoc_by_token 用 is distinct from 判权（NULL 陷阱）');
SELECT ok((SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'save_note_ydoc_by_token') LIKE '%resolve_share_access%',
  'save_note_ydoc_by_token 经 resolve_share_access 实时判权（可撤销性）');
SELECT ok((SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'save_public_note') LIKE '%prune_note_versions_for%',
  'save_public_note 显式调 prune_note_versions_for（匿名无 uid 触发器不裁剪）');

SELECT * FROM finish();
ROLLBACK;
