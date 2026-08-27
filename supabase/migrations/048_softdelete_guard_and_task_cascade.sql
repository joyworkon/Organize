-- 048 软删除边界加固
-- A) save_note_with_tasks 拒绝已软删笔记：
--    该 RPC 是 security definer 且此前不检查 deleted_at，前端删除笔记后
--    滞留的防抖保存/卸载兜底 flush 会把内容写进已进垃圾箱的笔记，
--    垃圾箱快照漂移，恢复后出现删除时刻不该有的修改。
-- B) mutate_trash 的 task 分支按子树级联：
--    此前只处理给定 id——软删父任务后子任务在任何 scope 都不可见（幽灵），
--    却仍留在用户数据里被提醒调度扫到；恢复/物理删除同样只作用于单层。

-- ========== A. save_note_with_tasks 增加软删校验 ==========
drop function if exists public.save_note_with_tasks(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid, jsonb
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
    -- 幂等回放仅限同一篇笔记：跨笔记复用 mutation_id 视为新请求重新执行
    select result into v_mutation_result
    from public.save_mutation_log
    where mutation_id = p_mutation_id and user_id = v_user
      and (note_id is null or note_id = p_note_id);
    if found then
      return v_mutation_result;
    end if;
  end if;

  -- 已进垃圾箱的笔记拒绝写入（security definer 绕过 RLS，必须在此显式校验）
  select user_id, content_revision into v_note_owner, v_cur_rev
  from public.notes
  where id = p_note_id and deleted_at is null
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
      where id = v_task_id and user_id = v_user and deleted_at is null
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
    insert into public.save_mutation_log (mutation_id, user_id, note_id, result)
    values (p_mutation_id, v_user, p_note_id, v_mutation_result)
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

-- ========== B. mutate_trash 的 task 分支按子树级联 ==========
create or replace function public.mutate_trash(
  p_action text,
  p_resource_type text,
  p_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user uuid := auth.uid();
  affected integer := 0;
begin
  if target_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_action not in ('soft_delete', 'restore', 'permanent_delete') then
    raise exception using errcode = '22023', message = 'Invalid trash action';
  end if;
  if p_resource_type not in ('note', 'reading_item', 'task', 'lesson', 'database', 'countdown') then
    raise exception using errcode = '22023', message = 'Invalid resource type';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 200 then
    raise exception using errcode = '22023', message = 'Invalid resource IDs';
  end if;

  if p_action = 'soft_delete' then
    if p_resource_type = 'note' then
      update public.notes set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
    elsif p_resource_type = 'reading_item' then
      update public.reading_items set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
    elsif p_resource_type = 'task' then
      -- 级联软删整个子树，避免子任务成为不可见的"幽灵"
      with recursive doomed as (
        select t.id from public.tasks t
        where t.user_id = target_user and t.id = any(p_ids) and t.deleted_at is null
        union all
        select c.id from public.tasks c join doomed d on c.parent_task_id = d.id
        where c.deleted_at is null
      )
      update public.tasks set deleted_at = now()
      where id in (select id from doomed);
      get diagnostics affected = row_count;
      return affected;
    elsif p_resource_type = 'lesson' then
      update public.lessons set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
    elsif p_resource_type = 'database' then
      update public.db_rows set deleted_at = now()
      where database_id = any(p_ids) and user_id = target_user and deleted_at is null;
      update public.db_databases set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
    else
      update public.countdown_days set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
    end if;
    get diagnostics affected = row_count;
    return affected;
  end if;

  if p_action = 'restore' then
    if p_resource_type = 'note' then
      update public.notes set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
    elsif p_resource_type = 'reading_item' then
      update public.reading_items set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
    elsif p_resource_type = 'task' then
      -- 随父任务一起入桶的子孙一并恢复；比父任务更早独立删除的保持不动
      with recursive targets as (
        select t.id, t.deleted_at as root_deleted_at from public.tasks t
        where t.user_id = target_user and t.id = any(p_ids) and t.deleted_at is not null
        union all
        select c.id, r.root_deleted_at from public.tasks c join targets r on c.parent_task_id = r.id
        where c.deleted_at is not null and c.deleted_at >= r.root_deleted_at
      )
      update public.tasks set deleted_at = null
      where id in (select id from targets);
      get diagnostics affected = row_count;
      return affected;
    elsif p_resource_type = 'lesson' then
      update public.lessons set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
    elsif p_resource_type = 'database' then
      update public.db_databases set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
      update public.db_rows set deleted_at = null
      where database_id = any(p_ids) and user_id = target_user and deleted_at is not null;
    else
      update public.countdown_days set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
    end if;
    get diagnostics affected = row_count;
    return affected;
  end if;

  if p_resource_type = 'note' then
    delete from public.favorites where user_id = target_user and target_type = 'note' and target_id = any(p_ids);
    delete from public.shares where owner_id = target_user and resource_type = 'note' and resource_id = any(p_ids);
    delete from public.notes where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  elsif p_resource_type = 'reading_item' then
    delete from public.favorites where user_id = target_user and target_type = 'reading' and target_id = any(p_ids);
    delete from public.shares where owner_id = target_user and resource_type = 'reading_item' and resource_id = any(p_ids);
    delete from public.reading_items where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  elsif p_resource_type = 'task' then
    -- 物理删除随整棵子树（同窗口入桶的），否则子孙会成为无父的孤儿数据
    with recursive doomed as (
      select t.id, t.deleted_at as root_deleted_at from public.tasks t
      where t.user_id = target_user and t.id = any(p_ids) and t.deleted_at is not null
      union all
      select c.id, r.root_deleted_at from public.tasks c join doomed r on c.parent_task_id = r.id
      where c.deleted_at is not null and c.deleted_at >= r.root_deleted_at
    )
    delete from public.favorites
    where user_id = target_user and target_type = 'task'
      and target_id in (select id from doomed);
    with recursive doomed as (
      select t.id, t.deleted_at as root_deleted_at from public.tasks t
      where t.user_id = target_user and t.id = any(p_ids) and t.deleted_at is not null
      union all
      select c.id, r.root_deleted_at from public.tasks c join doomed r on c.parent_task_id = r.id
      where c.deleted_at is not null and c.deleted_at >= r.root_deleted_at
    )
    delete from public.tasks
    where id in (select id from doomed);
  elsif p_resource_type = 'lesson' then
    delete from public.lessons where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  elsif p_resource_type = 'database' then
    delete from public.db_rows where database_id = any(p_ids) and user_id = target_user;
    delete from public.favorites where user_id = target_user and target_type = 'database' and target_id = any(p_ids);
    delete from public.shares where owner_id = target_user and resource_type = 'database' and resource_id = any(p_ids);
    delete from public.db_databases where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  else
    delete from public.countdown_days where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  end if;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.mutate_trash(text, text, uuid[]) from public;
grant execute on function public.mutate_trash(text, text, uuid[]) to authenticated;
