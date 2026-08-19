-- 037 笔记全文搜索
--
-- 现状：笔记列表页和命令面板都只搜 title ilike，正文完全搜不到。
-- notes.content 是 TipTap jsonb，不能直接 ilike（会命中 type 名等 JSON 语法噪声）。
--
-- 方案：递归提取 jsonb 纯文本到 search_text 生成列（STORED），
-- 挂 pg_trgm GIN 索引加速 ilike '%...%'。写入时自动维护，无需改应用层写入。
-- 备份/恢复用显式列名（020/024），生成列不参与 insert，无兼容问题。

create extension if not exists pg_trgm;

-- 递归提取 TipTap jsonb 里的全部 text 节点
create or replace function public.tiptap_extract_text(node jsonb)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select case
    when node is null then ''
    else
      coalesce(node ->> 'text', '')
      || case
           when jsonb_typeof(node -> 'content') = 'array'
           then ' ' || coalesce(
             (select string_agg(public.tiptap_extract_text(child), ' ')
              from jsonb_array_elements(node -> 'content') child),
             ''
           )
           else ''
         end
  end;
$$;

-- 超长笔记截断到 100k 字符，防止索引膨胀
alter table public.notes
  add column if not exists search_text text
  generated always as (left(public.tiptap_extract_text(content), 100000)) stored;

create index if not exists idx_notes_search_text_trgm
  on public.notes using gin (search_text gin_trgm_ops);
