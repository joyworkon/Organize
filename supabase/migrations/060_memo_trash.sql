-- 060: 速记（memos）接入垃圾箱体系（P1-04）
-- 055 迁移时 deleted_at 已预留但未接入 mutate_trash / list_trash（注释明示后续接入）。
-- 本迁移替换两个 RPC：资源类型白名单加入 'memo'，三个动作各加 memo 分支。
-- memos 无子资源、无收藏/分享关联，permanent_delete 直接物理删除软删行即可。

-- ========== A. mutate_trash：加入 memo ==========
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
  if p_resource_type not in ('note', 'reading_item', 'task', 'lesson', 'database', 'countdown', 'database_row', 'memo') then
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
    elsif p_resource_type = 'database_row' then
      update public.db_rows set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
    elsif p_resource_type = 'memo' then
      update public.memos set deleted_at = now()
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
    elsif p_resource_type = 'database_row' then
      update public.db_rows set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
    elsif p_resource_type = 'memo' then
      update public.memos set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
    else
      update public.countdown_days set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
    end if;
    get diagnostics affected = row_count;
    return affected;
  end if;

  -- permanent_delete
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
  elsif p_resource_type = 'database_row' then
    delete from public.db_rows
    where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  elsif p_resource_type = 'memo' then
    delete from public.memos where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  else
    delete from public.countdown_days where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  end if;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- ========== B. list_trash：追加 memo 分组 ==========
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
     and p_resource_type not in ('note', 'reading_item', 'task', 'lesson', 'database', 'countdown', 'database_row', 'memo') then
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
      union all
      select 'countdown'::text, c.id, c.title::text, c.deleted_at
      from public.countdown_days c
      where c.user_id = target_user and c.deleted_at is not null
        and (p_resource_type is null or p_resource_type = 'countdown')
      union all
      select 'memo'::text, m.id,
             coalesce(nullif(left(m.content, 50), ''), '无标题速记')::text as title, m.deleted_at
      from public.memos m
      where m.user_id = target_user and m.deleted_at is not null
        and (p_resource_type is null or p_resource_type = 'memo')
    ) deleted
    order by deleted.deleted_at desc
    limit 500;
end;
$$;

-- 维持既有 EXECUTE 分层（与 050/029 相同口径）
revoke all on function public.mutate_trash(text, text, uuid[]) from public;
grant execute on function public.mutate_trash(text, text, uuid[]) to authenticated;
revoke all on function public.list_trash(text) from public;
grant execute on function public.list_trash(text) to authenticated;
