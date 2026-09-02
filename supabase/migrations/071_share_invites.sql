-- 071 邮箱邀请未注册用户（Track A，匿名协作卡 1）
--
-- 背景：063/064 的协作授权只面向已注册账号（分享面板经 find_user_by_email 把邮箱
-- 精确换成 user_id）。本迁移给未注册邮箱开一条「先邀请、注册后自动兑现」的路：
--   1. share_invites：属主为未注册邮箱记录一张预授权（token + 角色 + 目标空间），
--      并经 admin.auth.inviteUserByEmail 发出邀请邮件（API 侧，071 不含）。
--   2. redeem_share_invite：被邀请人注册/登录后凭 token 兑现——直接落地
--      workspace_members + resource_acl，063 的既有判定链（resource_role）即刻生效，
--      实时协作与保存 RPC（v2）无需任何改动。
--
-- 安全设计：
--   * 表 RLS：invited_by = auth.uid() 才可读写——属主管理自己的邀请；
--     被邀请人不直读本表，兑现一律走 DEFINER RPC。
--   * INSERT/UPDATE 额外 with check：只有资源属主能为自己拥有的资源、自己拥有的
--     空间写/改邀请行（resource_role=owner + workspace.owner_id=auth.uid()）。
--     没有这两条，任意登录用户都能插一行「invited_by 是自己、resource_id 指向
--     别人笔记」的伪造预授权（resource_id 是 polymorphic，表上没有 FK 可拦），
--     或把邮箱拉进自己并不拥有的空间——063 模型里空间成员对空间内所有已授权
--     资源拿到 ACL 角色，「往空间加人」必须空间 owner 才能做。
--   * redeem_share_invite 兑现前复核：资源仍存活（未软删）且属主仍是 invited_by、
--     目标空间 owner 仍是 invited_by——即使表层 with check 被绕过或将来放宽，
--     兑现端仍 fail-closed（资源转移/空间移交/软删后邀请一律失效）。
--   * 兑现**不调用** add_workspace_member / grant_resource：那两函数要求调用者是
--     空间 owner / 资源控制者，而兑现者是被邀请人（两者都不是）。share_invites 行
--     本身即属主创建时记录的预授权，由本 DEFINER 函数代为落地（直接 INSERT）。
--   * 统一 forbidden：token 不存在 / 非 pending / 已过期 / 伪造行不可区分——
--     不泄漏邀请存在性（对齐 065/067 口径）。
--   * 判权一律 is distinct from（067 的 NULL 陷阱：v_role 为 NULL 时
--     `not in` 不触发是实测踩过的洞）。
--   * 已存在的空间成员/授权不因兑现被调低：workspace_members on conflict do nothing、
--     resource_acl on conflict do nothing——邀请只授新权，不覆写既有更高权限。
--
-- 不进备份合同（v4 白名单未含本表）：邀请是属主与被邀请邮箱之间的Pending关系，
-- 跨账号恢复等于替别人发邀请；与 shares 同口径（REQUIRED_EXCLUSIONS）。

-- ============================================================
-- 1. 表
-- ============================================================
create table if not exists public.share_invites (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('note', 'reading_item')),
  resource_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  access_role text not null check (access_role in ('viewer', 'editor')),
  email text not null,                  -- 被邀请邮箱（API 侧 lower(btrim) 后落库）
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_user_id uuid,                 -- 可空：inviteUserByEmail 返回的预建 uid
  token text not null unique,           -- 兑现令牌（API 侧与 /api/share 同源随机生成）
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,               -- 建议 now()+7d；null 表示不过期
  accepted_at timestamptz,
  accepted_by uuid
);

-- token 的 unique 约束即索引；再补属主管理面与按邮箱查重两个入口
create index if not exists share_invites_invited_by_idx on public.share_invites(invited_by);
create index if not exists share_invites_email_idx on public.share_invites(lower(email));

-- ============================================================
-- 2. RLS + 表级 GRANT（铁律 1）
-- ============================================================
alter table public.share_invites enable row level security;

