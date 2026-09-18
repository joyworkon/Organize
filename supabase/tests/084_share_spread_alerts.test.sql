-- 084 分享扩散告警 pgTAP
--
-- 覆盖（对应 084 文件头的设计要点逐条）：
--   1. 结构：两列 + 默认值 + 部分索引 + EXECUTE 分层（仅 service_role）
--   2. 检测：低于阈值不告警、达到阈值告警；distinct_ips 正确
--   3. 信号口径：只有 denied_no_quota / denied_ip 算数——granted 与 forbidden
--      都不触发（否则属主自己反复刷新也会被告警）
--   4. 开关：未开启的分享不参与检测
--   5. 水位去重：同一波扩散只告警一次；水位之后的新拒绝才再告警
--   6. 失效分享跳过：已关闭 / 已过期的链接不再告警
--   7. 参数校验：非法参数 raise
BEGIN;
SELECT plan(23);

-- ========== 数据准备 ==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('84000001-0000-0000-0000-000000000001', 'p8_alert_a@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('84200000-0000-4000-8000-000000000001', '84000001-0000-0000-0000-000000000001',
   '告警验证笔记', '{"type":"doc","content":[{"type":"paragraph"}]}');

-- 四种分享：开了告警且会攒够拒绝 / 开了但不够 / 没开 / 已关闭
INSERT INTO public.shares
  (id, owner_id, resource_type, resource_id, token, is_public, access_mode,
   session_limit, spread_alert_enabled) VALUES
  ('84a00000-0000-4000-8000-000000000001', '84000001-0000-0000-0000-000000000001',
   'note', '84200000-0000-4000-8000-000000000001', '84s-hot--000000000000a', true, 'public_read', 1, true),
  ('84a00000-0000-4000-8000-000000000002', '84000001-0000-0000-0000-000000000001',
   'note', '84200000-0000-4000-8000-000000000001', '84s-cold-000000000000b', true, 'public_read', 1, true),
  ('84a00000-0000-4000-8000-000000000003', '84000001-0000-0000-0000-000000000001',
   'note', '84200000-0000-4000-8000-000000000001', '84s-off--000000000000c', true, 'public_read', 1, false),
  ('84a00000-0000-4000-8000-000000000004', '84000001-0000-0000-0000-000000000001',
   'note', '84200000-0000-4000-8000-000000000001', '84s-dead-000000000000d', false, 'disabled', 1, true);

-- 两条新列的默认值（不指定时）
INSERT INTO public.shares
  (owner_id, resource_type, resource_id, token, is_public, access_mode)
VALUES ('84000001-0000-0000-0000-000000000001', 'note', '84200000-0000-4000-8000-000000000001',
        '84s-dflt-000000000000e', true, 'public_read');

-- ========== 1. 结构 ==========
SELECT col_type_is('public', 'shares', 'spread_alert_enabled', 'boolean',
  'shares.spread_alert_enabled 是 boolean');
SELECT is((SELECT column_default FROM information_schema.columns
    WHERE table_name='shares' AND column_name='spread_alert_enabled'), 'false',
  'spread_alert_enabled 默认 false（推送是侵入性的，未经同意不发）');
SELECT col_type_is('public', 'shares', 'last_spread_alert_at', 'timestamp with time zone',
  'shares.last_spread_alert_at 是 timestamptz');
SELECT is((SELECT spread_alert_enabled::text FROM public.shares WHERE token='84s-dflt-000000000000e'),
  'false', '未指定时新分享默认不开告警');
SELECT ok((SELECT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='share_access_log_denied_idx')),
  '被拒记录的检测索引存在');

SELECT is(has_function_privilege('service_role',
    'public.claim_spread_alerts(integer, integer, interval)', 'EXECUTE'), true,
  'service_role 可调 claim_spread_alerts（cron 路由用）');
SELECT is(has_function_privilege('anon',
    'public.claim_spread_alerts(integer, integer, interval)', 'EXECUTE'), false,
  'anon 不可调 claim_spread_alerts');
SELECT is(has_function_privilege('authenticated',
    'public.claim_spread_alerts(integer, integer, interval)', 'EXECUTE'), false,
  'authenticated 不可调 claim_spread_alerts（属主读取走别的入口）');

-- ========== 2. 低于阈值不告警 ==========
INSERT INTO public.share_access_log (share_id, ip, outcome) VALUES
  ('84a00000-0000-4000-8000-000000000002', '10.0.0.1', 'denied_no_quota'),
  ('84a00000-0000-4000-8000-000000000002', '10.0.0.2', 'denied_no_quota');

SELECT is((SELECT count(*)::text FROM public.claim_spread_alerts(50, 5)),
  '0', '拒绝次数低于阈值 → 不告警');

-- ========== 3. 达到阈值告警（一次调用，\gset 接多处断言）==========
-- claim 是**消费型**的（会打水位并消耗告警），所以字段断言必须取自同一次调用；
-- 连续调两次来分别断言 count 与字段是自相矛盾的写法（实测踩过）
-- hot 攒 5 条拒绝（4 个不同 IP），并混入 granted 与 forbidden——后两者不该计数
INSERT INTO public.share_access_log (share_id, ip, outcome) VALUES
  ('84a00000-0000-4000-8000-000000000001', '10.1.0.1', 'denied_no_quota'),
  ('84a00000-0000-4000-8000-000000000001', '10.1.0.2', 'denied_no_quota'),
  ('84a00000-0000-4000-8000-000000000001', '10.1.0.3', 'denied_no_quota'),
  ('84a00000-0000-4000-8000-000000000001', '10.1.0.4', 'denied_ip'),
  ('84a00000-0000-4000-8000-000000000001', '10.1.0.4', 'denied_ip'),
  ('84a00000-0000-4000-8000-000000000001', '10.1.0.9', 'granted'),
  ('84a00000-0000-4000-8000-000000000001', '10.1.0.9', 'forbidden');

