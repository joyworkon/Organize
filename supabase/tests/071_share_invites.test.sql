-- 071 邮箱邀请未注册用户 pgTAP（Track A）
--
-- 覆盖（对应任务书 A4 + 071 文件头的安全设计）：
--   1. 结构：表存在、RLS 启用、anon 无表权限、redeem_share_invite 的 EXECUTE 分层
--   2. 结构断言：redeem_share_invite 的 prosrc 不含 add_workspace_member / grant_resource
--      （钉住「兑现不得走带属主守卫的 RPC」的坑）
--   3. RLS：属主只见自己的邀请；非属主不能为别人的资源插伪造邀请（with check 资源属主校验）
--   4. 兑现矩阵：uid 匹配 / 邮箱匹配（大小写不敏感）/ 邮箱不符 / 过期 / revoked /
--      伪造 token / null token / 匿名 / 重复兑现幂等
--   5. 伪造预授权行防提权：invited_by ≠ resource_owner 的行兑现一律 forbidden，
--      不产生 workspace_members / resource_acl 行
-- 身份切换沿 063/067 约定：SET ROLE authenticated + SET request.jwt.claim.sub
BEGIN;
SELECT plan(54);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('71000001-0000-0000-0000-000000000001', 'p7_invite_a@test'),
    ('71000002-0000-0000-0000-000000000002', 'p7_invite_b@test'),
    ('71000003-0000-0000-0000-000000000003', 'p7_invite_c@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- W1: A 的团队空间（邀请目标）；W2: B 的团队空间（伪造邀请的兑现目标）；
-- W3: A 的另一团队空间（C 的 viewer 邀请单独走它，避免与 B 的 editor 授权
-- 撞 resource_acl 的 (workspace, resource) 唯一键——兑现不调低既有授权）
INSERT INTO public.workspaces (id, name, kind, owner_id) VALUES
  ('71100000-0000-0000-0000-000000000001', 'INVITE-W1', 'team', '71000001-0000-0000-0000-000000000001'),
  ('71100000-0000-0000-0000-000000000002', 'INVITE-W2', 'team', '71000002-0000-0000-0000-000000000002'),
  ('71100000-0000-0000-0000-000000000003', 'INVITE-W3', 'team', '71000001-0000-0000-0000-000000000001');

INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('71100000-0000-0000-0000-000000000001', '71000001-0000-0000-0000-000000000001', 'owner'),
  ('71100000-0000-0000-0000-000000000002', '71000002-0000-0000-0000-000000000002', 'owner'),
  ('71100000-0000-0000-0000-000000000003', '71000001-0000-0000-0000-000000000001', 'owner');

INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('71200000-0000-0000-0000-000000000001', '71000001-0000-0000-0000-000000000001',
   'A的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'),
  ('71200000-0000-0000-0000-000000000002', '71000002-0000-0000-0000-000000000002',
   'B的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}');

-- 邀请行（真实路径由 API 以属主身份插入；这里直插等价数据）
-- I1 happy(uid)：B 对 A 的笔记 editor；I2 happy(邮箱)：C、大写邮箱、viewer；
-- I3 过期；I4 revoked；I7 邮箱不匹配专用（email=B、pending、无预建 uid）
INSERT INTO public.share_invites
  (resource_type, resource_id, workspace_id, access_role, email, invited_by, invited_user_id,
   token, status, expires_at) VALUES
  ('note', '71200000-0000-0000-0000-000000000001', '71100000-0000-0000-0000-000000000001',
   'editor', 'p7_invite_b@test', '71000001-0000-0000-0000-000000000001',
   '71000002-0000-0000-0000-000000000002', '71i-token-b-happy-000000000001', 'pending', NULL),
  ('note', '71200000-0000-0000-0000-000000000001', '71100000-0000-0000-0000-000000000003',
   'viewer', 'P7_INVITE_C@Test', '71000001-0000-0000-0000-000000000001',
   NULL, '71i-token-c-email-000000000002', 'pending', NULL),
  ('note', '71200000-0000-0000-0000-000000000001', '71100000-0000-0000-0000-000000000001',
   'editor', 'p7_invite_b@test', '71000001-0000-0000-0000-000000000001',
   '71000002-0000-0000-0000-000000000002', '71i-token-b-expired-000000003', 'pending',
   now() - interval '1 hour'),
  ('note', '71200000-0000-0000-0000-000000000001', '71100000-0000-0000-0000-000000000001',
   'editor', 'p7_invite_b@test', '71000001-0000-0000-0000-000000000001',
   '71000002-0000-0000-0000-000000000002', '71i-token-b-revoked-000000004', 'revoked', NULL),
  ('note', '71200000-0000-0000-0000-000000000001', '71100000-0000-0000-0000-000000000001',
   'editor', 'p7_invite_b@test', '71000001-0000-0000-0000-000000000001',
   NULL, '71i-token-b-mismatch-0000007', 'pending', NULL),
  ('note', '71200000-0000-0000-0000-000000000001', '71100000-0000-0000-0000-000000000001',
   'editor', 'p7_invite_b@test', '71000001-0000-0000-0000-000000000001',
   '71000002-0000-0000-0000-000000000002', '71i-token-b-anon-000000000006', 'pending', NULL);

-- 伪造预授权行（表层防线被绕过情形）：invited_by = B（非资源属主）、resource = A 的笔记、
-- 目标空间 = B 自己的 W2。
INSERT INTO public.share_invites
  (resource_type, resource_id, workspace_id, access_role, email, invited_by, invited_user_id,
   token, status) VALUES
  ('note', '71200000-0000-0000-0000-000000000001', '71100000-0000-0000-0000-000000000002',
   'editor', 'p7_invite_b@test', '71000002-0000-0000-0000-000000000002',
   '71000002-0000-0000-0000-000000000002', '71i-token-forged-00000000005', 'pending');

-- 空间维度伪造行（同样绕过表层）：invited_by = A（资源属主，表层资源校验能过）、
-- 但目标空间 = B 的 W2——「往别人的空间加人」必须在兑现端被拦。
INSERT INTO public.share_invites
  (resource_type, resource_id, workspace_id, access_role, email, invited_by, invited_user_id,
   token, status) VALUES
  ('note', '71200000-0000-0000-0000-000000000001', '71100000-0000-0000-0000-000000000002',
   'editor', 'p7_invite_a@test', '71000001-0000-0000-0000-000000000001',
   '71000001-0000-0000-0000-000000000001', '71i-token-a-ws-000000000009', 'pending');

-- ========== 1. 结构 ==========
SELECT has_table('public', 'share_invites', 'share_invites 表存在');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.share_invites'::regclass),
  'share_invites 启用 RLS');
