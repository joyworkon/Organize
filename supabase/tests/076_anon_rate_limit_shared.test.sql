-- 076 匿名入口多实例限流 pgTAP（A06）
--
-- 覆盖（docs/anon-rate-limit-design.md §5 验收映射）：
--   1. 结构：表/索引/RLS 启用且无 policy；anon 无表级权限；EXECUTE 分层
--      （consume 匿名通道 anon 可调，purge 只给服务端角色）
--   2. RLS/表权限负例：anon 直读直写全拒（限流状态不可被客户端篡改）
--   3. 基本语义：限额内 true、超限 false、拒绝后继续拒绝（拒绝也计数）、
--      不同 key 互不影响
--   4. 多实例合计：两个「实例」（交替调用序列）对同一 key 全局合计限额
--   5. 窗口滚动：上一窗口的计数不带入本窗口（固定窗口重置语义）
--   6. 参数校验负例：坏 key / 越界 limit / 越界 window 全部 raise
--   7. purge_rate_limit_hits：只删 15 分钟未触碰的行并返回删除数
BEGIN;
SELECT plan(43);

-- ========== 1. 结构 ==========
SELECT has_table('public', 'rate_limit_hits', '表 rate_limit_hits 存在');
SELECT col_type_is('public', 'rate_limit_hits', 'key', 'text', 'key 列 text');
SELECT col_type_is('public', 'rate_limit_hits', 'window_start', 'bigint', 'window_start 列 bigint');
SELECT has_index('public', 'rate_limit_hits', 'rate_limit_hits_updated_at_idx',
  'updated_at 有清理索引');
SELECT is((SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public'
  AND tablename = 'rate_limit_hits'), true, 'RLS 启用');
SELECT is((SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public'
  AND tablename = 'rate_limit_hits'), 0, '刻意无任何 policy（直读直写全拒）');
SELECT is(has_table_privilege('anon', 'public.rate_limit_hits', 'SELECT'), false,
  'anon 无表级 SELECT');
SELECT is(has_table_privilege('anon', 'public.rate_limit_hits', 'INSERT'), false,
  'anon 无表级 INSERT');
SELECT is(has_function_privilege('anon', 'public.consume_rate_limit(text, integer, bigint)', 'EXECUTE'),
  true, 'anon 可调 consume_rate_limit（匿名通道）');
SELECT is(has_function_privilege('authenticated', 'public.consume_rate_limit(text, integer, bigint)', 'EXECUTE'),
  true, 'authenticated 可调 consume_rate_limit');
SELECT is(has_function_privilege('anon', 'public.purge_rate_limit_hits()', 'EXECUTE'), false,
  'anon 不可调 purge（清理不是匿名通道的事）');
SELECT is(has_function_privilege('service_role', 'public.purge_rate_limit_hits()', 'EXECUTE'), true,
  'service_role 可调 purge');

-- ========== 2. RLS / 表权限负例 ==========
SET ROLE anon;
-- 表级权限已 revoke + RLS 无 policy：直读直接 permission denied（比空集更强的
-- fail-closed；错误先于 RLS 求值）
SELECT throws_ok($$SELECT count(*) FROM public.rate_limit_hits$$,
  'permission denied for table rate_limit_hits', 'anon 直读被拒（permission denied）');
SELECT throws_ok($$INSERT INTO public.rate_limit_hits (key, window_start, hits)
  VALUES ('rl-anon-direct-insert', 0, 1)$$,
  'permission denied for table rate_limit_hits', 'anon 直插被拒');
RESET ROLE;

-- ========== 3. 基本语义（anon 角色调用 = 真实路径） ==========
SET ROLE anon;
SELECT is(public.consume_rate_limit('76t-basic', 3, 60000), true, '第 1 次放行');
SELECT is(public.consume_rate_limit('76t-basic', 3, 60000), true, '第 2 次放行');
SELECT is(public.consume_rate_limit('76t-basic', 3, 60000), true, '第 3 次放行');
SELECT is(public.consume_rate_limit('76t-basic', 3, 60000), false, '第 4 次拒绝（超限）');
SELECT is(public.consume_rate_limit('76t-basic', 3, 60000), false, '拒绝后继续拒绝（拒绝也计数）');
SELECT is(public.consume_rate_limit('76t-other', 3, 60000), true, '不同 key 互不影响');
RESET ROLE;
-- 拒绝也计数的落库证据（postgres 直读）：5 次调用（3 放行 + 2 拒绝）= 5 hits
SELECT is((SELECT hits FROM public.rate_limit_hits WHERE key = '76t-basic'), 5,
  '拒绝的调用同样计数（UPSERT 无条件自增）');

