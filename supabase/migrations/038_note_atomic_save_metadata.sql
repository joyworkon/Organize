-- 统一笔记保存：在原子乐观锁 RPC 中同时写入正文、标题和页面元数据。
drop function if exists public.save_note_with_tasks(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid
);

create function public.save_note_with_tasks(
  p_note_id uuid,
  p_content jsonb,
  p_expected_note_revision integer,
  p_title text default null,
  p_task_mutations jsonb default null,
  p_expected_task_revisions jsonb default null,
  p_mutation_id uuid default null,
  p_note_snapshot jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_note_owner uuid;
  v_cur_rev integer;
  v_mutation_result jsonb;
  v_task_id uuid;
  v_task_rev integer;
  v_exp_rev integer;
  v_new_task_rev integer;
  v_title text;
  v_status text;
  v_task_revisions jsonb := '{}'::jsonb;
  v_m record;
begin
  if v_user is null then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if p_mutation_id is not null then
    select result into v_mutation_result
    from public.save_mutation_log
    where mutation_id = p_mutation_id and user_id = v_user;
    if found then
      return v_mutation_result;
    end if;
  end if;

  select user_id, content_revision into v_note_owner, v_cur_rev
  from public.notes
  where id = p_note_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_note_owner <> v_user then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if v_cur_rev <> p_expected_note_revision then
    return jsonb_build_object(
      'status', 'conflict_note',
      'current_revision', v_cur_rev
    );
  end if;

  if p_task_mutations is not null then
    for v_m in select jsonb_array_elements(p_task_mutations) as elem
    loop
      v_task_id := (v_m.elem->>'task_id')::uuid;
      select sync_version into v_task_rev
      from public.tasks
      where id = v_task_id and user_id = v_user
      for update;
      if not found then
        return jsonb_build_object(
          'status', 'conflict_task',
          'task_id', v_task_id,
          'reason', 'not_found_or_forbidden'
        );
      end if;
      if p_expected_task_revisions is not null then
        v_exp_rev := coalesce(
          (p_expected_task_revisions->>(v_m.elem->>'task_id'))::integer,
          0
        );
        if v_task_rev <> v_exp_rev then
          return jsonb_build_object(
            'status', 'conflict_task',
            'task_id', v_task_id,
            'current_sync_version', v_task_rev
          );
        end if;
      end if;
    end loop;
  end if;

  update public.notes
  set content = p_content,
      content_revision = v_cur_rev + 1,
      title = coalesce(p_title, title),
      icon = case
        when p_note_snapshot ? 'icon' then p_note_snapshot->>'icon'
        else icon
      end,
      cover_url = case
        when p_note_snapshot ? 'cover_url' then p_note_snapshot->>'cover_url'
        else cover_url
      end,
      cover_position = case
        when p_note_snapshot ? 'cover_position'
          then coalesce((p_note_snapshot->>'cover_position')::smallint, 50)
        else cover_position
      end,
      parent_note_id = case
        when p_note_snapshot ? 'parent_note_id'
          then nullif(p_note_snapshot->>'parent_note_id', '')::uuid
        else parent_note_id
      end,
      full_width = case
        when p_note_snapshot ? 'full_width'
          then coalesce((p_note_snapshot->>'full_width')::boolean, false)
        else full_width
      end,
      font_family = case
        when p_note_snapshot ? 'font_family'
          then coalesce(p_note_snapshot->>'font_family', 'default')
        else font_family
      end,
      small_font = case
        when p_note_snapshot ? 'small_font'
          then coalesce((p_note_snapshot->>'small_font')::boolean, false)
        else small_font
      end,
      updated_at = now()
  where id = p_note_id;

  if p_task_mutations is not null then
    for v_m in select jsonb_array_elements(p_task_mutations) as elem
    loop
      v_task_id := (v_m.elem->>'task_id')::uuid;
      v_title := v_m.elem->>'title';
      v_status := v_m.elem->>'status';
      update public.tasks
      set title = case when v_title is not null then v_title else title end,
          status = case when v_status is not null then v_status else status end,
          completed_at = case
            when v_status = 'done' and completed_at is null then now()
            when v_status in ('todo', 'in_progress', 'cancelled') then null
            else completed_at
          end,
          sync_version = sync_version + 1,
          updated_at = now()
      where id = v_task_id and user_id = v_user
      returning sync_version into v_new_task_rev;
      v_task_revisions := v_task_revisions
        || jsonb_build_object(v_task_id::text, v_new_task_rev);
    end loop;
  end if;

  delete from public.task_item_refs where note_id = p_note_id;

  insert into public.task_item_refs (user_id, task_id, note_id, block_id)
  select v_user, task_id, p_note_id, block_id
  from public.extract_task_items(p_content)
  where task_id is not null
  on conflict (note_id, block_id) do nothing;

  with affected_tasks as (
    select id from public.tasks
    where user_id = v_user
      and reference_managed = true
      and deleted_at is null
      and not exists (
        select 1 from public.task_item_refs r
        where r.task_id = public.tasks.id
      )
  )
  update public.tasks
  set deleted_at = now(),
      deleted_reason = 'orphaned',
      updated_at = now()
  where id in (select id from affected_tasks);

  v_mutation_result := jsonb_build_object(
    'status', 'ok',
    'note_revision', v_cur_rev + 1,
    'task_revisions', v_task_revisions
  );
  if p_mutation_id is not null then
    insert into public.save_mutation_log (mutation_id, user_id, result)
    values (p_mutation_id, v_user, v_mutation_result)
    on conflict (mutation_id) do nothing;
  end if;

  return v_mutation_result;
end;
$$;

revoke all on function public.save_note_with_tasks(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid, jsonb
) from public;
grant execute on function public.save_note_with_tasks(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid, jsonb
) to authenticated;