SELECT is(has_table_privilege('anon', 'public.share_invites', 'SELECT'), false,
  'anon 无直接 SELECT（被邀请人不直读本表）');
SELECT is(has_table_privilege('anon', 'public.share_invites', 'INSERT'), false,
  'anon 无直接 INSERT');
SELECT is(has_table_privilege('authenticated', 'public.share_invites', 'INSERT'), true,
  'authenticated 可 INSERT（属主经 API 创建邀请）');
SELECT is(has_function_privilege('authenticated', 'public.redeem_share_invite(text)', 'EXECUTE'), true,
  'authenticated 可调 redeem_share_invite');
SELECT is(has_function_privilege('service_role', 'public.redeem_share_invite(text)', 'EXECUTE'), true,
  'service_role 可调 redeem_share_invite');
SELECT is(has_function_privilege('anon', 'public.redeem_share_invite(text)', 'EXECUTE'), false,
  'anon 不可调 redeem_share_invite');
SELECT ok((SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'redeem_share_invite') NOT LIKE '%add_workspace_member%',
  'redeem_share_invite 未调用 add_workspace_member（兑现者不是空间 owner，会被拒）');
SELECT ok((SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'redeem_share_invite') NOT LIKE '%grant_resource%',
  'redeem_share_invite 未调用 grant_resource（兑现者不是资源控制者，会被拒）');

-- ========== 2. RLS ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000002-0000-0000-0000-000000000002';  -- 用户 B
SELECT is((SELECT count(*) FROM public.share_invites
    WHERE invited_by = '71000001-0000-0000-0000-000000000001')::int, 0,
  'B 看不到 A 的邀请行（invited_by 才可见）');
