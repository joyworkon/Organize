-- 收藏/置顶功能
-- 给 notes 和 reading_items 都加 is_pinned 字段
-- 列表查询时 ORDER BY is_pinned DESC, <原有排序> 即可让置顶项在前

alter table reading_items
  add column if not exists is_pinned boolean default false not null;

alter table notes
  add column if not exists is_pinned boolean default false not null;

-- 复合索引：用户维度下按置顶+时间排序（高频查询）
create index if not exists idx_reading_items_pinned on reading_items(user_id, is_pinned, created_at desc);
create index if not exists idx_notes_pinned on notes(user_id, is_pinned, updated_at desc);
