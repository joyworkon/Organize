-- 同步区块（synced blocks）：一处编辑、多处同步的引用块。
-- 笔记 content 里只存 syncedId，真正的共享内容存这张表；
-- 同一 syncedId 的所有实例共享本表的 content jsonb。

create table if not exists synced_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  -- 共享内容（TipTap JSON 的 content 数组）
  content jsonb not null default '[]'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_synced_blocks_user on synced_blocks(user_id, updated_at desc);

alter table synced_blocks enable row level security;

create policy "Users can view own synced blocks" on synced_blocks
  for select using (auth.uid() = user_id);
create policy "Users can insert own synced blocks" on synced_blocks
  for insert with check (auth.uid() = user_id);
create policy "Users can update own synced blocks" on synced_blocks
  for update using (auth.uid() = user_id);
create policy "Users can delete own synced blocks" on synced_blocks
  for delete using (auth.uid() = user_id);

create trigger update_synced_blocks_updated_at
  before update on synced_blocks
  for each row execute function update_updated_at_column();

grant all on synced_blocks to anon, authenticated;

-- ── 备份 / 恢复：把 synced_blocks 纳入 restore_backup_v2_with_pages ──
-- （restore_backup_v2 不含此表，保留旧版以兼容；新备份统一走 _with_pages）

create or replace function public.restore_backup_v2_with_pages(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user uuid := auth.uid();
  restore_result jsonb;
  has_synced_blocks boolean := false;
begin
  if target_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  -- 新备份会带 synced_blocks；旧备份没有该键时跳过，保持向后兼容
  has_synced_blocks := jsonb_typeof(p_payload->'data'->'synced_blocks') = 'array';

  restore_result := public.restore_backup_v2(p_payload);
  if restore_result->>'status' <> 'restored' then
    return restore_result;
  end if;

  -- 页面设置（沿用 025 的逻辑）
  update public.notes note
  set
    icon = page.icon,
    cover_url = page.cover_url,
    cover_position = coalesce(page.cover_position, 50),
    parent_note_id = page.parent_note_id,
    full_width = coalesce(page.full_width, false),
    font_family = case when page.font_family in ('default','serif','mono') then page.font_family else 'default' end,
    small_font = coalesce(page.small_font, false)
  from jsonb_to_recordset(p_payload->'data'->'notes') as page(
    id uuid,
    icon text,
    cover_url text,
    cover_position smallint,
    parent_note_id uuid,
    full_width boolean,
    font_family text,
    small_font boolean
  )
  where note.id = page.id
    and note.user_id = target_user;

  -- 同步区块（可选，仅新备份含）
  if has_synced_blocks then
    insert into public.synced_blocks (id, user_id, content, created_at, updated_at)
    select
      row.id, target_user, row.content, row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'synced_blocks') as row(
      id uuid, content jsonb, created_at timestamptz, updated_at timestamptz
    );
  end if;

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_with_pages(jsonb) from public;
grant execute on function public.restore_backup_v2_with_pages(jsonb) to authenticated;
