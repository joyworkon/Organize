-- 083 匿名公开链接每日写入总量帽 pgTAP
--
-- 覆盖（对应 083 文件头的设计要点逐条）：
--   1. 结构：表存在、RLS 启用、表级权限收口（anon 不可直读直写）、
--      helper 的 EXECUTE 分层（anon 不可调，内部使用）
--   2. 核心不变量：**额度只在放行时消耗**——被拒的调用不计数（否则狂打就能把
--      计数打成噪声，且属主看到的是假的用量）
--   3. 次数与字节两个维度分别封顶，且互为补集
--   4. 两条匿名写通道（快照 save_public_note / blob save_note_ydoc_by_token）
--      **共用同一份账**：一条消耗，另一条立即看得见
--   5. 额度耗尽时两个通道各自给出独立信号（quota_exceeded），
--      不与 forbidden 混淆（forbidden 会让编辑器转只读，语义不同）
--   6. 登录用户通道（save_note_with_tasks_v2）不吃这份额度
--
-- 身份切换沿 063/067/071 约定。
BEGIN;
SELECT plan(29);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('83000001-0000-0000-0000-000000000001', 'p8_quota_a@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('83200000-0000-0000-0000-000000000001', '83000001-0000-0000-0000-000000000001',
   '额度验证笔记', '{"type":"doc","content":[{"type":"paragraph"}]}');

-- 不设名额（session_limit=null）：本测试只考察额度，避免名额闸门干扰
INSERT INTO public.shares
  (owner_id, resource_type, resource_id, token, is_public, access_mode, session_limit, ip_limit)
VALUES
  ('83000001-0000-0000-0000-000000000001', 'note', '83200000-0000-0000-0000-000000000001',
   '83s-quota-00000000000a', true, 'public_edit', NULL, NULL),
  ('83000001-0000-0000-0000-000000000001', 'note', '83200000-0000-0000-0000-000000000001',
   '83s-quota-b-00000000b', true, 'public_edit', NULL, NULL),
  ('83000001-0000-0000-0000-000000000001', 'note', '83200000-0000-0000-0000-000000000001',
   '83s-read-00000000000c', true, 'public_read', NULL, NULL);

-- ========== 1. 结构 ==========
SELECT has_table('public', 'share_write_quota', 'share_write_quota 表存在');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.share_write_quota'::regclass),
  true, 'share_write_quota 启用 RLS');

SELECT is(has_table_privilege('anon', 'public.share_write_quota', 'SELECT'), false,
  'anon 不可直读额度表（只经 DEFINER helper）');
SELECT is(has_table_privilege('anon', 'public.share_write_quota', 'INSERT'), false,
  'anon 不可直写额度表');
SELECT is(has_function_privilege('anon', 'public.consume_share_write_quota(uuid, bigint)', 'EXECUTE'),
  false, 'anon 不可调 helper（额度判定只由写入 RPC 内部调用）');
SELECT is(has_function_privilege('authenticated', 'public.consume_share_write_quota(uuid, bigint)', 'EXECUTE'),
  true, 'authenticated 可调 helper（沿 056 分层，实际调用方是 DEFINER RPC）');

-- 关键实现断言：加一与判额度必须压在同一条语句（文件头第 1 条）
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'consume_share_write_quota')
    LIKE '%on conflict%' AND (SELECT prosrc FROM pg_proc WHERE proname = 'consume_share_write_quota')
    LIKE '%where%',
  'helper 用 on conflict ... where 实现「放行才计数」的原子语义');

