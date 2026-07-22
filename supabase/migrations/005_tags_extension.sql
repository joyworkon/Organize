-- 笔记-标签关联表
-- 现有 item_tags 只支持 reading_items，本迁移新增 note_tags 让 notes 也能打标签
-- tags 表本身已存在（001），复用即可，无需改动

create table if not exists note_tags (
  note_id uuid references notes on delete cascade,
  tag_id uuid references tags on delete cascade,
  primary key (note_id, tag_id)
);

-- 索引：按标签反查笔记、按笔记反查标签
create index if not exists idx_note_tags_tag_id on note_tags(tag_id);
create index if not exists idx_note_tags_note_id on note_tags(note_id);
-- 给已有的 item_tags 也补一个反查索引（原来只有联合主键）
create index if not exists idx_item_tags_tag_id on item_tags(tag_id);

-- RLS
alter table note_tags enable row level security;

-- 只能操作自己笔记上的标签关联
create policy "Users can view own note_tags" on note_tags
  for select using (
    exists (select 1 from notes where id = note_id and user_id = auth.uid())
  );
create policy "Users can insert own note_tags" on note_tags
  for insert with check (
    exists (select 1 from notes where id = note_id and user_id = auth.uid())
    and exists (select 1 from tags where id = tag_id and user_id = auth.uid())
  );
create policy "Users can delete own note_tags" on note_tags
  for delete using (
    exists (select 1 from notes where id = note_id and user_id = auth.uid())
  );

-- GRANT 表级权限（RLS 之外必须显式授予）
grant select, insert, delete on public.note_tags to authenticated;
grant select on public.note_tags to anon;
