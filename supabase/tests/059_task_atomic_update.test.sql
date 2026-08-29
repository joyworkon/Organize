-- 059 测试：任务原子变更协议——applied/conflict/not_found/幂等重放/未授权/RLS
begin;
select plan(17);

-- 准备两个用户
do $$
begin
  if not exists (select 1 from auth.users where id = '11111111-1111-1111-1111-111111111111') then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values ('11111111-1111-1111-1111-111111111111', 'p59-a@test.local', 'x', now(), now(), now());
  end if;
  if not exists (select 1 from auth.users where id = '22222222-2222-2222-2222-222222222222') then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values ('22222222-2222-2222-2222-222222222222', 'p59-b@test.local', 'x', now(), now(), now());
  end if;
end $$;

insert into public.tasks (id, user_id, title, status, sort_order)
values
  ('aaaaaaa1-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'A 的任务', 'todo', 0),
  ('aaaaaaa2-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'B 的任务', 'todo', 0);

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);

-- 1. 自己的任务正常应用：status=applied 且版本 0→1
select is(
  (update_task_atomic(
    'aaaaaaa1-0000-0000-0000-000000000000',
    jsonb_build_object('title', 'A 的任务 v1', 'priority', 'high'),
    0,
    'ddddddd1-0000-0000-0000-000000000001'
  )->>'status'),
  'applied',
  '属主按 expected version 应用成功'
);
select is(
  (select sync_version from public.tasks where id = 'aaaaaaa1-0000-0000-0000-000000000000')::text,
  '1',
  '应用后 sync_version 递增'
);

-- 2. 幂等：同一 mutation id 重放 → already_applied，版本不再变
select is(
  (update_task_atomic(
    'aaaaaaa1-0000-0000-0000-000000000000',
    jsonb_build_object('title', 'A 的任务 v1'),
    0,
    'ddddddd1-0000-0000-0000-000000000001'
  )->>'status'),
  'already_applied',
  '同 mutation id 重放返回 already_applied'
);
select is(
  (select sync_version from public.tasks where id = 'aaaaaaa1-0000-0000-0000-000000000000')::text,
  '1',
  '重放不重复递增版本'
);

-- 3. 过期版本 → conflict，并带回服务端当前版本
select is(
  (update_task_atomic(
    'aaaaaaa1-0000-0000-0000-000000000000',
    jsonb_build_object('title', '陈旧更新'),
    0,
    'ddddddd1-0000-0000-0000-000000000002'
  )->>'status'),
  'conflict',
  '过期版本被拒绝为 conflict'
);
select is(
  (update_task_atomic(
    'aaaaaaa1-0000-0000-0000-000000000000',
    jsonb_build_object('title', '陈旧更新'),
    0,
    'ddddddd1-0000-0000-0000-000000000002'
  )->>'current_sync_version')::text,
  '1',
  'conflict 携带服务端当前版本'
);

-- 4. patch 中显式 null 清空字段
select is(
  (update_task_atomic(
    'aaaaaaa1-0000-0000-0000-000000000000',
    jsonb_build_object('due_date', jsonb 'null', 'priority', 'low'),
    1,
    'ddddddd1-0000-0000-0000-000000000003'
  )->>'status'),
  'applied',
  '显式 null 清空 due_date 应用成功'
);
select is(
  (select priority from public.tasks where id = 'aaaaaaa1-0000-0000-0000-000000000000'),
  'low',
  '同 patch 中非 null 字段正常更新'
);

-- 5. 他人任务 → not_found（不可见即不存在，不泄露信息）
select is(
  (update_task_atomic(
    'aaaaaaa2-0000-0000-0000-000000000000',
    jsonb_build_object('title', '越权改'),
    null,
    'ddddddd1-0000-0000-0000-000000000004'
  )->>'status'),
  'not_found',
  '他人任务返回 not_found'
);

-- 6. task_mutations RLS：只能看到自己的日志
select is(
  (select count(*)::text from public.task_mutations where user_id = '22222222-2222-2222-2222-222222222222'),
  '0',
  'B 的日志对 A 不可见（RLS select 过滤）'
);
select is(
  (select count(*)::text from public.task_mutations where user_id = '11111111-1111-1111-1111-111111111111'),
  '2',
  '自己的日志可见（2 次成功应用；conflict 与 already_applied 均不写日志）'
);

-- 7. task_mutations 不可 update/delete（策略仅 select/insert）
-- 只授 select/insert：UPDATE 在表权限层即被拒（42501 permission denied）
select throws_ok(
  'update public.task_mutations set created_at = now()',
  '42501'
);

-- 8. B 视角：自己的任务可应用；A 的任务 not_found
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222')::text, true);
select is(
  (update_task_atomic(
    'aaaaaaa2-0000-0000-0000-000000000000',
    jsonb_build_object('status', 'done', 'completed_at', now()::text),
    0,
    'ddddddd2-0000-0000-0000-000000000001'
  )->>'status'),
  'applied',
  'B 应用自己的任务成功'
);
select is(
  (update_task_atomic(
    'aaaaaaa1-0000-0000-0000-000000000000',
    jsonb_build_object('title', 'B 改 A'),
    null,
    'ddddddd2-0000-0000-0000-000000000002'
  )->>'status'),
  'not_found',
  'B 无法通过 RPC 修改 A 的任务'
);

reset role;

-- 9. EXECUTE 分层：anon 不可调用，authenticated/service_role 可调用
select is(
  has_function_privilege('anon', 'update_task_atomic(uuid, jsonb, integer, uuid)', 'EXECUTE'),
  false, 'anon 无 EXECUTE'
);
select is(
  has_function_privilege('authenticated', 'update_task_atomic(uuid, jsonb, integer, uuid)', 'EXECUTE'),
  true, 'authenticated 有 EXECUTE'
);
select is(
  has_function_privilege('service_role', 'update_task_atomic(uuid, jsonb, integer, uuid)', 'EXECUTE'),
  true, 'service_role 有 EXECUTE'
);

select finish();
rollback;
