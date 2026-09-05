-- R10a：反向链接完整性——后端分页查询。
-- 取代客户端「拉最近 100 篇全文再扫」的方案（101+ 篇时旧来源漏查、全库正文下发）。
--
-- 语义（与客户端 extractLinksFromContent 对齐的等效查询）：
-- - 内链存储为 link mark 的 href="/notes/{uuid}"，jsonb 序列化文本中 uuid 以引号结尾，
--   用 LIKE '%/notes/{id}"%' 精确匹配（uuid 定长，无误命中前缀）；
--   外站 URL 恰好包含 /notes/{本笔记uuid} 的概率可忽略（uuid 全局唯一）。
-- - 纯文本中偶然提到该 URL 会保守计入（宁多勿漏）；精确链接图索引属 R10b（另卡）。
-- - 权限：security definer 内显式 auth.uid() 过滤，只扫调用者自己的笔记；
--   软删除来源（deleted_at 非空）不出现；硬删除随行消失即自动重现语义。
-- - 分页：服务端 LIMIT/OFFSET + total，客户端按页取全（只下发命中行元数据，不下发正文）。

create or replace function public.get_note_backlinks(
  p_note_id uuid,
  p_page_size integer default 100,
  p_page integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_total integer;
  v_rows jsonb;
  v_page_size integer := p_page_size;
  v_page integer := p_page;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if v_page_size < 1 or v_page_size > 200 then
    v_page_size := 100;
  end if;
  if v_page < 0 then
    v_page := 0;
  end if;

  select count(*) into v_total
  from public.notes n
  where n.user_id = v_user
    and n.id <> p_note_id
    and n.deleted_at is null
    and n.content is not null
    and n.content::text like '%/notes/' || p_note_id || '"%';

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', row.id, 'title', row.title, 'created_at', row.created_at)
      order by row.updated_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select n.id, n.title, n.created_at, n.updated_at
    from public.notes n
    where n.user_id = v_user
      and n.id <> p_note_id
      and n.deleted_at is null
      and n.content is not null
      and n.content::text like '%/notes/' || p_note_id || '"%'
    order by n.updated_at desc
    limit v_page_size offset v_page * v_page_size
  ) row;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

revoke all on function public.get_note_backlinks(uuid, integer, integer) from public, anon;
grant execute on function public.get_note_backlinks(uuid, integer, integer) to authenticated, service_role;