SELECT throws_ok(
  $$INSERT INTO public.share_invites
      (resource_type, resource_id, workspace_id, access_role, email, invited_by, token)
    VALUES ('note', '71200000-0000-0000-0000-000000000001',
            '71100000-0000-0000-0000-000000000002', 'editor', 'p7_invite_b@test',
            '71000002-0000-0000-0000-000000000002', '71i-rls-forged-00000000001')$$,
  'new row violates row-level security policy for table "share_invites"',
  'B 不能为别人的资源插伪造邀请（with check 校验资源属主）');
SELECT lives_ok(
  $$INSERT INTO public.share_invites
      (resource_type, resource_id, workspace_id, access_role, email, invited_by, token)
    VALUES ('note', '71200000-0000-0000-0000-000000000002',
            '71100000-0000-0000-0000-000000000002', 'viewer', 'someone@test',
            '71000002-0000-0000-0000-000000000002', '71i-rls-own-000000000002')$$,
  'B 可以为自己拥有的资源创建邀请（正例控制）');
SELECT lives_ok(
  $$DELETE FROM public.share_invites WHERE token = '71i-rls-own-000000000002'$$,
  '属主可删除自己的邀请行');
RESET ROLE;

-- ========== 3. 兑现：uid 匹配 happy path ==========
-- 兑现有副作用（置 accepted），只调用一次：结果存临时表，逐项断言
CREATE TEMP TABLE _redeem_happy (r jsonb);
GRANT INSERT ON _redeem_happy TO authenticated;
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000002-0000-0000-0000-000000000002';  -- B
INSERT INTO _redeem_happy
  SELECT public.redeem_share_invite('71i-token-b-happy-000000000001');
RESET ROLE;
SELECT is((SELECT r->>'status' FROM _redeem_happy), 'ok',
  'B 凭 token 兑现（uid 命中预建账号）成功');
SELECT is((SELECT r->>'resource_type' FROM _redeem_happy), 'note',
  '兑现结果带回 resource_type');
SELECT is((SELECT r->>'resource_id' FROM _redeem_happy),
  '71200000-0000-0000-0000-000000000001', '兑现结果带回 resource_id');
SELECT is((SELECT role FROM public.workspace_members
    WHERE workspace_id = '71100000-0000-0000-0000-000000000001'
      AND user_id = '71000002-0000-0000-0000-000000000002'),
  'member', '兑现落地 workspace_members（member）');
SELECT is((SELECT access_role FROM public.resource_acl
    WHERE workspace_id = '71100000-0000-0000-0000-000000000001'
      AND resource_type = 'note'
      AND resource_id = '71200000-0000-0000-0000-000000000001'),
  'editor', '兑现落地 resource_acl（邀请的 access_role）');
SELECT is((SELECT created_by FROM public.resource_acl
    WHERE workspace_id = '71100000-0000-0000-0000-000000000001'
      AND resource_id = '71200000-0000-0000-0000-000000000001'),
  '71000001-0000-0000-0000-000000000001', 'acl.created_by = 邀请人（属主）');
SELECT is((SELECT status FROM public.share_invites
    WHERE token = '71i-token-b-happy-000000000001'), 'accepted', '邀请行置 accepted');
SELECT is((SELECT accepted_by FROM public.share_invites
    WHERE token = '71i-token-b-happy-000000000001'),
  '71000002-0000-0000-0000-000000000002', 'accepted_by = 兑现者');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000002-0000-0000-0000-000000000002';  -- B
SELECT is(public.resource_role('note', '71200000-0000-0000-0000-000000000001'), 'editor',
  'B 经 063 判定链拿到 editor（既有协作链路即刻生效）');

-- 重复兑现：幂等、不报错、不产生第二条 acl / member
SELECT is(public.redeem_share_invite('71i-token-b-happy-000000000001')->>'status', 'forbidden',
  '重复兑现返回 forbidden（已 accepted，非 pending）');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.resource_acl
    WHERE workspace_id = '71100000-0000-0000-0000-000000000001'
      AND resource_id = '71200000-0000-0000-0000-000000000001')::int, 1,
  '重复兑现不产生第二条 acl 行');
