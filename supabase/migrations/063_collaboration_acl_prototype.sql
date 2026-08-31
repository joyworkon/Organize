-- 063 协作权限模型最小原型（P5-01）
--
-- 卡面要求：禁用「visible_user_ids 让某用户资源整体可见」的模型；改用
--   workspace（身份容器） + workspace_members（谁在哪个空间、什么成员角色）
--   + resource_acl（某个资源开放给某个空间，带访问角色）三层。
-- 本迁移只建这三张表、权限判定函数与管理面 RPC：不给业务表加 workspace_id 列、
-- 不改任何业务表 RLS（那是 P5-02 逐域迁移）。判定结论见 docs/adr/0002。
--
-- 判定链（唯一事实源，064 RLS / 065 保存 RPC 必须复用，不得各写一套 SQL）：
--   resource_role(type, id) =
--     'owner'   我拥有这条业务行
--     否则取「资源已授权的空间 ∩ 我是成员的空间」里最高的 access_role
--     都没有则 NULL（拒读拒写）
--
-- 关键取舍：
--   1. workspace_role / resource_role / resource_owner 走 SECURITY DEFINER：一是绕开
--      「成员表策略再引用成员表」的递归，二是让 064 的 notes 策略复用同一判定。
--   2. resource_acl 对客户端只读。写全部走 RPC，因为表级 update 策略无法表达
--      「只有资源控制者能动这条授权」：若给空间 owner 直接 UPDATE 权，B 就能把自己
--      空间里 A 授权进来的资源自升为 owner（063 的 pgTAP 有这条负例）。
--   3. workspaces.owner_id 是唯一权威属主，成员表里 role='owner' 只允许对应这一行，
--      避免「两个 owner 互相踢」的双主状态。属主本人不得被直接移除（先移交）。
--   4. resource_acl.resource_id 是 polymorphic（无外键）：插入/更新时用触发器强制
--      「资源真实存在」，业务行硬删时级联清掉授权行，不留幽灵授权。
--   5. 个人空间由 auth.users 触发器自动建 + 存量 backfill，用 partial unique 索引
--      兜住「每账号恰好一个 personal 空间」不变量。
--   6. 本迁移不进备份合同（v4 白名单未含这三张表）：跨账号恢复属主行的 ACL 等于把
--      A 的共享关系塞给 B，必须先设计 remap 语义，登记为 P5-02 待办（见 ADR 0002）。

-- ============================================================
-- 1. 三张表
-- ============================================================
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'team' check (kind in ('personal', 'team')),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspaces_owner_id_idx on public.workspaces(owner_id);

-- 每个账号最多一个个人空间
create unique index if not exists workspaces_personal_owner_key
  on public.workspaces(owner_id) where kind = 'personal';

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member', 'guest')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on public.workspace_members(user_id);