drop policy if exists "Owners can view own invites" on public.share_invites;
create policy "Owners can view own invites" on public.share_invites
  for select using (auth.uid() = invited_by);
drop policy if exists "Owners can create invites for own resources" on public.share_invites;
create policy "Owners can create invites for own resources" on public.share_invites
  for insert with check (
    auth.uid() = invited_by
    and public.resource_role(resource_type, resource_id) = 'owner'
    and exists (
      select 1 from public.workspaces w
       where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );
drop policy if exists "Owners can update own invites" on public.share_invites;
create policy "Owners can update own invites" on public.share_invites
  for update using (auth.uid() = invited_by)
  with check (
    auth.uid() = invited_by
    and public.resource_role(resource_type, resource_id) = 'owner'
    and exists (
      select 1 from public.workspaces w
       where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );
drop policy if exists "Owners can delete own invites" on public.share_invites;
create policy "Owners can delete own invites" on public.share_invites
  for delete using (auth.uid() = invited_by);

revoke all on public.share_invites from anon;
grant select, insert, update, delete on public.share_invites to authenticated;

-- ============================================================
-- 3. 兑现 RPC（DEFINER；被邀请人凭 token 调用）
-- ============================================================
create or replace function public.redeem_share_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.share_invites%rowtype;
  v_email text;
  v_alive boolean;
begin
  if v_user is null then
    return jsonb_build_object('status', 'forbidden', 'reason', 'anonymous');
  end if;

  select * into v_invite
    from public.share_invites
   where token = p_token
   limit 1;

  -- 不存在 / 非 pending / 已过期 / 伪造行：统一 forbidden，不可区分
  if not found
     or v_invite.status is distinct from 'pending'
     or (v_invite.expires_at is not null and v_invite.expires_at <= now()) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 邀请人必须仍是资源属主、且资源仍存活（未软删/未移交/未硬删）：
  -- 伪造预授权行、垃圾箱里的资源、被移交后的旧邀请一律失效（对齐 068/069 口径）
  if v_invite.resource_type = 'note' then
    select exists (
      select 1 from public.notes
       where id = v_invite.resource_id
         and user_id = v_invite.invited_by
         and deleted_at is null
    ) into v_alive;
  else
    select exists (
      select 1 from public.reading_items
       where id = v_invite.resource_id
         and user_id = v_invite.invited_by
         and deleted_at is null
    ) into v_alive;
  end if;
  if not v_alive then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 目标空间必须仍是邀请人所有：063 模型里往空间加人 = 让新成员拿到该空间全部
  -- 已授权资源的角色，只有空间 owner 能做（与成员管理 RPC 的守卫同款）
  if (select w.owner_id from public.workspaces w where w.id = v_invite.workspace_id)
     is distinct from v_invite.invited_by then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 身份匹配：uid 命中预建账号，或当前登录邮箱与被邀请邮箱一致（大小写不敏感）
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_user;
  if v_user is distinct from v_invite.invited_user_id
     and (v_email is null or v_email <> lower(btrim(v_invite.email))) then
    return jsonb_build_object('status', 'forbidden', 'reason', 'email_mismatch');
  end if;

  -- 直接 INSERT 落地，不走 063 的属主守卫 RPC：兑现者是被邀请人，既不是空间 owner
  -- 也不是资源控制者，那两个入口都会拒；share_invites 行本身即属主创建时的预授权。
  -- on conflict do nothing：已是成员 / 已有授权（含更高角色）时保持不变。
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, v_user, 'member')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by)
  values (v_invite.workspace_id, v_invite.resource_type, v_invite.resource_id,
          v_invite.access_role, v_invite.invited_by)
  on conflict (workspace_id, resource_type, resource_id) do nothing;

  update public.share_invites
     set status = 'accepted', accepted_at = now(), accepted_by = v_user
   where id = v_invite.id;

  return jsonb_build_object('status', 'ok',
    'resource_type', v_invite.resource_type,
    'resource_id', v_invite.resource_id);
end;
$$;

revoke execute on function public.redeem_share_invite(text) from public, anon;
grant execute on function public.redeem_share_invite(text) to authenticated, service_role;
