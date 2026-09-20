-- 087: 构思画布接入备份恢复链（链式模式与 058/075 一致：复制上一层 075 的
-- restore_backup_v2_full 主体（memos / task_item_refs / memo_notes 落库与计数），
-- 再追加 canvas_documents 落库。ID 均已在客户端重映射；revision 复位为 1。

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

  -- memos：ID 已在客户端重映射，此处直接落库（tags 数组原样恢复）
  insert into public.memos (id, user_id, content, tags, deleted_at, created_at, updated_at)
  select row.id, target_user, row.content,
         coalesce(row.tags, '{}'::text[]), row.deleted_at, row.created_at, row.updated_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'memos', '[]'::jsonb)) as row(
    id uuid, content text, tags text[], deleted_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  ) on conflict (id) do nothing;

  -- task_item_refs：task_id/note_id 已重映射；唯一键 (note_id, block_id) 冲突跳过
  insert into public.task_item_refs (id, user_id, task_id, note_id, block_id, created_at)
  select row.id, target_user, row.task_id, row.note_id, row.block_id, row.created_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'task_item_refs', '[]'::jsonb)) as row(
    id uuid, task_id uuid, note_id uuid, block_id text, created_at timestamptz
  ) on conflict (id) do nothing;

  -- R11：memo_notes（memo_id/note_id 均已重映射；唯一键 (user_id, memo_id) 冲突跳过）
  insert into public.memo_notes (id, user_id, memo_id, note_id, created_at)
  select row.id, target_user, row.memo_id, row.note_id, row.created_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'memo_notes', '[]'::jsonb)) as row(
    id uuid, memo_id uuid, note_id uuid, created_at timestamptz
  ) on conflict do nothing;

  -- 085（idea-canvas）：画布文档结构 JSON 原样恢复（schemaVersion 由客户端校验保障）；
  -- revision 复位为 1，避免恢复后客户端以旧修订号发起 CAS。
  insert into public.canvas_documents (id, user_id, title, content, revision, deleted_at, created_at, updated_at)
  select row.id, target_user, coalesce(row.title, ''), row.content, 1,
         row.deleted_at, row.created_at, row.updated_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'canvas_documents', '[]'::jsonb)) as row(
    id uuid, title text, content jsonb, deleted_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  ) on conflict (id) do nothing;

  restore_result := jsonb_set(restore_result, '{counts,memos}',
    to_jsonb((select count(*) from public.memos where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,task_item_refs}',
    to_jsonb((select count(*) from public.task_item_refs where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,memo_notes}',
    to_jsonb((select count(*) from public.memo_notes where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,canvas_documents}',
    to_jsonb((select count(*) from public.canvas_documents where user_id = target_user)));

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_full(jsonb) from public;
grant execute on function public.restore_backup_v2_full(jsonb) to authenticated;
