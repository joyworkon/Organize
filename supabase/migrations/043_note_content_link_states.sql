-- 批量解析笔记正文中的站内链接状态。
-- SECURITY DEFINER 仅按 auth.uid() 返回当前用户资源；其他用户资源与不存在资源统一为 missing。
create or replace function public.get_note_content_link_states(
  p_note_ids uuid[] default '{}'::uuid[],
  p_reading_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  resource_type text,
  resource_id uuid,
  title text,
  state text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with requested as (
    select 'note'::text as resource_type, id as resource_id
    from unnest(coalesce(p_note_ids, '{}'::uuid[])) id
    union
    select 'reading'::text, id
    from unnest(coalesce(p_reading_item_ids, '{}'::uuid[])) id
  )
  select
    requested.resource_type,
    requested.resource_id,
    case
      when requested.resource_type = 'note' then note.title
      else reading.title
    end,
    case
      when requested.resource_type = 'note' and note.id is null then 'missing'
      when requested.resource_type = 'reading' and reading.id is null then 'missing'
      when requested.resource_type = 'note' and note.deleted_at is not null then 'deleted'
      when requested.resource_type = 'reading' and reading.deleted_at is not null then 'deleted'
      else 'active'
    end
  from requested
  left join public.notes note
    on requested.resource_type = 'note'
    and note.id = requested.resource_id
    and note.user_id = auth.uid()
  left join public.reading_items reading
    on requested.resource_type = 'reading'
    and reading.id = requested.resource_id
    and reading.user_id = auth.uid();
$$;

revoke all on function public.get_note_content_link_states(uuid[], uuid[]) from public;
grant execute on function public.get_note_content_link_states(uuid[], uuid[]) to authenticated;
