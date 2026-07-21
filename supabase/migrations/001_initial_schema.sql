-- 阅读条目
create table if not exists reading_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  url text not null,
  title text,
  content text,
  excerpt text,
  cover_image text,
  reading_status text default 'unread' check (reading_status in ('unread', 'reading', 'read')),
  reading_progress float default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 笔记
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  title text,
  content jsonb,
  reading_item_id uuid references reading_items on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 标签
create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  unique(user_id, name)
);

-- 条目-标签关联
create table if not exists item_tags (
  item_id uuid references reading_items on delete cascade,
  tag_id uuid references tags on delete cascade,
  primary key (item_id, tag_id)
);

-- 插件注册
create table if not exists plugins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  package_name text not null,
  version text,
  config jsonb default '{}',
  enabled boolean default true,
  created_at timestamptz default now(),
  unique(user_id, package_name)
);

-- 索引
create index idx_reading_items_user_id on reading_items(user_id);
create index idx_reading_items_status on reading_items(user_id, reading_status);
create index idx_notes_user_id on notes(user_id);
create index idx_tags_user_id on tags(user_id);
create index idx_plugins_user_id on plugins(user_id);

-- RLS 策略
alter table reading_items enable row level security;
alter table notes enable row level security;
alter table tags enable row level security;
alter table item_tags enable row level security;
alter table plugins enable row level security;

-- reading_items RLS
create policy "Users can view own reading items" on reading_items
  for select using (auth.uid() = user_id);
create policy "Users can insert own reading items" on reading_items
  for insert with check (auth.uid() = user_id);
create policy "Users can update own reading items" on reading_items
  for update using (auth.uid() = user_id);
create policy "Users can delete own reading items" on reading_items
  for delete using (auth.uid() = user_id);

-- notes RLS
create policy "Users can view own notes" on notes
  for select using (auth.uid() = user_id);
create policy "Users can insert own notes" on notes
  for insert with check (auth.uid() = user_id);
create policy "Users can update own notes" on notes
  for update using (auth.uid() = user_id);
create policy "Users can delete own notes" on notes
  for delete using (auth.uid() = user_id);

-- tags RLS
create policy "Users can view own tags" on tags
  for select using (auth.uid() = user_id);
create policy "Users can insert own tags" on tags
  for insert with check (auth.uid() = user_id);
create policy "Users can update own tags" on tags
  for update using (auth.uid() = user_id);
create policy "Users can delete own tags" on tags
  for delete using (auth.uid() = user_id);

-- item_tags RLS
create policy "Users can view own item_tags" on item_tags
  for select using (
    exists (select 1 from reading_items where id = item_id and user_id = auth.uid())
  );
create policy "Users can insert own item_tags" on item_tags
  for insert with check (
    exists (select 1 from reading_items where id = item_id and user_id = auth.uid())
  );
create policy "Users can delete own item_tags" on item_tags
  for delete using (
    exists (select 1 from reading_items where id = item_id and user_id = auth.uid())
  );

-- plugins RLS
create policy "Users can view own plugins" on plugins
  for select using (auth.uid() = user_id);
create policy "Users can insert own plugins" on plugins
  for insert with check (auth.uid() = user_id);
create policy "Users can update own plugins" on plugins
  for update using (auth.uid() = user_id);
create policy "Users can delete own plugins" on plugins
  for delete using (auth.uid() = user_id);

-- updated_at 自动更新触发器
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_reading_items_updated_at
  before update on reading_items
  for each row execute function update_updated_at_column();

create trigger update_notes_updated_at
  before update on notes
  for each row execute function update_updated_at_column();
