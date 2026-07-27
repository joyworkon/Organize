-- 文章高亮（划线）
create table if not exists highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  reading_item_id uuid references reading_items on delete cascade not null,
  content text not null,
  note text,
  color text default 'yellow' check (color in ('yellow', 'green', 'blue', 'pink', 'purple')) not null,
  anchor_path text,
  anchor_offset integer,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_highlights_item on highlights(reading_item_id);
create index if not exists idx_highlights_user on highlights(user_id);

alter table highlights enable row level security;

create policy "Users can view own highlights" on highlights
  for select using (auth.uid() = user_id);
create policy "Users can insert own highlights" on highlights
  for insert with check (auth.uid() = user_id);
create policy "Users can update own highlights" on highlights
  for update using (auth.uid() = user_id);
create policy "Users can delete own highlights" on highlights
  for delete using (auth.uid() = user_id);

create trigger update_highlights_updated_at
  before update on highlights
  for each row execute function update_updated_at_column();

grant all on highlights to anon, authenticated;