SELECT denied_count, distinct_ips, owner_id, resource_id
  FROM public.claim_spread_alerts(50, 5) \gset
-- 全部显式 ::text：is() 是 anyelement 多态，两个未定型字面量实参会报
-- could not determine polymorphic type（pgTAP 老陷阱，与 083 同一处）
SELECT is((:'denied_count')::text, '5',
  'denied_count 只数 denied_no_quota/denied_ip（granted 与 forbidden 不计）');
SELECT is((:'distinct_ips')::text, '4', 'distinct_ips 正确去重（4 个不同 IP）');
SELECT is((:'owner_id')::text, '84000001-0000-0000-0000-000000000001', '带回属主 id 供推送');
SELECT is((:'resource_id')::text, '84200000-0000-4000-8000-000000000001',
  '带回资源 id 供拼通知链接');

-- ========== 4. 水位去重：同一波只提醒一次 ==========
SELECT is((SELECT count(*)::text FROM public.claim_spread_alerts(50, 5)), '0',
  '同一波扩散第二次调用不再告警（水位去重）');
SELECT ok((SELECT last_spread_alert_at IS NOT NULL FROM public.shares
    WHERE token = '84s-hot--000000000000a'), '水位已写入分享行');

-- 水位之后又来一批新的拒绝 → 再次告警。
-- created_at 必须显式晚于水位：整个测试在同一事务内，now() 是事务开始时间且恒定，
-- 不偏移的话新行与水位相等，会被 `created_at > 水位` 过滤掉（实测踩过）
INSERT INTO public.share_access_log (share_id, ip, outcome, created_at)
SELECT '84a00000-0000-4000-8000-000000000001', '10.2.0.' || g, 'denied_no_quota',
       now() + interval '1 second'
  FROM generate_series(1, 6) g;
SELECT is((SELECT count(*)::text FROM public.claim_spread_alerts(50, 5)), '1',
  '水位之后攒够新的拒绝 → 再次告警（新一波）');

-- ========== 5. 开关与失效分享 ==========
-- 关掉告警后不再参与检测（重新攒一批拒绝也不告警）
UPDATE public.shares SET last_spread_alert_at = NULL, spread_alert_enabled = false
 WHERE token = '84s-off--000000000000c';
INSERT INTO public.share_access_log (share_id, ip, outcome)
SELECT '84a00000-0000-4000-8000-000000000003', '10.3.0.' || g, 'denied_no_quota'
  FROM generate_series(1, 8) g;
SELECT is((SELECT count(*)::text FROM public.claim_spread_alerts(50, 5)
    WHERE share_id = '84a00000-0000-4000-8000-000000000003'),
  '0', '未开启告警的分享不参与检测');

UPDATE public.shares SET spread_alert_enabled = true, last_spread_alert_at = NULL
 WHERE token = '84s-off--000000000000c';
SELECT is((SELECT count(*)::text FROM public.claim_spread_alerts(50, 5)
    WHERE share_id = '84a00000-0000-4000-8000-000000000003'),
  '1', '开启后同一批拒绝立即被检出（开关即时生效）');

-- 已过期的分享跳过
INSERT INTO public.shares
  (id, owner_id, resource_type, resource_id, token, is_public, access_mode,
   session_limit, spread_alert_enabled, expires_at)
VALUES ('84a00000-0000-4000-8000-000000000005', '84000001-0000-0000-0000-000000000001',
        'note', '84200000-0000-4000-8000-000000000001', '84s-exp--000000000000f',
        true, 'public_read', 1, true, now() - interval '1 hour');
INSERT INTO public.share_access_log (share_id, ip, outcome)
SELECT '84a00000-0000-4000-8000-000000000005', '10.4.0.' || g, 'denied_no_quota'
  FROM generate_series(1, 8) g;
SELECT is((SELECT count(*)::text FROM public.claim_spread_alerts(50, 5)
    WHERE share_id = '84a00000-0000-4000-8000-000000000005'),
  '0', '已过期的分享跳过（不再产生新拒绝，无需提醒）');

-- 已关闭的分享（is_public=false）同样跳过：属主已撤销链接，无需再提醒
INSERT INTO public.share_access_log (share_id, ip, outcome)
SELECT '84a00000-0000-4000-8000-000000000004', '10.5.0.' || g, 'denied_no_quota'
  FROM generate_series(1, 8) g;
SELECT is((SELECT count(*)::text FROM public.claim_spread_alerts(50, 5)
    WHERE share_id = '84a00000-0000-4000-8000-000000000004'),
  '0', '已关闭的分享跳过（属主已撤销，无需提醒）');

-- ========== 7. 参数校验 ==========
SELECT throws_ok($$SELECT public.claim_spread_alerts(0, 5)$$,
  'invalid arguments', 'limit=0 被拒');
SELECT throws_ok($$SELECT public.claim_spread_alerts(50, 0)$$,
  'invalid arguments', 'min_denials=0 被拒');
SELECT throws_ok($$SELECT public.claim_spread_alerts(50, 5, interval '0')$$,
  'invalid arguments', '窗口为 0 被拒');

SELECT * FROM finish();
ROLLBACK;
