-- 049 tasks INSERT 放宽 pgTAP 测试
-- 覆盖：插入即带 deleted_at 放行（离线建后删回放）；
-- 直接 UPDATE 设置 deleted_at 仍被拒（021 设计：软删除必须走 mutate_trash）；
-- mutate_trash 软删/恢复正常；属主隔离保持。
BEGIN;
SELECT plan(7);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('49000009-0000-0000-0000-000000000001', 'rls_fix_a@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

set role authenticated;
set request.jwt.claim.sub to '49000009-0000-0000-0000-000000000001';

-- ========== 场景一：插入即带 deleted_at（离线建后删的回放载荷） ==========
INSERT INTO tasks (id, user_id, title, status, category, deleted_at) VALUES
  ('49030000-0000-0000-0000-000000000001', '49000009-0000-0000-0000-000000000001',
   '离线建后删', 'todo', 'work', now());

reset role;

SELECT is(
  (SELECT deleted_at IS NOT NULL FROM tasks WHERE id = '49030000-0000-0000-0000-000000000001'),
  true,
  'tasks：insert 允许带 deleted_at（离线建后删合入 create 的回放）'
);

-- ========== 场景二：直接 UPDATE 设置 deleted_at 仍被拒（设计护栏） ==========
INSERT INTO tasks (id, user_id, title, status, category) VALUES
  ('49030000-0000-0000-0000-000000000002', '49000009-0000-0000-0000-000000000001',
   '待删任务', 'todo', 'work');

set role authenticated;
set request.jwt.claim.sub to '49000009-0000-0000-0000-000000000001';

-- throws_ok 第二参数传 NULL：只验证抛了异常（RLS 消息固定但按 033 的约定走 NULL 更稳）
SELECT throws_ok(
  $$UPDATE tasks SET deleted_at = now() WHERE id = '49030000-0000-0000-0000-000000000002'$$,
  NULL,
  '直接 UPDATE 设置 deleted_at 被拒（42501）——软删除必须走 mutate_trash RPC'
);

reset role;

-- ========== 场景三：mutate_trash 软删 / 恢复（唯一软删除入口） ==========
set role authenticated;
set request.jwt.claim.sub to '49000009-0000-0000-0000-000000000001';

SELECT is(
  mutate_trash('soft_delete', 'task', ARRAY['49030000-0000-0000-0000-000000000002']::uuid[]),
  1,
  'mutate_trash 软删活跃任务可用'
);

reset role;

SELECT is(
  (SELECT deleted_at IS NOT NULL FROM tasks WHERE id = '49030000-0000-0000-0000-000000000002'),
  true,
  '软删后 deleted_at 已置位（RLS 下认证用户看不到该行属预期，以属主视角断言）'
);

-- 已软删的行对认证用户不可见（SELECT 策略生效）
set role authenticated;
set request.jwt.claim.sub to '49000009-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM tasks WHERE id = '49030000-0000-0000-0000-000000000002'),
  0,
  '已软删任务对认证用户不可见（不可直改，恢复必须走 mutate_trash）'
);

reset role;

set role authenticated;
set request.jwt.claim.sub to '49000009-0000-0000-0000-000000000001';

SELECT is(
  mutate_trash('restore', 'task', ARRAY['49030000-0000-0000-0000-000000000002']::uuid[]),
  1,
  'mutate_trash 恢复软删任务可用'
);

reset role;

-- ========== 场景四：他人任务不可插入 ==========
set role authenticated;
set request.jwt.claim.sub to '49000009-0000-0000-0000-000000000001';

SELECT throws_ok(
  $$INSERT INTO tasks (id, user_id, title, status, category) VALUES
    ('49030000-0000-0000-0000-000000000003', '49000009-0000-0000-0000-000000000002',
     '别人的任务', 'todo', 'work')$$,
  NULL,
  'insert 仍校验属主（42501，不能替他人建任务）'
);

reset role;

SELECT * FROM finish();
ROLLBACK;
