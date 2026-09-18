-- 082 公开链接的访问名额与 IP 闸门 pgTAP
--
-- 覆盖（对应 082 文件头的安全设计逐条）：
--   1. 结构：两列 + 三条约束 + 两表 + 幂等唯一索引 + RLS + EXECUTE 分层
--      （claim 匿名可调；list/release 只给登录态；share_session_ok 不给 anon）
--   2. **向后兼容是硬前提**：session_limit 为 null 的分享行，在 get_public_share /
--      resolve_share_access / save_public_note 上逐条复现 072 的行为，且**少传一个
--      实参**（2 参 / 3 参调用）仍可解析——这是默认参数兑现的兼容承诺
--   3. 名额：首人认领成功 → 第二人被拒（no_quota）→ 同行 claim_id 幂等不吃第二个名额
--   4. 名额闸门对四条通道同时生效：读页面 / 判权 / 快照保存 / ydoc 读写，
--      且 get_public_share 在未认领时**不带 resource**（内容在服务端就断掉）
--   5. IP 档：白名单外的 IP 被拒（ip_mismatch）→ 同 IP 在名额内可再进 →
--      p_ip 为空时 fail-open（无代理部署不锁死自己）
--   6. 失效链接（disabled / 过期 / 伪造 token / null）认领一律 forbidden
--   7. reading_item 分享同样受名额闸门约束
--   8. 属主管理面：非属主拿不到 list / release；属主可释放并让名额回到可用
--   9. 结构断言（prosrc）：claim 里有 `for update`（并发串行化的根）、
--      三条通道都走 share_session_ok（闸门只有一处实现）
--
-- 身份切换沿 063/067/071 约定：SET ROLE authenticated + SET request.jwt.claim.sub。
-- 认领路径不依赖 uid（token 即能力），故在 postgres 会话下直接调即可。
BEGIN;
SELECT plan(71);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('82000001-0000-0000-0000-000000000001', 'p8_limit_a@test'),
    ('82000002-0000-0000-0000-000000000002', 'p8_limit_b@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('82200000-0000-0000-0000-000000000001', '82000001-0000-0000-0000-000000000001',
   'A的公开笔记', '{"type":"doc","content":[{"type":"paragraph"}]}');

INSERT INTO public.reading_items (id, user_id, url, title) VALUES
  ('82300000-0000-0000-0000-000000000001', '82000001-0000-0000-0000-000000000001',
   'https://example.com/p8', 'A的文章');

-- 分享矩阵：open=不设限（兼容基准）；one=仅首人；two=两名额；ip=名额 5 + IP 档 1；
-- read=只读+仅首人；off/exp=失效态；art=reading_item + 仅首人
INSERT INTO public.shares
  (owner_id, resource_type, resource_id, token, is_public, access_mode, session_limit, ip_limit, expires_at) VALUES
  ('82000001-0000-0000-0000-000000000001', 'note', '82200000-0000-0000-0000-000000000001',
   '82s-open-0000000000000a', true, 'public_edit', NULL, NULL, NULL),
  ('82000001-0000-0000-0000-000000000001', 'note', '82200000-0000-0000-0000-000000000001',
   '82s-one--0000000000000b', true, 'public_edit', 1, NULL, NULL),
  ('82000001-0000-0000-0000-000000000001', 'note', '82200000-0000-0000-0000-000000000001',
   '82s-two--0000000000000c', true, 'public_edit', 2, NULL, NULL),
  ('82000001-0000-0000-0000-000000000001', 'note', '82200000-0000-0000-0000-000000000001',
   '82s-ip---0000000000000d', true, 'public_edit', 5, 1, NULL),
  ('82000001-0000-0000-0000-000000000001', 'note', '82200000-0000-0000-0000-000000000001',
   '82s-read-0000000000000e', true, 'public_read', 1, NULL, NULL),
  ('82000001-0000-0000-0000-000000000001', 'note', '82200000-0000-0000-0000-000000000001',
   '82s-off--0000000000000f', false, 'disabled', 1, NULL, NULL),
  ('82000001-0000-0000-0000-000000000001', 'note', '82200000-0000-0000-0000-000000000001',
   '82s-exp--0000000000000g', true, 'public_edit', 1, NULL, now() - interval '1 hour'),
  ('82000001-0000-0000-0000-000000000001', 'reading_item', '82300000-0000-0000-0000-000000000001',
   '82s-art--0000000000000h', true, 'public_read', 1, NULL, NULL);

