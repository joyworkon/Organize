-- M3 收尾：把 db_databases 接入回收站（list_trash / mutate_trash）
-- 行是子资源：软删/恢复/物理删除 database 时，级联处理其 db_rows。

-- 物理删除表权限显式收回（对齐 notes/tasks/lessons 的约定；API 只允许软删）
revoke delete on table public.db_databases from anon, authenticated;
revoke delete on table public.db_rows from anon, authenticated;

-- 替换 list_trash：追加 'database'
create or replace function public.list_trash(p_resource_type text default null)
returns table (
  resource_type text,
  id uuid,
  title text,
  deleted_at timestamptz
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  target_user uuid := auth.uid();
begin
  if target_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_resource_type is not null
     and p_resource_type not in ('note', 'reading_item', 'task', 'lesson', 'database') then
    raise exception using errcode = '22023', message = 'Invalid resource type';
  end if;

  return query
    select deleted.resource_type, deleted.id, deleted.title, deleted.deleted_at
    from (
      select 'note'::text as resource_type, n.id,
             coalesce(n.title, '无标题笔记')::text as title, n.deleted_at
      from public.notes n
      where n.user_id = target_user and n.deleted_at is not null
        and (p_resource_type is null or p_resource_type = 'note')
      union all
      select 'reading_item'::text, r.id,
             coalesce(r.title, '无标题文章')::text, r.deleted_at
      from public.reading_items r
      where r.user_id = target_user and r.deleted_at is not null
        and (p_resource_type is null or p_resource_type = 'reading_item')
      union all
      select 'task'::text, t.id, t.title::text, t.deleted_at
      from public.tasks t
      where t.user_id = target_user and t.deleted_at is not null
        and (p_resource_type is null or p_resource_type = 'task')
      union all
      select 'lesson'::text, l.id,
             coalesce(l.title, '无标题经验')::text, l.deleted_at
      from public.lessons l
      where l.user_id = target_user and l.deleted_at is not null
        and (p_resource_type is null or p_resource_type = 'lesson')
      union all
      select 'database'::text, d.id,
             coalesce(nullif(d.title, ''), '未命名数据库')::text, d.deleted_at
      from public.db_databases d
      where d.user_id = target_user and d.deleted_at is not null
        and (p_resource_type is null or p_resource_type = 'database')
    ) deleted
    order by deleted.deleted_at desc
    limit 500;
end;
$$;

-- 替换 mutate_trash：追加 'database' 分支，级联 db_rows
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
  row_cnt integer;
begin
  if target_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_action not in ('soft_delete', 'restore', 'permanent_delete') then
    raise exception using errcode = '22023', message = 'Invalid trash action';
  end if;
  if p_resource_type not in ('note', 'reading_item', 'task', 'lesson', 'database') then
    raise exception using errcode = '22023', message = 'Invalid resource type';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 200 then
    raise exception using errcode = '22023', message = 'Invalid resource IDs';
  end if;

  if p_action = 'soft_delete' then
    if p_resource_type = 'note' then
      update public.notes set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
      get diagnostics affected = row_count;
    elsif p_resource_type = 'reading_item' then
      update public.reading_items set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
      get diagnostics affected = row_count;
    elsif p_resource_type = 'task' then
      update public.tasks set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
      get diagnostics affected = row_count;
    elsif p_resource_type = 'lesson' then
      update public.lessons set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
      get diagnostics affected = row_count;
    else
      -- database：级联软删其所有行
      update public.db_rows
        set deleted_at = now()
        where database_id = any(p_ids)
          and user_id = target_user
          and deleted_at is null;
      update public.db_databases set deleted_at = now()
        where user_id = target_user and id = any(p_ids) and deleted_at is null;
      get diagnostics affected = row_count;
    end if;
    return affected;
  end if;

  if p_action = 'restore' then
    if p_resource_type = 'note' then
      update public.notes set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
      get diagnostics affected = row_count;
    elsif p_resource_type = 'reading_item' then
      update public.reading_items set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
      get diagnostics affected = row_count;
    elsif p_resource_type = 'task' then
      update public.tasks set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
      get diagnostics affected = row_count;
    elsif p_resource_type = 'lesson' then
      update public.lessons set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
      get diagnostics affected = row_count;
    else
      -- database：恢复库，同时恢复其下已软删的行
      update public.db_databases set deleted_at = null
        where user_id = target_user and id = any(p_ids) and deleted_at is not null;
      get diagnostics affected = row_count;
      update public.db_rows
        set deleted_at = null
        where database_id = any(p_ids)
          and user_id = target_user
          and deleted_at is not null;
    end if;
    return affected;
  end if;

  -- permanent_delete
  if p_resource_type = 'note' then
    delete from public.favorites
    where user_id = target_user and target_type = 'note' and target_id = any(p_ids);
    delete from public.shares
    where owner_id = target_user and resource_type = 'note' and resource_id = any(p_ids);
    delete from public.notes
    where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  elsif p_resource_type = 'reading_item' then
    delete from public.favorites
    where user_id = target_user and target_type = 'reading' and target_id = any(p_ids);
    delete from public.shares
    where owner_id = target_user
      and resource_type = 'reading_item' and resource_id = any(p_ids);
    delete from public.reading_items
    where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  elsif p_resource_type = 'task' then
    delete from public.favorites
    where user_id = target_user and target_type = 'task' and target_id = any(p_ids);
    delete from public.tasks
    where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  elsif p_resource_type = 'lesson' then
    delete from public.lessons
    where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  else
    -- database：先删行（FK on delete cascade 也会处理，但显式删更直观）
    delete from public.db_rows
      where database_id = any(p_ids) and user_id = target_user;
    delete from public.favorites
      where user_id = target_user and target_type = 'database' and target_id = any(p_ids);
    delete from public.shares
      where owner_id = target_user and resource_type = 'database' and resource_id = any(p_ids);
    delete from public.db_databases
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  end if;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.list_trash(text) from public;
revoke all on function public.mutate_trash(text, text, uuid[]) from public;
grant execute on function public.list_trash(text) to authenticated;
grant execute on function public.mutate_trash(text, text, uuid[]) to authenticated;