-- ========== 2. helper 基础行为 ==========
-- 用 ::text 归一：is() 是 anyelement 多态，两个未定型字面量实参会报
-- could not determine polymorphic type（pgTAP 老陷阱）
SELECT is(public.consume_share_write_quota(
    (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a'), 100)::text,
  'true', '首次写入放行');
SELECT is((SELECT writes::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a')), '1',
  '首次写入计数为 1');
SELECT is((SELECT bytes::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a')), '100',
  '首次写入记录字节数');

SELECT public.consume_share_write_quota(
    (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a'), 250);
SELECT is((SELECT writes::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a')), '2',
  '第二次调用计数累加到 2');
SELECT is((SELECT bytes::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a')), '350',
  '字节数累加到 350');

SELECT is(public.consume_share_write_quota(NULL, 10)::text, 'false', 'null 分享 → 拒');
SELECT is(public.consume_share_write_quota(
    (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a'), 1073741825)::text, 'false',
  '单次负载就超过总额度 → 拒（首次插入路径的漏判防护）');

-- ========== 3. 次数封顶 + 放行才计数（核心不变量）==========
-- 直接摆到上限的前一刻（避免跑一万次插入）
UPDATE public.share_write_quota SET writes = 10000, bytes = 0
 WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a');

SELECT is(public.consume_share_write_quota(
    (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a'), 10)::text, 'false',
  '次数已达上限 → 拒');
SELECT is((SELECT writes::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a')), '10000',
  '被拒的调用**不计数**（额度只在放行时消耗——核心不变量）');
SELECT is((SELECT bytes::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a')), '0',
  '被拒的调用也不累加字节');

-- ========== 4. 字节封顶（与次数互为补集）==========
UPDATE public.share_write_quota SET writes = 0, bytes = 1073741824
 WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a');
SELECT is(public.consume_share_write_quota(
    (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a'), 1)::text, 'false',
  '字节已达上限 → 拒（次数还有余量也拒）');
SELECT is((SELECT writes::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-00000000000a')), '0',
  '字节封顶被拒时同样不计数');

-- ========== 5. 快照通道接入额度 ==========
SELECT is(public.save_public_note('83s-quota-b-00000000b', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'ok', '额度充足时快照保存正常 ok');
SELECT is((SELECT writes::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-b-00000000b')), '1',
  '快照保存消耗了一次额度');

-- 把该分享打到上限，快照通道应给独立状态码
UPDATE public.share_write_quota SET writes = 10000
 WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-b-00000000b');
SELECT is(public.save_public_note('83s-quota-b-00000000b', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'quota_exceeded', '额度耗尽时快照保存返回 quota_exceeded（而非 forbidden）');

-- ========== 6. blob 通道共用同一份账 ==========
-- 83s-quota-00000000000a 当前 writes=0 / bytes=满 → 两通道共用账的直接证据：
-- 用 a 做 ydoc 保存，应因「同一份字节账已满」被拒
SELECT throws_ok(
  $$SELECT public.save_note_ydoc_by_token('83s-quota-00000000000a',
      '83200000-0000-0000-0000-000000000001', 'AAAAAA==')$$,
  'quota_exceeded',
  'blob 通道读到快照通道记满的字节账 → raise quota_exceeded（共用同一份账）');

-- read 分享是 viewer：应被角色判定拦下，且**不消耗额度**（额度在角色判定之后）
SELECT throws_ok(
  $$SELECT public.save_note_ydoc_by_token('83s-read-00000000000c',
      '83200000-0000-0000-0000-000000000001', 'AAAAAA==')$$,
  'forbidden', 'viewer 分享的 blob 写入被角色判定拦下（forbidden）');
SELECT is((SELECT count(*)::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-read-00000000000c')), '0',
  '被角色判定拒绝的写入不吃额度（额度判定在授权之后）');

-- 干净 editor 分享：ydoc 保存成功并记账
INSERT INTO public.shares
  (owner_id, resource_type, resource_id, token, is_public, access_mode, session_limit, ip_limit)
VALUES ('83000001-0000-0000-0000-000000000001', 'note', '83200000-0000-0000-0000-000000000001',
        '83s-quota-c-00000000d', true, 'public_edit', NULL, NULL);

SELECT lives_ok(
  $$SELECT public.save_note_ydoc_by_token('83s-quota-c-00000000d',
      '83200000-0000-0000-0000-000000000001', 'AAAAAA==')$$,
  'editor 分享的 blob 写入正常');
SELECT is((SELECT writes::text FROM public.share_write_quota
    WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-c-00000000d')), '1',
  'blob 写入消耗了一次额度');

-- 该分享额度打满 → 快照通道立刻看到（反向证明同一份账）
UPDATE public.share_write_quota SET writes = 10000
 WHERE share_id = (SELECT id FROM public.shares WHERE token = '83s-quota-c-00000000d');
SELECT is(public.save_public_note('83s-quota-c-00000000d', '{"type":"doc"}'::jsonb, NULL)->>'status',
  'quota_exceeded', 'blob 通道打满后，快照通道立即被拒（同一份账的另一向证明）');

-- ========== 7. 登录用户通道不吃这份额度 ==========
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'save_note_with_tasks_v2')
    NOT LIKE '%consume_share_write_quota%',
  '登录用户保存 RPC 不含额度判定（额度只作用于匿名 token 通道）');

SELECT * FROM finish();
ROLLBACK;
