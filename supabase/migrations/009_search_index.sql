-- 全文搜索支持
-- 给 reading_items 的 title 和 excerpt 加 trigram 索引（支持 ilike 加速）
-- content 太大且是 HTML，不建索引（查询时走 user_id 过滤 + 顺序扫描即可）

-- 需要 pg_trgm 扩展（Supabase 默认开启，这里幂等创建）
create extension if not exists pg_trgm;

-- trigram 索引让 ilike '%xxx%' 也能走索引（GIN 比 gist 快）
create index if not exists idx_reading_items_title_trgm
  on reading_items using gin (title gin_trgm_ops);

create index if not exists idx_reading_items_excerpt_trgm
  on reading_items using gin (excerpt gin_trgm_ops);

-- notes 的 title 也加
create index if not exists idx_notes_title_trgm
  on notes using gin (title gin_trgm_ops);