-- ========== 1. 结构 ==========
SELECT col_type_is('public', 'shares', 'session_limit', 'integer', 'shares.session_limit 是 integer');
SELECT col_type_is('public', 'shares', 'ip_limit', 'integer', 'shares.ip_limit 是 integer');

SELECT ok((SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shares_session_limit_bounds'
      AND conrelid = 'public.shares'::regclass AND contype = 'c')),
  'session_limit 档位约束存在（null 或 >=1）');
SELECT ok((SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shares_ip_limit_bounds'
      AND conrelid = 'public.shares'::regclass AND contype = 'c')),
  'ip_limit 档位约束存在（null 或 >=1）');
SELECT ok((SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shares_ip_limit_requires_session_limit'
      AND conrelid = 'public.shares'::regclass AND contype = 'c')),
  'ip_limit 必须与 session_limit 同时设置（拒绝死配置）');

-- 档位约束负例：0 / 负数无意义
SELECT throws_ok(
  $$UPDATE public.shares SET session_limit = 0 WHERE token = '82s-one--0000000000000b'$$,
  'new row for relation "shares" violates check constraint "shares_session_limit_bounds"',
  'session_limit=0 被拒');
SELECT throws_ok(
  $$UPDATE public.shares SET ip_limit = 1 WHERE token = '82s-open-0000000000000a'$$,
  'new row for relation "shares" violates check constraint "shares_ip_limit_requires_session_limit"',
  '只设 ip_limit 不设 session_limit 被拒（用 session_limit 为 null 的行作负例）');

SELECT has_table('public', 'share_sessions', 'share_sessions 表存在');
SELECT has_table('public', 'share_access_log', 'share_access_log 表存在');
SELECT ok((SELECT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'share_sessions_share_claim_uniq')),
  'claim_id 幂等唯一索引存在');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.share_sessions'::regclass),
  true, 'share_sessions 启用 RLS');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.share_access_log'::regclass),
  true, 'share_access_log 启用 RLS');

-- EXECUTE 分层：匿名通道可调，管理面只给登录态
SELECT is(has_function_privilege('anon', 'public.claim_share_session(text, text, uuid)', 'EXECUTE'),
  true, 'anon 可调 claim_share_session（匿名认领是本次能力的入口）');
SELECT is(has_function_privilege('anon', 'public.get_public_share(text, uuid)', 'EXECUTE'),
  true, 'anon 可调 get_public_share（签名已含 p_session_id）');
SELECT is(has_function_privilege('anon', 'public.list_share_sessions(uuid)', 'EXECUTE'),
  false, 'anon 不可调 list_share_sessions（属主管理面）');
SELECT is(has_function_privilege('anon', 'public.release_share_sessions(uuid)', 'EXECUTE'),
  false, 'anon 不可调 release_share_sessions（属主管理面）');
SELECT is(has_function_privilege('anon', 'public.share_session_ok(uuid, uuid)', 'EXECUTE'),
  false, 'anon 不可调 share_session_ok（不把会话存在性变成探针）');
SELECT is(has_function_privilege('authenticated', 'public.list_share_sessions(uuid)', 'EXECUTE'),
  true, 'authenticated 可调 list_share_sessions（函数内再校属主）');

-- ========== 2. 向后兼容：session_limit 为 null = 现状逐条不变 ==========
SELECT is((SELECT status FROM public.get_public_share('82s-open-0000000000000a')), 'active',
  '不设限的链接：get_public_share 仍 active');
SELECT is((SELECT resource->>'id' FROM public.get_public_share('82s-open-0000000000000a')),
  '82200000-0000-0000-0000-000000000001', '不设限的链接：内容照常返回');