-- ========== 4. 多实例合计（A06 核心验收） ==========
-- 模拟两个实例对同一 key 交替消费：共享行计数，全局合计 5 次
SET ROLE anon;
SELECT is(public.consume_rate_limit('76t-shared', 5, 60000), true, '实例A 第 1 次');
SELECT is(public.consume_rate_limit('76t-shared', 5, 60000), true, '实例B 第 2 次');
SELECT is(public.consume_rate_limit('76t-shared', 5, 60000), true, '实例A 第 3 次');
SELECT is(public.consume_rate_limit('76t-shared', 5, 60000), true, '实例B 第 4 次');
SELECT is(public.consume_rate_limit('76t-shared', 5, 60000), true, '实例A 第 5 次');
SELECT is(public.consume_rate_limit('76t-shared', 5, 60000), false, '实例B 第 6 次拒绝——两实例合计额度正确');
-- 同一 token 的 IP 档与总量档是两个独立 key（两级键语义在共享存储下不变）
-- key 含点分 IP 是合法形状（正则含 "."——裁掉会让 web IP 档恒 fallback）
SELECT is(public.consume_rate_limit('76t-ip:ti:tok:198.51.100.7', 1, 60000), true,
  'key 含点分 IP 合法（IP 档 key 形状）');
SELECT is(public.consume_rate_limit('76t-two:t:tok', 2, 60000), true, '总量档第 1 次');
SELECT is(public.consume_rate_limit('76t-two:ti:tok:1.2.3.4', 2, 60000), true, 'IP 档独立计数第 1 次');
SELECT is(public.consume_rate_limit('76t-two:ti:tok:1.2.3.4', 2, 60000), true, 'IP 档第 2 次');
SELECT is(public.consume_rate_limit('76t-two:ti:tok:1.2.3.4', 2, 60000), false, 'IP 档超限不影响总量档');
SELECT is(public.consume_rate_limit('76t-two:t:tok', 2, 60000), true, '总量档仍放行');
RESET ROLE;

-- ========== 5. 窗口滚动 ==========
-- 把现有行改到上一窗口（模拟 1 分钟前留下的计数），新窗口应重置
UPDATE public.rate_limit_hits
   SET window_start = window_start - 60000
 WHERE key = '76t-basic';
SET ROLE anon;
SELECT is(public.consume_rate_limit('76t-basic', 3, 60000), true,
  '窗口滚动后计数重置（上一窗口的 6 hits 不带入）');
RESET ROLE;

-- ========== 6. 参数校验负例 ==========
SELECT throws_ok($$SELECT public.consume_rate_limit(NULL, 3, 60000)$$,
  NULL, 'key NULL 拒绝');
SELECT throws_ok($$SELECT public.consume_rate_limit('76bad key!', 3, 60000)$$,
  NULL, 'key 含非法字符拒绝');
SELECT throws_ok($$SELECT public.consume_rate_limit('76ok', 0, 60000)$$,
  NULL, 'limit < 1 拒绝');
SELECT throws_ok($$SELECT public.consume_rate_limit('76ok', 100001, 60000)$$,
  NULL, 'limit > 100000 拒绝');
SELECT throws_ok($$SELECT public.consume_rate_limit('76ok', 3, 999)$$,
  NULL, 'window < 1s 拒绝');
SELECT throws_ok($$SELECT public.consume_rate_limit('76ok', 3, 3600001)$$,
  NULL, 'window > 1h 拒绝');

-- ========== 7. purge_rate_limit_hits ==========
INSERT INTO public.rate_limit_hits (key, window_start, hits, updated_at) VALUES
  ('76p-stale-1', 0, 5, now() - interval '20 minutes'),
  ('76p-stale-2', 0, 5, now() - interval '16 minutes'),
  ('76p-fresh', 0, 1, now());
SELECT is(public.purge_rate_limit_hits() >= 2, true, 'purge 删除 15 分钟外的行（至少两条陈旧行）');
SELECT is((SELECT count(*)::integer FROM public.rate_limit_hits WHERE key LIKE '76p-%'), 1,
  '新鲜行保留');
SELECT is((SELECT hits FROM public.rate_limit_hits WHERE key = '76p-fresh'), 1,
  '保留行计数未被清动');

SELECT * FROM finish();
ROLLBACK;
