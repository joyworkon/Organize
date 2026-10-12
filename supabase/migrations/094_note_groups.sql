-- 094: 笔记分组——用户手动建组 / 改名 / 删除，把笔记归入某个组；「自动分组」只是生成建议，
-- 用户确认后同样写入这两张表。
--
-- 设计取舍：
--   - 归属关系放在独立的 note_group_members（每篇笔记至多属于一个组，note_id 为主键），
--     不给 notes 加列：移动分组不触发 notes 的 updated_at / 版本快照，笔记的「最近编辑」排序不被打乱。
--   - 同用户归属沿 091 口径用复合外键：(note_id, user_id) → notes、(group_id, user_id) → note_groups，
--     知道别人的 ID 也挂不进自己的组。
--   - 删除分组 → 成员行 cascade 删除，笔记本身不动（回到「未分组」）；笔记硬删除同样 cascade。
--   - 备份/恢复（020/087/091 链）暂不包含分组：恢复后笔记全部为「未分组」，不影响正文。

create table if not exists public.note_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_note_groups_user_sort
  on public.note_groups(user_id, sort_order, created_at);

create unique index if not exists note_groups_id_user_key
  on public.note_groups (id, user_id);

drop trigger if exists update_note_groups_updated_at on public.note_groups;
create trigger update_note_groups_updated_at
  before update on public.note_groups
  for each row execute function update_updated_at_column();

alter table public.note_groups enable row level security;

drop policy if exists "Users can read own note groups" on public.note_groups;
create policy "Users can read own note groups"
  on public.note_groups for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own note groups" on public.note_groups;
create policy "Users can insert own note groups"
  on public.note_groups for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own note groups" on public.note_groups;
create policy "Users can update own note groups"
  on public.note_groups for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own note groups" on public.note_groups;
create policy "Users can delete own note groups"
  on public.note_groups for delete
  using (auth.uid() = user_id);

create table if not exists public.note_group_members (
  note_id uuid primary key,
  group_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  constraint note_group_members_note_fkey
    foreign key (note_id, user_id) references public.notes(id, user_id) on delete cascade,
  constraint note_group_members_group_fkey
    foreign key (group_id, user_id) references public.note_groups(id, user_id) on delete cascade
);

create index if not exists idx_note_group_members_group
  on public.note_group_members(user_id, group_id);

alter table public.note_group_members enable row level security;

drop policy if exists "Users can read own note group members" on public.note_group_members;
create policy "Users can read own note group members"
  on public.note_group_members for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own note group members" on public.note_group_members;
create policy "Users can insert own note group members"
  on public.note_group_members for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own note group members" on public.note_group_members;
create policy "Users can update own note group members"
  on public.note_group_members for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own note group members" on public.note_group_members;
create policy "Users can delete own note group members"
  on public.note_group_members for delete
  using (auth.uid() = user_id);
