-- 064 协作可见性接入 + 用户档案（Stage 0 第二张卡）
--
-- 本迁移只做一件事：让 063 的授权真正「看得见」，并给前端一个安全的跨用户身份出口。
--   1. notes / reading_items / tasks 各加一条协作者 SELECT 策略。判定**只调用**
--      063 的 resource_role()，不重写等价 SQL（ADR 0002「064/065 必须复用」）。
--      多 policy 是 OR 关系，旧的 owner-only 策略与垃圾箱语义不受影响。
--   2. user_profiles：显示他人姓名/头像的唯一入口（分享面板、「与我共享」列表、
--      冲突对话框里的协作者名字）。只放展示字段，auth.users 触发器镜像姓名/头像。
--   3. find_user_by_email：按邮箱精确查人，供「邀请协作者」把邮箱换成 user_id。
--      邮箱一律从 auth.users 读，不经本表。
--
-- 刻意不在本迁移做（理由写进 ADR 0002 的待办与 PR 描述）：
--   - 不给 notes/reading_items/tasks 加 UPDATE/DELETE 协作者策略。写权必须在 065 的
--     SECURITY DEFINER RPC 里收口：表级 UPDATE 会绕过 content_revision 乐观锁与
--     save_mutation_log 幂等（031/059 的合同），等于给协作者开一条「无冲突检测裸写」的路。
--   - 不动 shares。plans 里的 access_mode/can_comment 在 Stage 0 没有消费者，且
--     public_comment 需要先有匿名身份机制（plans §2 自己把它推到后续），加列即成死字段。
--   - 子资源（note_versions / note_tags / highlights / comments / task_item_refs）不给
--     协作者开放：RLS 返回 0 行而不是报错，所以共享笔记能打开，历史与标签暂时为空。
--     版本列表与评论留给 065 的 RPC 按角色收口。
--   - 不做「通过 task_item_refs 反推任务可见性」。plans §4.2 那段 SQL 是
--     `join share_members sm on true` 的笛卡尔积，照抄会跨用户放行任务行。
--
-- 隐私红线：user_profiles **不给匿名可读**，也不给「所有登录用户可读」。可见集只有
--   ①自己 ②与我同处至少一个 workspace 的人。按邮箱查人另走 find_user_by_email：
--   精确匹配、不返回列表、只返回 user_id + 昵称（供邀请方确认「就是这个人」）——
--   被邀请人必须先知道准确邮箱，这比开放整本目录小得多。
--
--   本表刻意**不存 email**：它允许「本人 UPDATE」，而 RLS 不能按列收口，缓存一份邮箱
--   等于把「邀请落到谁的账上」交给用户自填 —— 攻击者填成受害者的地址即可劫持邀请。
--   auth.users 的邮箱唯一约束是大小写敏感且部分索引（`UNIQUE(email) WHERE is_sso_user
--   = false`），本表无法用唯一索引兜住这个歧义，所以结论是：邮箱只从 auth.users 读，
--   user_profiles 只放可公开的展示字段。

-- ============================================================
-- 1. 协作者可读：三张主表各一条 SELECT 策略
-- ============================================================
drop policy if exists "Collaborators can read granted notes" on public.notes;
create policy "Collaborators can read granted notes" on public.notes
  for select using (
    deleted_at is null
    and public.resource_role('note', id) is not null
  );

drop policy if exists "Collaborators can read granted reading items" on public.reading_items;
create policy "Collaborators can read granted reading items" on public.reading_items
  for select using (
    deleted_at is null
    and public.resource_role('reading_item', id) is not null
  );

drop policy if exists "Collaborators can read granted tasks" on public.tasks;
create policy "Collaborators can read granted tasks" on public.tasks
  for select using (
    deleted_at is null
    and public.resource_role('task', id) is not null
  );

