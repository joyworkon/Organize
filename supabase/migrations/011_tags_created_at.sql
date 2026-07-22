-- 给 tags 表补 created_at 列（原来没有，API 假定有导致 GET 500）
-- 也方便标签管理页按创建时间排序

alter table tags
  add column if not exists created_at timestamptz default now();

-- 给已有数据回填 now()
update tags set created_at = now() where created_at is null;
