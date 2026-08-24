-- 任务依赖图：task_id 是后置任务，depends_on_task_id 是前置任务。

create table if not exists public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id)
);

create index if not exists idx_task_dependencies_prerequisite
  on public.task_dependencies(user_id, depends_on_task_id, task_id);

alter table public.task_dependencies enable row level security;

drop policy if exists "Users can read own task dependencies" on public.task_dependencies;
create policy "Users can read own task dependencies"
  on public.task_dependencies for select
  using (auth.uid() = user_id);

revoke insert, update, delete on public.task_dependencies from authenticated;
grant select on public.task_dependencies to authenticated;

create or replace function public.validate_task_dependency()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.tasks task
    join public.tasks prerequisite on prerequisite.id = new.depends_on_task_id
    where task.id = new.task_id
      and task.user_id = new.user_id
      and prerequisite.user_id = new.user_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Dependency tasks must belong to the same user';
  end if;

  if exists (
    with recursive reachable as (
      select dependency.depends_on_task_id as task_id
      from public.task_dependencies dependency
      where dependency.task_id = new.depends_on_task_id
        and dependency.user_id = new.user_id
      union
      select dependency.depends_on_task_id
      from public.task_dependencies dependency
      join reachable node on dependency.task_id = node.task_id
      where dependency.user_id = new.user_id
    )
    select 1 from reachable where task_id = new.task_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Task dependencies cannot contain a cycle';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_task_dependency_trigger on public.task_dependencies;
create constraint trigger validate_task_dependency_trigger
  after insert or update of task_id, depends_on_task_id, user_id
  on public.task_dependencies
  deferrable initially immediate
  for each row execute function public.validate_task_dependency();

create or replace function public.validate_task_dependency_owner()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.task_dependencies dependency
    where (dependency.task_id = new.id or dependency.depends_on_task_id = new.id)
      and dependency.user_id is distinct from new.user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Tasks connected by dependencies must belong to the same user';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_task_dependency_owner_trigger on public.tasks;
create constraint trigger validate_task_dependency_owner_trigger
  after update of user_id on public.tasks
  deferrable initially immediate
  for each row execute function public.validate_task_dependency_owner();

create or replace function public.add_task_dependency(
  p_task_id uuid,
  p_depends_on_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user uuid := auth.uid();
begin
  if target_user is null then
    raise exception using errcode = '42501', message = 'Unauthorized';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_user::text, 0));

  if p_task_id = p_depends_on_task_id then
    raise exception using errcode = '23514', message = 'Task cannot depend on itself';
  end if;

  if not exists (
    select 1 from public.tasks
    where id = p_task_id and user_id = target_user
  ) or not exists (
    select 1 from public.tasks
    where id = p_depends_on_task_id and user_id = target_user
  ) then
    raise exception using
      errcode = '23503',
      message = 'Dependency task does not exist or is forbidden';
  end if;

  if exists (
    select 1 from public.task_dependencies
    where task_id = p_task_id
      and depends_on_task_id = p_depends_on_task_id
  ) then
    raise exception using errcode = '23505', message = 'Task dependency already exists';
  end if;

  if exists (
    with recursive reachable as (
      select dependency.depends_on_task_id as task_id
      from public.task_dependencies dependency
      where dependency.task_id = p_depends_on_task_id
        and dependency.user_id = target_user
      union
      select dependency.depends_on_task_id
      from public.task_dependencies dependency
      join reachable node on dependency.task_id = node.task_id
      where dependency.user_id = target_user
    )
    select 1 from reachable where task_id = p_task_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Task dependencies cannot contain a cycle';
  end if;

  insert into public.task_dependencies(task_id, depends_on_task_id, user_id)
  values (p_task_id, p_depends_on_task_id, target_user);

  return jsonb_build_object(
    'status', 'created',
    'task_id', p_task_id,
    'depends_on_task_id', p_depends_on_task_id
  );
end;
$$;

create or replace function public.remove_task_dependency(
  p_task_id uuid,
  p_depends_on_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user uuid := auth.uid();
  deleted_count integer;
begin
  if target_user is null then
    raise exception using errcode = '42501', message = 'Unauthorized';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_user::text, 0));

  delete from public.task_dependencies
  where task_id = p_task_id
    and depends_on_task_id = p_depends_on_task_id
    and user_id = target_user;
  get diagnostics deleted_count = row_count;

  return jsonb_build_object(
    'status',
    case when deleted_count = 0 then 'not_found' else 'removed' end
  );
end;
$$;

revoke all on function public.add_task_dependency(uuid, uuid) from public;
revoke all on function public.remove_task_dependency(uuid, uuid) from public;
grant execute on function public.add_task_dependency(uuid, uuid) to authenticated;
grant execute on function public.remove_task_dependency(uuid, uuid) to authenticated;

create or replace function public.restore_backup_v2_with_dependencies(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  restore_result jsonb;
  target_user uuid := auth.uid();
  dependencies jsonb := coalesce(p_payload->'data'->'task_dependencies', '[]'::jsonb);
begin
  if target_user is null then
    return jsonb_build_object('status', 'error', 'message', '未授权');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_user::text, 0));

  if jsonb_typeof(dependencies) <> 'array' then
    raise exception using errcode = '22023', message = 'Restore task dependencies must be an array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(dependencies) dependency
    where dependency->>'task_id' = dependency->>'depends_on_task_id'
      or not exists (
        select 1 from jsonb_array_elements(p_payload->'data'->'tasks') task
        where task->>'id' = dependency->>'task_id'
      )
      or not exists (
        select 1 from jsonb_array_elements(p_payload->'data'->'tasks') task
        where task->>'id' = dependency->>'depends_on_task_id'
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'Restore contains an invalid task dependency reference';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(dependencies) dependency
    group by dependency->>'task_id', dependency->>'depends_on_task_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Restore contains duplicate task dependencies';
  end if;

  if exists (
    with recursive dependency_edges as (
      select
        (dependency->>'task_id')::uuid as task_id,
        (dependency->>'depends_on_task_id')::uuid as depends_on_task_id
      from jsonb_array_elements(dependencies) dependency
    ),
    reachable as (
      select
        task_id as origin_id,
        depends_on_task_id as task_id,
        array[task_id] as path
      from dependency_edges
      union all
      select
        reachable.origin_id,
        edge.depends_on_task_id,
        reachable.path || edge.task_id
      from reachable
      join dependency_edges edge on edge.task_id = reachable.task_id
      where not edge.task_id = any(reachable.path)
    )
    select 1 from reachable where task_id = origin_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Restore task dependencies cannot contain a cycle';
  end if;

  restore_result := public.restore_backup_v2_with_hierarchy(p_payload);
  if (restore_result->>'status') <> 'restored' then
    return restore_result;
  end if;

  insert into public.task_dependencies(task_id, depends_on_task_id, user_id, created_at)
  select
    (dependency->>'task_id')::uuid,
    (dependency->>'depends_on_task_id')::uuid,
    target_user,
    coalesce((dependency->>'created_at')::timestamptz, now())
  from jsonb_array_elements(dependencies) dependency;

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_with_dependencies(jsonb) from public;
grant execute on function public.restore_backup_v2_with_dependencies(jsonb) to authenticated;
