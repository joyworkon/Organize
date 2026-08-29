-- 060 测试：速记接入垃圾箱——软删进桶、可恢复、可永久删除、双用户隔离
begin;
select plan(11);

do $$
begin
  if not exists (select 1 from auth.users where id = '11111111-1111-1111-1111-111111111111') then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values ('11111111-1111-1111-1111-111111111111', 'p60-a@test.local', 'x', now(), now(), now());
  end if;
  if not exists (select 1 from auth.users where id = '22222222-2222-2222-2222-222222222222') then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token)
    values ('22222222-2222-2222-2222-222222222222', 'p60-b@test.local', 'x', now(), now(), now(), 'x');
  end if;
end $$;

insert into public.memos (id, user_id, content)
values
  ('aaaaaaa1-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'A 的速记：明天交周报 #工作'),
  ('aaaaaaa2-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'B 的速记：买菜清单');

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);

-- 1. 软删除自己的速记：affected 1，行进垃圾箱
select is(
  mutate_trash('soft_delete', 'memo', array['aaaaaaa1-0000-0000-0000-000000000000']::uuid[]),
  1,
  '属主软删除速记 affected=1'
);
select is(
  (select count(*)::text from public.list_trash('memo')),
  '1',
  'list_trash memo 分组可见软删速记'
);
select is(
  (select title from public.list_trash('memo') where id = 'aaaaaaa1-0000-0000-0000-000000000000' limit 1),
  'A 的速记：明天交周报 #工作',
  'list_trash 标题取内容前缀'
);

-- 2. 恢复：deleted_at 清空且出桶
select is(
  mutate_trash('restore', 'memo', array['aaaaaaa1-0000-0000-0000-000000000000']::uuid[]),
  1,
  '属主恢复速记 affected=1'
);
select is(
  (select count(*)::text from public.list_trash('memo')),
  '0',
  '恢复后出桶'
);
select is(
  (select (deleted_at is null)::text from public.memos where id = 'aaaaaaa1-0000-0000-0000-000000000000'),
  'true',
  '恢复后 deleted_at 为空'
);

-- 3. 再软删 → 永久删除：行物理消失
select is(
  mutate_trash('soft_delete', 'memo', array['aaaaaaa1-0000-0000-0000-000000000000']::uuid[]),
  1,
  '再次软删 affected=1'
);
select is(
  mutate_trash('permanent_delete', 'memo', array['aaaaaaa1-0000-0000-0000-000000000000']::uuid[]),
  1,
  '永久删除 affected=1'
);
select is(
  (select count(*)::text from public.memos where id = 'aaaaaaa1-0000-0000-0000-000000000000'),
  '0',
  '永久删除后行物理消失'
);

-- 4. 越权：A 不能对 B 的速记做垃圾箱操作（mutate_trash 均按属主过滤）
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222')::text, true);
select is(
  mutate_trash('soft_delete', 'memo', array['aaaaaaa2-0000-0000-0000-000000000000']::uuid[]),
  1,
  'B 软删自己的速记成功'
);

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);
set role authenticated;
select is(
  mutate_trash('soft_delete', 'memo', array['aaaaaaa2-0000-0000-0000-000000000000']::uuid[]),
  0,
  'A 无法软删 B 的速记（属主过滤 affected=0）'
);
select is(
  (select count(*)::text from public.memos where id = 'aaaaaaa2-0000-0000-0000-000000000000' and deleted_at is null),
  '1',
  'B 的速记未被 A 动过（仍然活跃）'
);

select finish();
rollback;