SELECT is((SELECT count(*) FROM public.workspace_members
    WHERE workspace_id = '71100000-0000-0000-0000-000000000001'
      AND user_id = '71000002-0000-0000-0000-000000000002')::int, 1,
  '重复兑现不产生第二条 member 行');

-- ========== 4. 兑现：邮箱匹配（大小写不敏感）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000003-0000-0000-0000-000000000003';  -- C
SELECT is(public.redeem_share_invite('71i-token-c-email-000000000002')->>'status', 'ok',
  'C 凭 token 兑现（邀请邮箱大写、账号小写，匹配）成功');
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000003-0000-0000-0000-000000000003';  -- C
SELECT is(public.resource_role('note', '71200000-0000-0000-0000-000000000001'), 'viewer',
  'C 拿到邀请的 viewer 权');
RESET ROLE;
SELECT is((SELECT role FROM public.workspace_members
    WHERE workspace_id = '71100000-0000-0000-0000-000000000003'
      AND user_id = '71000003-0000-0000-0000-000000000003'),
  'member', 'C 兑现后加入邀请指定的空间');

-- 邮箱不符：用 C 的账号兑 B 的邀请
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000003-0000-0000-0000-000000000003';  -- C
SELECT is(public.redeem_share_invite('71i-token-b-mismatch-0000007')->>'status', 'forbidden',
  '邮箱不符拒绝');
SELECT is(public.redeem_share_invite('71i-token-b-mismatch-0000007')->>'reason', 'email_mismatch',
  '邮箱不符返回 email_mismatch（前端据实提示）');

-- ========== 5. 兑现：负例矩阵 ==========
SET request.jwt.claim.sub TO '71000002-0000-0000-0000-000000000002';  -- B
SELECT is(public.redeem_share_invite('71i-token-b-expired-000000003')->>'status', 'forbidden',
  '过期邀请拒绝');
SELECT is(public.redeem_share_invite('71i-token-b-revoked-000000004')->>'status', 'forbidden',
  'revoked 邀请拒绝');
SELECT is(public.redeem_share_invite('71i-no-such-token-00000000000')->>'status', 'forbidden',
  '伪造 token 拒绝');
SELECT is(public.redeem_share_invite(NULL)->>'status', 'forbidden', 'null token 拒绝');
SELECT is(public.redeem_share_invite('71i-token-b-expired-000000003')->>'reason', NULL,
  '过期/revoked/伪造统一 forbidden（不区分原因，不泄漏存在性）');
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub TO '';  -- 匿名口径同 066/067
SELECT is(public.redeem_share_invite('71i-token-b-anon-000000000006')->>'status', 'forbidden',
  '匿名拒绝');
SELECT is(public.redeem_share_invite('71i-token-b-anon-000000000006')->>'reason', 'anonymous',
  '匿名返回 anonymous（前端引导登录）');
RESET ROLE;

-- ========== 6. 伪造预授权行防提权 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000002-0000-0000-0000-000000000002';  -- B
SELECT is(public.redeem_share_invite('71i-token-forged-00000000005')->>'status', 'forbidden',
  '伪造预授权行（invited_by ≠ 资源属主）兑现拒绝');
RESET ROLE;
SELECT is((SELECT status FROM public.share_invites
    WHERE token = '71i-token-forged-00000000005'), 'pending', '伪造行未被置 accepted');
SELECT is((SELECT count(*) FROM public.resource_acl
    WHERE workspace_id = '71100000-0000-0000-0000-000000000002'
      AND resource_id = '71200000-0000-0000-0000-000000000001')::int, 0,
  '伪造兑现未给 B 的空间落 acl 行');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000002-0000-0000-0000-000000000002';  -- B
SELECT is(public.resource_role('note', '71200000-0000-0000-0000-000000000001'), 'editor',
  'B 对 A 笔记的权限仍只来自合法兑现（未因伪造行升级）');
RESET ROLE;

