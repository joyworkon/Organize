-- 收藏夹（统一收藏表，支持多类型内容）
create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  target_type text not null check (target_type in ('reading', 'note', 'task')),
  target_id uuid not null,
  note text,
  created_at timestamptz default now() not null,
  unique(user_id, target_type, target_id)
);

create index if not exists idx_favorites_user on favorites(user_id, created_at desc);

alter table favorites enable row level security;

create policy "Users can view own favorites" on favorites
  for select using (auth.uid() = user_id);
create policy "Users can insert own favorites" on favorites
  for insert with check (auth.uid() = user_id);
create policy "Users can delete own favorites" on favorites
  for delete using (auth.uid() = user_id);

grant all on favorites to anon, authenticated;