-- ============================================================
-- 2. user_profiles：跨用户可见的展示身份（仅姓名 / 头像）
-- ============================================================
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.mirror_user_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- 姓名/头像只在用户自己没设过时才用 metadata 兜底，
  -- 否则改密码等 auth 行更新会把用户自设的昵称冲掉
  insert into public.user_profiles as p (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    display_name = coalesce(p.display_name, excluded.display_name),
    avatar_url = coalesce(p.avatar_url, excluded.avatar_url),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_mirror_profile on auth.users;
create trigger on_auth_user_mirror_profile
  after insert or update on auth.users
  for each row execute function public.mirror_user_profile();

-- 存量账号补建档案（与触发器同一实现，幂等）
do $$
begin
  insert into public.user_profiles as p (id, display_name, avatar_url)
  select u.id,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
         u.raw_user_meta_data ->> 'avatar_url'
    from auth.users u
  on conflict (id) do update set
    display_name = coalesce(p.display_name, excluded.display_name),
    avatar_url = coalesce(p.avatar_url, excluded.avatar_url);
end $$;

-- ============================================================
-- 3. 档案可见性判定 + 按邮箱查人
-- ============================================================
create or replace function public.shares_workspace_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_user_id is not null and exists (
    select 1
      from public.workspace_members mine
      join public.workspace_members theirs
        on theirs.workspace_id = mine.workspace_id
     where mine.user_id = auth.uid()
       and theirs.user_id = p_user_id
  );
$$;

-- 邀请时把邮箱换成 user_id。邮箱只读 auth.users（客户端改不动），命中即返回一行，
-- 不返回邮箱本身（调用方自己输入的）。未注册与不匹配都返回空集，二者对调用方不可区分。
create or replace function public.find_user_by_email(p_email text)
returns table (user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  -- 不做前缀 / 通配 / 域名查询：这个 RPC 只能验证「这个准确邮箱有没有账号」，
  -- 不能用来遍历目录
  if v_email = '' or position('@' in v_email) = 0 or position('@' in v_email) = length(v_email) then
    return;
  end if;

  -- 大小写敏感等值，是反冒充而不是省事：若写成 lower(u.email) = v_email，攻击者注册
  -- 「Alice@X.com」这种大小写变体，就能在邀请方输入受害者真实地址时被命中。
  -- GoTrue 注册即把 email 规范化为小写，所以正常账号都落在同一口径上；
  -- limit 1 只用来兜住「历史数据里真有大小写重复」的病态情形（不给随机命中留活口）
  return query
    select u.id, p.display_name
      from auth.users u
      left join public.user_profiles p on p.id = u.id
     where u.email = v_email
     limit 1;
end;
$$;

-- ============================================================
-- 4. RLS 与表级 GRANT
-- ============================================================
alter table public.user_profiles enable row level security;

create policy "Users can read own profile" on public.user_profiles
  for select using (auth.uid() = id);
create policy "Users can read profiles of workspace peers" on public.user_profiles
  for select using (public.shares_workspace_with(id));
-- 只有自己是唯一能改档案的人
create policy "Users can update own profile" on public.user_profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- 档案行只由 auth.users 触发器与存量 backfill 产生：客户端既不该插行也不该删行

grant select, update on public.user_profiles to authenticated;

-- 显式收口写权限，而不是「不建 insert/delete 策略」：Supabase 全新实例的默认权限会把
-- 新表的 ALL 发给 anon / authenticated，只靠缺策略会让结论随环境漂移（063 的同一教训）
revoke insert, delete, truncate, references, trigger on public.user_profiles from anon, authenticated;
revoke select on public.user_profiles from anon;

-- ============================================================
-- 5. 函数 EXECUTE 分层（沿 056 / 063 约定）
-- ============================================================
do $$
declare r record;
  fn text[] := array[
    'shares_workspace_with', 'find_user_by_email', 'mirror_user_profile'
  ];
  internal_only text[] := array['mirror_user_profile'];
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