-- ========== 7. 空间维度防提权（往别人的空间加人 = 加权，只有空间 owner 能做） ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000001-0000-0000-0000-000000000001';  -- A（资源属主，但 W2 是 B 的）
SELECT is(public.redeem_share_invite('71i-token-a-ws-000000000009')->>'status', 'forbidden',
  '把邀请落进别人拥有的空间：兑现拒绝');
RESET ROLE;
SELECT is((SELECT status FROM public.share_invites
    WHERE token = '71i-token-a-ws-000000000009'), 'pending', '空间维度伪造行未被置 accepted');
SELECT is((SELECT count(*) FROM public.workspace_members
    WHERE workspace_id = '71100000-0000-0000-0000-000000000002'
      AND user_id = '71000001-0000-0000-0000-000000000001')::int, 0,
  'A 未被加进 B 的空间');
SELECT is((SELECT count(*) FROM public.resource_acl
    WHERE workspace_id = '71100000-0000-0000-0000-000000000002'
      AND resource_id = '71200000-0000-0000-0000-000000000001')::int, 0,
  'B 的空间没有新增任何 acl 行');

-- ========== 8. 已有更高授权不因兑现被调低 ==========
-- B 的 happy 兑现已落 (W1, note N1, editor)；A 再给 C 发 viewer 邀请到同一 (W1, N1)，
-- C 兑现成功但既有 editor 授权保持不变（on conflict do nothing）
INSERT INTO public.share_invites
  (resource_type, resource_id, workspace_id, access_role, email, invited_by, invited_user_id,
   token, status) VALUES
  ('note', '71200000-0000-0000-0000-000000000001', '71100000-0000-0000-0000-000000000001',
   'viewer', 'p7_invite_c@test', '71000001-0000-0000-0000-000000000001',
   NULL, '71i-token-c-nodowng-00000010', 'pending');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000003-0000-0000-0000-000000000003';  -- C
SELECT is(public.redeem_share_invite('71i-token-c-nodowng-00000010')->>'status', 'ok',
  'C 兑现同一资源的低角色邀请仍成功（加入 W1）');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.resource_acl
    WHERE workspace_id = '71100000-0000-0000-0000-000000000001'
      AND resource_id = '71200000-0000-0000-0000-000000000001')::int, 1,
  'acl 行不重复（不产生第二条授权行）');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000003-0000-0000-0000-000000000003';  -- C
SELECT is(public.resource_role('note', '71200000-0000-0000-0000-000000000001'), 'editor',
  'C 的有效角色保持既有 editor（邀请的 viewer 不调低）');
RESET ROLE;

-- ========== 9. 软删资源：兑现拒绝（对齐 068/069「先出垃圾箱」口径） ==========
UPDATE public.notes SET deleted_at = now()
 WHERE id = '71200000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000001-0000-0000-0000-000000000001';  -- A
SELECT is(public.redeem_share_invite('71i-token-b-mismatch-0000007')->>'status', 'forbidden',
  '资源进垃圾箱后兑现拒绝');
SELECT is(public.redeem_share_invite('71i-token-b-mismatch-0000007')->>'reason', NULL,
  '软删拒绝与其它拒绝不可区分（不泄漏原因）');
RESET ROLE;
UPDATE public.notes SET deleted_at = NULL
 WHERE id = '71200000-0000-0000-0000-000000000001';

-- 属主撤销：status 置 revoked 后兑现拒绝（管理面，经 RLS 直改自己的行）
SET ROLE authenticated;
SET request.jwt.claim.sub TO '71000001-0000-0000-0000-000000000001';  -- A
SELECT throws_ok(
  $$UPDATE public.share_invites SET resource_id = '71200000-0000-0000-0000-000000000002'
    WHERE token = '71i-token-b-mismatch-0000007'$$,
  'new row violates row-level security policy for table "share_invites"',
  '属主不能把自己的邀请重指向别人的资源（update with check 同款校验）');
SELECT lives_ok(
  $$UPDATE public.share_invites SET status = 'revoked'
    WHERE token = '71i-token-b-mismatch-0000007'$$,
  '属主可撤销自己的邀请');
SELECT is(public.redeem_share_invite('71i-token-b-mismatch-0000007')->>'status', 'forbidden',
  '撤销后兑现拒绝');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