-- 资源 → 空间的授权行。access_role 与成员 role 是两个维度：
-- 成员 role（owner/member/guest）管「谁能管这个空间」，
-- access_role（viewer/editor/owner）管「这个空间的人对这个资源能做什么」，
-- 其中 access_role='owner' 表示控制面（可再授权 / 可回收）。
create table if not exists public.resource_acl (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  resource_type text not null check (resource_type in ('note', 'reading_item', 'task')),
  resource_id uuid not null,
  access_role text not null check (access_role in ('viewer', 'editor', 'owner')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (workspace_id, resource_type, resource_id)
);

create index if not exists resource_acl_resource_idx
  on public.resource_acl(resource_type, resource_id);
create index if not exists resource_acl_workspace_idx
  on public.resource_acl(workspace_id);

-- ============================================================
-- 2. 判定函数 + 个人空间补建（SECURITY DEFINER）
-- ============================================================
create or replace function public.workspace_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.role
    from public.workspace_members m
   where m.workspace_id = p_workspace_id
     and m.user_id = auth.uid()
   limit 1;
$$;

-- 资源属主（业务行的 user_id）；资源不存在或类型未知返回 NULL
create or replace function public.resource_owner(p_resource_type text, p_resource_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  if p_resource_id is null then
    return null;
  end if;

  if p_resource_type = 'note' then
    select n.user_id into v_owner from public.notes n where n.id = p_resource_id;
  elsif p_resource_type = 'reading_item' then
    select r.user_id into v_owner from public.reading_items r where r.id = p_resource_id;
  elsif p_resource_type = 'task' then
    select t.user_id into v_owner from public.tasks t where t.id = p_resource_id;
  else
    return null;
  end if;

  return v_owner;
end;
$$;

-- 当前调用者对某资源的有效权限：owner | editor | viewer | NULL
-- 软删除（deleted_at）不在此判定：垃圾箱条目可见性仍由各业务表自己的策略收口，
-- 避免在这里复制一份删除语义。
create or replace function public.resource_role(p_resource_type text, p_resource_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null or p_resource_id is null then
    return null;
  end if;

  if public.resource_owner(p_resource_type, p_resource_id) is null then
    return null;                       -- 资源不存在或类型未知，一律视为无权限
  end if;
  if public.resource_owner(p_resource_type, p_resource_id) = v_user then
    return 'owner';
  end if;

  select case
           when bool_or(a.access_role = 'owner') then 'owner'
           when bool_or(a.access_role = 'editor') then 'editor'
           when bool_or(a.access_role = 'viewer') then 'viewer'
         end
    into v_role
    from public.resource_acl a
    join public.workspace_members m
      on m.workspace_id = a.workspace_id and m.user_id = v_user
   where a.resource_type = p_resource_type
     and a.resource_id = p_resource_id;

  return v_role;
end;
$$;

-- 幂等补建个人空间（触发器与 RPC 共用同一实现）
create or replace function public.provision_personal_workspace(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ws uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  select id into v_ws from public.workspaces
   where owner_id = p_user_id and kind = 'personal'
   limit 1;

  if v_ws is null then
    insert into public.workspaces (name, kind, owner_id)
    values ('个人空间', 'personal', p_user_id)
    returning id into v_ws;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, p_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return v_ws;
end;
$$;

create or replace function public.ensure_personal_workspace()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  return public.provision_personal_workspace(auth.uid());
end;
$$;

-- ============================================================
-- 3. 完整性触发器：polymorphic resource_id 的存在性与级联清理
-- ============================================================
create or replace function public.enforce_resource_acl_target()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.resource_owner(new.resource_type, new.resource_id) is null then
    raise exception 'resource not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_resource_acl_target on public.resource_acl;
create trigger enforce_resource_acl_target
  before insert or update on public.resource_acl
  for each row execute function public.enforce_resource_acl_target();

-- 业务行硬删 → 授权行随之消失（不留幽灵授权）
create or replace function public.strip_resource_acl()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.resource_acl
   where resource_id = old.id
     and resource_type = case tg_table_name
       when 'notes' then 'note'
       when 'reading_items' then 'reading_item'
       else 'task'
     end;
  return old;
end;
$$;

drop trigger if exists strip_resource_acl_notes on public.notes;
create trigger strip_resource_acl_notes
  after delete on public.notes
  for each row execute function public.strip_resource_acl();

drop trigger if exists strip_resource_acl_reading_items on public.reading_items;
create trigger strip_resource_acl_reading_items
  after delete on public.reading_items
  for each row execute function public.strip_resource_acl();

drop trigger if exists strip_resource_acl_tasks on public.tasks;
create trigger strip_resource_acl_tasks
  after delete on public.tasks
  for each row execute function public.strip_resource_acl();

-- ============================================================
-- 4. 成员与空间管理 RPC
-- ============================================================
create or replace function public.create_workspace(
  p_name text,
  p_invitees jsonb default '[]'::jsonb   -- ["uuid", ...]；必须是已注册账号
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_ws uuid;
  v_invitee uuid;
begin
  if v_user is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'workspace name required' using errcode = '22023';
  end if;

  insert into public.workspaces (name, kind, owner_id)
  values (btrim(p_name), 'team', v_user)
  returning id into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, v_user, 'owner');

  for v_invitee in
    select (jsonb_array_elements_text(coalesce(p_invitees, '[]'::jsonb)))::uuid
  loop
    if not exists (select 1 from auth.users u where u.id = v_invitee) then
      raise exception 'invitee not found' using errcode = 'P0002';
    end if;
    insert into public.workspace_members (workspace_id, user_id, role, invited_by)
    values (v_ws, v_invitee, 'member', v_user)
    on conflict (workspace_id, user_id) do nothing;
  end loop;

  return v_ws;
end;
$$;

-- 拉人进空间（空间 owner 或资源侧不需要参与）
create or replace function public.add_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text default 'member'
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'member', 'guest') then
    raise exception 'bad role' using errcode = '22023';
  end if;
  -- 只允许把已经是空间 owner 的人拉进来？不：owner 由 transfer 产生，这里拒绝写 owner
  if p_role = 'owner' then
    raise exception 'use transfer_workspace_ownership' using errcode = '22023';
  end if;
  if public.workspace_role(p_workspace_id) is distinct from 'owner' then
    raise exception 'not workspace owner' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (p_workspace_id, p_user_id, p_role, auth.uid())
  on conflict (workspace_id, user_id) do update set role = excluded.role;
end;
$$;

-- 移交空间属主：唯一 owner 成员随之切换（属主想退出必须先移交）
create or replace function public.transfer_workspace_ownership(
  p_workspace_id uuid,
  p_new_owner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;

  select owner_id into v_owner from public.workspaces where id = p_workspace_id;
  if not found then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if v_owner <> v_user then
    raise exception 'not workspace owner' using errcode = '42501';
  end if;
  if p_new_owner_user_id = v_user then
    raise exception 'already owner' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_members
     where workspace_id = p_workspace_id and user_id = p_new_owner_user_id
  ) then
    raise exception 'new owner must be a member' using errcode = '22023';
  end if;

  update public.workspaces set owner_id = p_new_owner_user_id where id = p_workspace_id;
  update public.workspace_members set role = 'owner'
   where workspace_id = p_workspace_id and user_id = p_new_owner_user_id;
  update public.workspace_members set role = 'member'
   where workspace_id = p_workspace_id and user_id = v_user;
end;
$$;

-- 移除成员 / 自己退出：同一入口，两种权限。属主不得被直接摘掉（先移交）
create or replace function public.remove_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;

  select owner_id into v_owner from public.workspaces where id = p_workspace_id;
  if not found then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;

  if v_user <> p_user_id
     and public.workspace_role(p_workspace_id) is distinct from 'owner' then
    raise exception 'not workspace owner' using errcode = '42501';
  end if;

  if p_user_id = v_owner then
    raise exception 'transfer ownership first' using errcode = '22023';
  end if;

  delete from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

-- 调整成员角色：只有空间 owner；不得造出第二个 owner
create or replace function public.update_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'member', 'guest') then
    raise exception 'bad role' using errcode = '22023';
  end if;

  select owner_id into v_owner from public.workspaces where id = p_workspace_id;
  if not found then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if public.workspace_role(p_workspace_id) is distinct from 'owner' then
    raise exception 'not workspace owner' using errcode = '42501';
  end if;
  if p_role = 'owner' and p_user_id <> v_owner then
    raise exception 'use transfer_workspace_ownership' using errcode = '22023';
  end if;

  update public.workspace_members set role = p_role
   where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

-- ============================================================
-- 5. 资源授权 RPC（客户端写 resource_acl 的唯一入口）
-- ============================================================
create or replace function public.assert_resource_control(p_resource_type text, p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  if public.resource_owner(p_resource_type, p_resource_id) is null then
    raise exception 'resource not found' using errcode = 'P0002';
  end if;
  -- 控制面：资源属主，或已通过 ACL 拿到该资源 owner 权的成员
  if public.resource_owner(p_resource_type, p_resource_id) <> v_user
     and public.resource_role(p_resource_type, p_resource_id) is distinct from 'owner' then
    raise exception 'not resource controller' using errcode = '42501';
  end if;
end;
$$;

-- 把资源开放给一个空间（授权 / 改角色一体）
create or replace function public.grant_resource(
  p_resource_type text,
  p_resource_id uuid,
  p_workspace_id uuid,
  p_access_role text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_access_role not in ('viewer', 'editor', 'owner') then
    raise exception 'bad access_role' using errcode = '22023';
  end if;

  perform public.assert_resource_control(p_resource_type, p_resource_id);

  if public.workspace_role(p_workspace_id) is null then
    raise exception 'not a member of target workspace' using errcode = '42501';
  end if;

  insert into public.resource_acl
    (workspace_id, resource_type, resource_id, access_role, created_by)
  values (p_workspace_id, p_resource_type, p_resource_id, p_access_role, auth.uid())
  on conflict (workspace_id, resource_type, resource_id)
  do update set access_role = excluded.access_role;
end;
$$;

create or replace function public.revoke_resource(
  p_resource_type text,
  p_resource_id uuid,
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_resource_control(p_resource_type, p_resource_id);

  delete from public.resource_acl
   where resource_type = p_resource_type
     and resource_id = p_resource_id
     and workspace_id = p_workspace_id;
end;
$$;

-- 控制面转移：把资源的空间授权整体挪到调用者的另一个空间。
-- 属主行（notes.user_id 等）不在此处改，理由见 ADR 0002「不在本原型范围内」。
create or replace function public.transfer_resource_acl(
  p_resource_type text,
  p_resource_id uuid,
  p_from_workspace_id uuid,
  p_to_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  perform public.assert_resource_control(p_resource_type, p_resource_id);

  if public.workspace_role(p_to_workspace_id) is null then
    raise exception 'not a member of target workspace' using errcode = '42501';
  end if;

  select id into v_id from public.resource_acl
   where resource_type = p_resource_type
     and resource_id = p_resource_id
     and workspace_id = p_from_workspace_id;
  if v_id is null then
    raise exception 'grant not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.resource_acl
     where resource_type = p_resource_type
       and resource_id = p_resource_id
       and workspace_id = p_to_workspace_id
  ) then
    raise exception 'target workspace already granted' using errcode = '23505';
  end if;

  update public.resource_acl set workspace_id = p_to_workspace_id where id = v_id;
end;
$$;

-- 资源控制者一次收回全部授权（退出共享 / 撤销分享）
create or replace function public.reclaim_resource(
  p_resource_type text,
  p_resource_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  perform public.assert_resource_control(p_resource_type, p_resource_id);

  delete from public.resource_acl
   where resource_type = p_resource_type
     and resource_id = p_resource_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================
-- 6. 触发器：新账号自动就位个人空间 + updated_at
-- ============================================================
create or replace function public.on_user_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.provision_personal_workspace(new.id);
  return new;
end;
$$;

drop trigger if exists on_new_user_provision_workspace on auth.users;
create trigger on_new_user_provision_workspace
  after insert on auth.users
  for each row execute function public.on_user_created();

-- 存量账号补建个人空间（与触发器同一实现，幂等）
do $$
declare r record;
begin
  for r in select id from auth.users loop
    perform public.provision_personal_workspace(r.id);
  end loop;
end $$;

create trigger workspaces_updated_at
  before update on public.workspaces
  for each row execute function update_updated_at_column();

-- ============================================================
-- 7. RLS：这三张表自身的可见性（业务表策略留给 064）
-- ============================================================
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.resource_acl enable row level security;

create policy "Members can view their workspaces" on public.workspaces
  for select using (
    auth.uid() = owner_id or public.workspace_role(id) is not null
  );
create policy "Users can create own workspaces" on public.workspaces
  for insert with check (auth.uid() = owner_id);
create policy "Owner can rename workspace" on public.workspaces
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
-- 个人空间不可删（账号删除走 auth cascade）
create policy "Owner can delete team workspace" on public.workspaces
  for delete using (auth.uid() = owner_id and kind = 'team');

create policy "Members can view membership" on public.workspace_members
  for select using (public.workspace_role(workspace_id) is not null);
create policy "Workspace owner adds members" on public.workspace_members
  for insert with check (public.workspace_role(workspace_id) = 'owner');
create policy "Workspace owner updates membership" on public.workspace_members
  for update using (public.workspace_role(workspace_id) = 'owner');
create policy "Owner removes member, member can leave" on public.workspace_members
  for delete using (
    auth.uid() = user_id or public.workspace_role(workspace_id) = 'owner'
  );

-- resource_acl 只有 select 策略：写一律经 RPC（见文件头取舍 2）
create policy "Members can view resource grants" on public.resource_acl
  for select using (public.workspace_role(workspace_id) is not null);

-- 表级 GRANT：RLS 只管行级，缺 GRANT 会直接 permission denied
grant select, insert, update, delete
  on public.workspaces, public.workspace_members to authenticated;

-- resource_acl 显式只读。不能只靠「不建写策略」：Supabase 全新实例的平台默认权限
-- 会把全部 DML 发给 anon/authenticated，届时隐式靠 RLS 兜底；这里显式 revoke，
-- 让「写只能经 RPC」与执行环境的默认权限设置无关。
revoke insert, update, delete on public.resource_acl from anon, authenticated;
revoke select on public.resource_acl from anon;
grant select on public.resource_acl to authenticated;

-- 函数 EXECUTE 分层（沿 056 约定：先 revoke public/anon，再按需 grant）
-- 客户端 RPC 经 /api/* 以用户 session（authenticated 角色）调用，函数内部自带
-- auth.uid() 校验；三个内部辅助函数留 service_role 专用：
--   provision_personal_workspace 接受任意 user_id，不能让客户端直调
--   assert_resource_control      只被同文件的 grant/revoke/transfer 家族调用
--   resource_owner               会返回任意资源的属主 uuid，直调等于给客户端一个
--                                「探测别人资源存在性与归属」的 oracle；只允许被
--                                同为 DEFINER 的判定函数/触发器内部调用
do $$
declare r record;
  fn text[] := array[
    'workspace_role', 'resource_owner', 'resource_role',
    'provision_personal_workspace', 'ensure_personal_workspace',
    'create_workspace', 'add_workspace_member', 'transfer_workspace_ownership',
    'remove_workspace_member', 'update_workspace_member_role',
    'assert_resource_control', 'grant_resource', 'revoke_resource',
    'transfer_resource_acl', 'reclaim_resource',
    'enforce_resource_acl_target', 'strip_resource_acl', 'on_user_created'
  ];
  internal_only text[] := array[
    'provision_personal_workspace', 'assert_resource_control', 'resource_owner'
  ];
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname::text = any (fn)
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    if r.proname::text = any (internal_only) then
      execute format('revoke execute on function public.%I(%s) from authenticated', r.proname, r.args);
      execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
    end if;
  end loop;
end $$;
