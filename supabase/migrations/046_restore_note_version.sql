-- 046 版本恢复递增 content_revision
-- 背景：此前恢复走普通 update，content_revision 不变；其他设备用旧 revision
-- 发起的自动保存会通过乐观锁比对、静默覆盖刚恢复的内容。
-- 与 save_note_with_tasks 的语义对齐：任何内容变更都必须推进 revision。

create or replace function public.restore_note_version(
  p_note_id uuid,
  p_version_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_content jsonb;
  v_title text;
  v_rev integer;
begin
  if v_user is null then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select content, title into v_content, v_title
  from public.note_versions
  where id = p_version_id and note_id = p_note_id;

  if not found then
    return jsonb_build_object('status', 'version_not_found');
  end if;

  -- notes 的更新触发器会把当前内容归档为新版本（恢复仍可逆），
  -- 这里再推进 revision，令其他会话的 in-flight 保存正确落入 conflict_note。
  update public.notes
  set content = v_content,
      title = v_title,
      content_revision = content_revision + 1,
      updated_at = now()
  where id = p_note_id and user_id = v_user
  returning content_revision into v_rev;

  if not found then
    return jsonb_build_object('status', 'note_not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'note_revision', v_rev);
end;
$$;

revoke all on function public.restore_note_version(uuid, uuid) from public;
grant execute on function public.restore_note_version(uuid, uuid) to authenticated;
