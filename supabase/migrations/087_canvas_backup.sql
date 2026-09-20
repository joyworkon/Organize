-- 087: 构思画布接入备份恢复链（模板：075_memo_notes.sql 尾部，链式扩展）
-- restore_backup_v2_full 重定义：先调上一层（with_highlight_references），
-- 再落 canvas_documents（ID 已在客户端重映射；revision 复位为 1）。

create or replace function public.restore_backup_v2_full(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  restore_result jsonb;
  target_user uuid := auth.uid();
begin
  restore_result := public.restore_backup_v2_with_highlight_references(p_payload);
  if (restore_result->>'status') <> 'restored' then
    return restore_result;
  end if;

  -- canvas_documents：结构 JSON 原样恢复（schemaVersion 由客户端校验保障）；
  -- revision 复位为 1，避免恢复后客户端以旧修订号发起 CAS。
  insert into public.canvas_documents (id, user_id, title, content, revision, deleted_at, created_at, updated_at)
  select row.id, target_user, coalesce(row.title, ''), row.content, 1,
         row.deleted_at, row.created_at, row.updated_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'canvas_documents', '[]'::jsonb)) as row(
    id uuid, title text, content jsonb, deleted_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  ) on conflict (id) do nothing;

  restore_result := jsonb_set(restore_result, '{counts,canvas_documents}',
    to_jsonb((select count(*) from public.canvas_documents where user_id = target_user)));

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_full(jsonb) from public;
grant execute on function public.restore_backup_v2_full(jsonb) to authenticated;
