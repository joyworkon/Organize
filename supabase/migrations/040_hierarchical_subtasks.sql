-- 真正的层级子任务：子任务继续使用完整 tasks 模型。

alter table public.tasks
  add column if not exists parent_task_id uuid;

alter table public.tasks
  drop constraint if exists tasks_parent_task_id_fkey;
alter table public.tasks
  add constraint tasks_parent_task_id_fkey
  foreign key (parent_task_id) references public.tasks(id) on delete set null;

alter table public.tasks
  drop constraint if exists tasks_parent_task_not_self;
alter table public.tasks
  add constraint tasks_parent_task_not_self
  check (parent_task_id is null or parent_task_id <> id);

create index if not exists idx_tasks_parent
  on public.tasks(user_id, parent_task_id, deleted_at, sort_order);

create or replace function public.validate_task_parent()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.tasks child
    where child.parent_task_id = new.id
      and child.user_id is distinct from new.user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Child tasks must belong to the same user';
  end if;

  if new.parent_task_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.tasks parent
    where parent.id = new.parent_task_id
      and parent.user_id = new.user_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Parent task must belong to the same user';
  end if;

  if exists (
    with recursive ancestors as (
      select task.id, task.parent_task_id
      from public.tasks task
      where task.id = new.parent_task_id
        and task.user_id = new.user_id
      union
      select task.id, task.parent_task_id
      from public.tasks task
      join ancestors ancestor on task.id = ancestor.parent_task_id
      where task.user_id = new.user_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Task hierarchy cannot contain a cycle';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_task_parent_trigger on public.tasks;
create constraint trigger validate_task_parent_trigger
  after insert or update of parent_task_id, user_id on public.tasks
  deferrable initially immediate
  for each row execute function public.validate_task_parent();

create or replace function public.restore_backup_v2_with_hierarchy(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  restore_result jsonb;
  target_user uuid := auth.uid();
begin
  if target_user is null then
    return jsonb_build_object('status', 'error', 'message', '未授权');
  end if;

  if jsonb_typeof(p_payload->'data'->'tasks') = 'array' then
    if exists (
      select 1
      from jsonb_array_elements(p_payload->'data'->'tasks') task
      where task->>'parent_task_id' is not null
        and (
          task->>'parent_task_id' = task->>'id'
          or not exists (
            select 1
            from jsonb_array_elements(p_payload->'data'->'tasks') parent
            where parent->>'id' = task->>'parent_task_id'
          )
        )
    ) then
      raise exception using
        errcode = '23503',
        message = 'Restore contains an invalid parent task reference';
    end if;

    if exists (
      with recursive task_links as (
        select
          (task->>'id')::uuid as id,
          (task->>'parent_task_id')::uuid as parent_id
        from jsonb_array_elements(p_payload->'data'->'tasks') task
        where task->>'parent_task_id' is not null
      ),
      ancestry as (
        select id as origin_id, parent_id, array[id] as path
        from task_links
        union all
        select ancestry.origin_id, task_links.parent_id, ancestry.path || task_links.id
        from ancestry
        join task_links on task_links.id = ancestry.parent_id
        where not task_links.id = any(ancestry.path)
      )
      select 1 from ancestry where parent_id = origin_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'Restore task hierarchy cannot contain a cycle';
    end if;
  end if;

  restore_result := public.restore_backup_v2_with_pages(p_payload);
  if (restore_result->>'status') <> 'restored' then
    return restore_result;
  end if;

  update public.tasks task
  set parent_task_id = (payload_task->>'parent_task_id')::uuid
  from jsonb_array_elements(p_payload->'data'->'tasks') payload_task
  where payload_task ? 'parent_task_id'
    and payload_task->>'parent_task_id' is not null
    and task.id = (payload_task->>'id')::uuid
    and task.user_id = target_user;

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_with_hierarchy(jsonb) from public;
grant execute on function public.restore_backup_v2_with_hierarchy(jsonb) to authenticated;
