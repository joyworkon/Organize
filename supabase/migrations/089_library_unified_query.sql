-- 089 资料库统一查询（阶段 C）：稍后读 + 速记融合为「资料库」统一入口。
--
-- 不并表：reading_items 与 memos 仍是各自内容真源，本 RPC 统一的是产品入口与查询接口。
-- UNION ALL 两侧 + security invoker（RLS 自动隔离，与直接查表同权限）：
--   - reading_items（显式 deleted_at is null；RLS 本就只暴露活跃行）：标签经 item_tags join tags
--     聚合成 name 数组
--   - memos（显式 deleted_at is null——memos 的 select RLS 无 deleted_at 条件，
--     活跃过滤必须在查询内显式表达）：tags 直接用 memos.tags 数组
--
-- 语义（与 /api/library/items、mock shim 逐字段对齐）：
--   - p_view：'all' | 'reading' | 'memo'
--   - 排序：created_at DESC, source_type ASC, id ASC；游标 = 上一页末行三元组
--     (p_cursor_created, p_cursor_source, p_cursor_id)。
--     注意游标语义必须与排序方向一致：首列降序用 <，同刻度的 (source_type, id) 升序
--      tie-break 用 >（字面行比较 (a,b,c) < 游标会与 created_at DESC 的排序矛盾，
--     翻页会重复/漏项，这里按排序语义展开写）。
--   - p_q：reading 侧 title/excerpt/content ilike；memo 侧 content ilike（覆盖全部可访问正文）
--   - p_tags：reading 侧 EXISTS item_tags/tags name = any(p_tags)；memo 侧 tags && p_tags
--   - p_limit：1–100，缺省 30

create or replace function public.library_items(
  p_view text default 'all',
  p_limit integer default 30,
  p_cursor_created timestamptz default null,
  p_cursor_source text default null,
  p_cursor_id uuid default null,
  p_q text default null,
  p_tags text[] default null
)
returns table (
  id uuid,
  source_type text,
  title text,
  excerpt text,
  url text,
  tags text[],
  reading_status text,
  is_pinned boolean,
  reading_progress numeric,
  is_link_only boolean,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with items as (
    select
      r.id,
      'reading'::text as source_type,
      r.title,
      left(r.excerpt, 280) as excerpt,
      r.url,
      coalesce(
        (select array_agg(t.name order by t.name)
         from public.item_tags it
         join public.tags t on t.id = it.tag_id
         where it.item_id = r.id),
        '{}'::text[]
      ) as tags,
      r.reading_status::text as reading_status,
      r.is_pinned,
      r.reading_progress,
      -- 仅存链接：抓取失败降级的阅读条目（物料 URN 有正文，不算）
      (r.content is null and r.url not like 'urn:organize:material:%') as is_link_only,
      r.created_at
    from public.reading_items r
    where r.deleted_at is null
      and (p_view = 'all' or p_view = 'reading')
      and (p_q is null or p_q = ''
           or r.title ilike '%' || p_q || '%'
           or r.excerpt ilike '%' || p_q || '%'
           or r.content ilike '%' || p_q || '%')
      and (p_tags is null or cardinality(p_tags) = 0
           or exists (
             select 1
             from public.item_tags it2
             join public.tags t2 on t2.id = it2.tag_id
             where it2.item_id = r.id
               and t2.name = any(p_tags)
           ))
    union all
    select
      m.id,
      'memo'::text as source_type,
      null::text as title,
      left(m.content, 280) as excerpt,
      null::text as url,
      m.tags,
      null::text as reading_status,
      false as is_pinned,
      null::numeric as reading_progress,
      false as is_link_only,
      m.created_at
    from public.memos m
    where m.deleted_at is null
      and (p_view = 'all' or p_view = 'memo')
      and (p_q is null or p_q = '' or m.content ilike '%' || p_q || '%')
      and (p_tags is null or cardinality(p_tags) = 0 or m.tags && p_tags)
  )
  select *
  from items
  where p_cursor_created is null
     or (
       items.created_at < p_cursor_created
       or (items.created_at = p_cursor_created
           and (items.source_type, items.id) > (p_cursor_source, p_cursor_id))
     )
  order by items.created_at desc, items.source_type asc, items.id asc
  limit case when p_limit between 1 and 100 then p_limit else 30 end;
$$;

revoke all on function public.library_items(text, integer, timestamptz, text, uuid, text, text[]) from anon, authenticated;
grant execute on function public.library_items(text, integer, timestamptz, text, uuid, text, text[]) to authenticated;
