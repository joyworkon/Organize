-- 分享功能：把 note 或 reading_item 通过 token 公开访问
-- 关键点：
--   1. token 不可枚举（用 gen_random_uuid 或足够长的随机串）
--   2. RLS 允许 anon 在 is_public=true 且未过期时 select
--   3. 必须给 anon 显式 GRANT select（003 没给这张新表）

create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users on delete cascade not null,
  resource_type text not null check (resource_type in ('note', 'reading_item')),
  resource_id uuid not null,
  token text not null unique,
  is_public boolean default true not null,
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- 索引：按 token 查（公开访问主入口）+ 按资源查（owner 查自己的分享）
create index if not exists idx_shares_token on shares(token);
create index if not exists idx_shares_owner_resource on shares(owner_id, resource_type, resource_id);

-- RLS
alter table shares enable row level security;

-- owner 可全操作自己的分享
create policy "Owners can view own shares" on shares
  for select using (
    auth.uid() = owner_id
    or (is_public = true and (expires_at is null or expires_at > now()))
  );
create policy "Owners can insert own shares" on shares
  for insert with check (auth.uid() = owner_id);
create policy "Owners can update own shares" on shares
  for update using (auth.uid() = owner_id);
create policy "Owners can delete own shares" on shares
  for delete using (auth.uid() = owner_id);

-- GRANT：anon 也需要 select（否则匿名访问公开链接会被表级权限拦下）
grant select, insert, update, delete on public.shares to authenticated;
grant select on public.shares to anon;

-- 关键：让 anon 能通过有效 token 读取被分享的 notes / reading_items
-- 现有 RLS 是 owner-only，新增一条 OR 条件（多 policy 是 OR 关系）
create policy "Public can read shared notes via token" on notes
  for select using (
    exists (
      select 1 from shares
      where shares.resource_type = 'note'
        and shares.resource_id = notes.id
        and shares.is_public = true
        and (shares.expires_at is null or shares.expires_at > now())
    )
  );

create policy "Public can read shared reading_items via token" on reading_items
  for select using (
    exists (
      select 1 from shares
      where shares.resource_type = 'reading_item'
        and shares.resource_id = reading_items.id
        and shares.is_public = true
        and (shares.expires_at is null or shares.expires_at > now())
    )
  );
