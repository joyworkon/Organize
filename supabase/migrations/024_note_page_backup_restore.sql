-- Keep page metadata inside the existing atomic backup restore transaction.
create or replace function public.restore_backup_v2_with_pages(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user uuid := auth.uid();
  restore_result jsonb;
begin
  if target_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  restore_result := public.restore_backup_v2(p_payload);
  if restore_result->>'status' <> 'restored' then
    return restore_result;
  end if;

  update public.notes note
  set
    icon = page.icon,
    cover_url = page.cover_url,
    cover_position = coalesce(page.cover_position, 50),
    parent_note_id = page.parent_note_id
  from jsonb_to_recordset(p_payload->'data'->'notes') as page(
    id uuid,
    icon text,
    cover_url text,
    cover_position smallint,
    parent_note_id uuid
  )
  where note.id = page.id
    and note.user_id = target_user;

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_with_pages(jsonb) from public;
grant execute on function public.restore_backup_v2_with_pages(jsonb) to authenticated;