-- 关键：**少传一个实参**仍可解析（默认参数兑现的兼容承诺——所有存量调用点形状不变）
SELECT is(public.resolve_share_access('82s-open-0000000000000a',
    '82200000-0000-0000-0000-000000000001'), 'editor',
  '不设限的链接：2 参调用 resolve_share_access 仍 → editor（默认参数兼容）');
SELECT is(public.resolve_share_access('82s-open-0000000000000a',
    '82200000-0000-0000-0000-000000000001', NULL), 'editor',
  '不设限的链接：显式传 null 会话 → editor（会话不是门槛）');
SELECT is((SELECT status FROM public.get_public_share('82s-open-0000000000000a',
    '82f00000-0000-0000-0000-0000000000ff')), 'active',
  '不设限的链接：传一个不存在的会话 id 也照常 active（不启用会话校验）');
SELECT is(public.save_public_note('82s-open-0000000000000a', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'ok', '不设限的链接：3 参 save_public_note 仍 ok（存量调用点形状不变）');
SELECT is(public.claim_share_session('82s-open-0000000000000a', '1.1.1.1')->>'status', 'not_required',
  '不设限的链接：认领返回 not_required（不产生会话行）');

-- ========== 3. 名额 = 1：首人独占（需求 1 的核心）==========
-- claim_id 幂等键：重复提交（双击/重试/StrictMode 双跑）必须返回同一会话
SELECT is(public.claim_share_session('82s-one--0000000000000b', '1.1.1.1',
    '82c00000-0000-0000-0000-0000000000a1')->>'status', 'ok', '仅首人的链接：第一个认领者拿到名额');
SELECT is(public.claim_share_session('82s-one--0000000000000b', '1.1.1.1',
    '82c00000-0000-0000-0000-0000000000a1')->>'reused', 'true',
  '同一 claim_id 重复提交 → 复用同一会话（幂等，不吃第二个名额）');
SELECT is((SELECT count(*)::text FROM public.share_sessions
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b')), '1',
  '幂等重复提交后仍只有 1 行会话');
SELECT is(public.claim_share_session('82s-one--0000000000000b', '2.2.2.2',
    '82c00000-0000-0000-0000-0000000000b1')->>'status', 'no_quota',
  '第二个人认领同一链接 → no_quota（转发者被挡在门外）');
SELECT is((SELECT count(*)::text FROM public.share_sessions
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b')
      AND released_at IS NULL), '1',
  '被拒的认领不产生新会话行');

-- 审计：成功与被拒都留痕（属主在面板看得到）
SELECT is((SELECT count(*)::text FROM public.share_access_log
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b')
      AND outcome = 'granted'), '1', '审计记录 1 条 granted');
SELECT is((SELECT count(*)::text FROM public.share_access_log
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b')
      AND outcome = 'denied_no_quota'), '1', '审计记录 1 条 denied_no_quota');

-- 取出首人的会话凭证，供后续四条通道验证
SELECT (public.claim_share_session('82s-one--0000000000000b', '1.1.1.1',
    '82c00000-0000-0000-0000-0000000000a1')->>'session_id')::uuid AS sid_one \gset

-- ========== 4. 名额闸门对四条通道同时生效 ==========
SELECT is((SELECT status FROM public.get_public_share('82s-one--0000000000000b')), 'claim_required',
  '未认领读页面 → claim_required');
SELECT is((SELECT resource FROM public.get_public_share('82s-one--0000000000000b')), NULL,
  '未认领读页面 → resource 为 null（内容在服务端就断掉，不靠前端藏）');
SELECT is((SELECT status FROM public.get_public_share('82s-one--0000000000000b', :'sid_one'::uuid)),
  'active', '持有效会话读页面 → active');
SELECT is((SELECT status FROM public.get_public_share('82s-one--0000000000000b',
    '82f00000-0000-0000-0000-0000000000ff')), 'claim_required',
  '持无效会话读页面 → 退回 claim_required');
SELECT is(public.resolve_share_access('82s-one--0000000000000b',
    '82200000-0000-0000-0000-000000000001'), NULL,
  '无会话判权 → null（collab-server 握手会被拒）');
SELECT is(public.resolve_share_access('82s-one--0000000000000b',
    '82200000-0000-0000-0000-000000000001', :'sid_one'::uuid), 'editor',
  '持有效会话判权 → editor');
SELECT is(public.save_public_note('82s-one--0000000000000b', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'forbidden', '无会话快照保存 → forbidden');
SELECT is(public.save_public_note('82s-one--0000000000000b', '{"type":"doc"}'::jsonb, NULL,
    NULL, NULL, :'sid_one'::uuid)->>'status', 'ok', '持有效会话快照保存 → ok');
SELECT is(public.get_note_ydoc_by_token('82s-one--0000000000000b',
    '82200000-0000-0000-0000-000000000001'), NULL, '无会话回放 ydoc → null');
SELECT throws_ok(
  $$SELECT public.save_note_ydoc_by_token('82s-one--0000000000000b',
      '82200000-0000-0000-0000-000000000001', 'AAAAAA==')$$,
  'forbidden', '无会话落库 ydoc → raise forbidden');

-- 有会话的 ydoc 读写：先把 content 的 updated_at 往回拨，满足 067 新鲜度规则
-- （y.updated_at >= n.updated_at），否则读回 null 是新鲜度而非权限所致
UPDATE public.notes SET updated_at = now() - interval '1 hour'
 WHERE id = '82200000-0000-0000-0000-000000000001';
SELECT lives_ok(
  format('SELECT public.save_note_ydoc_by_token(%L, %L::uuid, %L, %L::uuid)',
    '82s-one--0000000000000b', '82200000-0000-0000-0000-000000000001',
    'AAAAAA==', :'sid_one'),
  '持有效会话落库 ydoc → 不抛错');
SELECT is(public.get_note_ydoc_by_token('82s-one--0000000000000b',
    '82200000-0000-0000-0000-000000000001', :'sid_one'::uuid), 'AAAAAA==',
  '持有效会话读回 ydoc → 拿到刚写入的 blob（证明会话闸门放行而非新鲜度拦住）');

-- ========== 5. 名额 = 2：第二个名额可用，第三个被拒 ==========
SELECT is(public.claim_share_session('82s-two--0000000000000c', '1.1.1.1',
    '82c00000-0000-0000-0000-0000000000c1')->>'status', 'ok', '两名额链接：第 1 个名额认领成功');
SELECT is(public.claim_share_session('82s-two--0000000000000c', '1.1.1.1',
    '82c00000-0000-0000-0000-0000000000c2')->>'status', 'ok', '两名额链接：第 2 个名额认领成功');
SELECT is(public.claim_share_session('82s-two--0000000000000c', '1.1.1.1',
    '82c00000-0000-0000-0000-0000000000c3')->>'status', 'no_quota', '两名额链接：第 3 个被拒');

-- ========== 6. IP 档（软约束）==========
SELECT is(public.claim_share_session('82s-ip---0000000000000d', '9.9.9.9',
    '82c00000-0000-0000-0000-0000000000d1')->>'status', 'ok', 'IP 档：首个 IP 认领成功');
SELECT is(public.claim_share_session('82s-ip---0000000000000d', '8.8.8.8',
    '82c00000-0000-0000-0000-0000000000d2')->>'status', 'ip_mismatch',
  'IP 档：白名单外的新 IP 被拒（名额还有余量也拒）');
SELECT is(public.claim_share_session('82s-ip---0000000000000d', '9.9.9.9',
    '82c00000-0000-0000-0000-0000000000d3')->>'status', 'ok',
  'IP 档：已在白名单内的 IP 在名额余量内可继续进');
SELECT is(public.claim_share_session('82s-ip---0000000000000d', NULL,
    '82c00000-0000-0000-0000-0000000000d4')->>'status', 'ok',
  'IP 档：p_ip 为空 → fail-open（无代理部署不锁死自己）');
SELECT is((SELECT count(*)::text FROM public.share_access_log
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '82s-ip---0000000000000d')
      AND outcome = 'denied_ip'), '1', '审计记录 1 条 denied_ip');

-- ========== 7. 失效链接的认领一律 forbidden ==========
SELECT is(public.claim_share_session('82s-off--0000000000000f', '1.1.1.1')->>'status', 'forbidden',
  'disabled 链接认领 → forbidden');
SELECT is(public.claim_share_session('82s-exp--0000000000000g', '1.1.1.1')->>'status', 'forbidden',
  '已过期链接认领 → forbidden');
SELECT is(public.claim_share_session('82s-no-such-token-00000', '1.1.1.1')->>'status', 'forbidden',
  '伪造 token 认领 → forbidden（与失效态不可区分）');
SELECT is(public.claim_share_session(NULL, '1.1.1.1')->>'status', 'forbidden', 'null token → forbidden');

-- ========== 8. reading_item 分享同样受名额闸门约束 ==========
SELECT is(public.claim_share_session('82s-art--0000000000000h', '1.1.1.1',
    '82c00000-0000-0000-0000-0000000000e1')->>'status', 'ok', 'reading_item 分享：首人认领成功');
SELECT is(public.claim_share_session('82s-art--0000000000000h', '1.1.1.1',
    '82c00000-0000-0000-0000-0000000000e2')->>'status', 'no_quota',
  'reading_item 分享：第二人被拒');
SELECT (public.claim_share_session('82s-art--0000000000000h', '1.1.1.1',
    '82c00000-0000-0000-0000-0000000000e1')->>'session_id')::uuid AS sid_art \gset
SELECT is((SELECT status FROM public.get_public_share('82s-art--0000000000000h')), 'claim_required',
  'reading_item 分享：未认领读页面 → claim_required');
SELECT is((SELECT status FROM public.get_public_share('82s-art--0000000000000h', :'sid_art'::uuid)),
  'active', 'reading_item 分享：持有效会话读页面 → active');

-- ========== 9. 属主管理面：看名额占用 / 一键释放 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '82000002-0000-0000-0000-000000000002';  -- B（非属主）
SELECT is(public.release_share_sessions(
    (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b'))->>'status', 'forbidden',
  '非属主释放会话 → forbidden');
SELECT is((SELECT count(*)::text FROM public.list_share_sessions(
    (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b'))), '0',
  '非属主查看会话列表 → 空集（不区分「不是你的」与「没有」）');
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub TO '82000001-0000-0000-0000-000000000001';  -- A（属主）
SELECT ok((SELECT count(*) FROM public.list_share_sessions(
    (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b'))) >= 1,
  '属主查看会话列表 → 看到已占名额');
SELECT is(public.release_share_sessions(
    (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b'))->>'status', 'ok',
  '属主释放会话 → ok');
RESET ROLE;

SELECT is((SELECT count(*)::text FROM public.share_sessions
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b')
      AND released_at IS NULL), '0', '释放后无活跃会话（名额回到可用）');
SELECT is(public.claim_share_session('82s-one--0000000000000b', '3.3.3.3',
    '82c00000-0000-0000-0000-0000000000f1')->>'status', 'ok',
  '释放后换设备的人可重新认领（属主纠偏阀生效）');

SET ROLE authenticated;
SET request.jwt.claim.sub TO '82000001-0000-0000-0000-000000000001';
SELECT is(public.release_share_sessions(
    (SELECT id FROM public.shares WHERE token = '82s-one--0000000000000b'))->>'released', '1',
  '再次释放：只释放新产生的那一个会话');
RESET ROLE;

-- ========== 10. 结构断言：闸门只有一处实现、认领必须持行锁 ==========
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'claim_share_session' AND pronargs = 3)
    LIKE '%for update%',
  'claim_share_session 持 shares 行锁（并发认领串行化的根，缺它 session_limit=1 会双双入选）');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'resolve_share_access' AND pronargs = 3)
    LIKE '%share_session_ok%',
  'resolve_share_access 走 share_session_ok（判权通道的闸门）');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'save_public_note' AND pronargs = 6)
    LIKE '%share_session_ok%',
  'save_public_note 走 share_session_ok（写通道的闸门）');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'get_public_share' AND pronargs = 2)
    LIKE '%claim_required%',
  'get_public_share 有 claim_required 分支（读页面不带内容）');

SELECT * FROM finish();
ROLLBACK;
