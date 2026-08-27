-- 050 db_rows 单行软删除 + 已删任务列表 RPC
--
-- 背景（#138 调查的延续，两处同根因遗留 bug）：
-- 1. 编辑器数据库视图的「删除行」走 DELETE /api/databases/[id]/rows/[rowId]，
--    路由直写 deleted_at 被 RLS 拒绝（UPDATE 时 SELECT 策略 USING 作为新行隐式
--    检查，db_rows 的 using/with_check 均要求 deleted_at IS NULL）→ 行删除一直 500。
-- 2. 任务页侧栏「垃圾桶」scope：列表查询走 RLS（已删行不可见），导致
--    scope=trash 渲染永远为空、侧栏计数永远 0。
--
-- 方案：
-- A) mutate_trash 增加 database_row 分支（软删/恢复/物理删除单行）。
--    不加进 list_trash——数据库行不属于全局垃圾箱的产品语义（无独立标题，
--    恢复入口在数据库视图内），保持 /trash 页行为不变。
-- B) 新增 list_trashed_tasks()：security definer，返回已删任务的完整行
--    （含 tags 聚合），供任务页垃圾桶视图使用。

-- ========== A. mutate_trash 增加 database_row ==========
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
  if p_resource_type not in ('note', 'reading_item', 'task', 'lesson', 'database', 'countdown', 'database_row') then
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
      -- 单行软删：不动所属数据库与其他行（编辑器「删除行」入口）
      update public.db_rows set deleted_at = now()
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
  elsif p_resource_type = 'database_row' then
    delete from public.db_rows
    where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  else
    delete from public.countdown_days where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  end if;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.mutate_trash(text, text, uuid[]) from public;
grant execute on function public.mutate_trash(text, text, uuid[]) to authenticated;

-- ========== B. 已删任务列表（任务页垃圾桶视图数据源） ==========
create or replace function public.list_trashed_tasks()
returns jsonb
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
  return coalesce((
    select jsonb_agg(row_data)
    from (
      select jsonb_build_object(
        'id', t.id,
        'user_id', t.user_id,
        'title', t.title,
        'description', t.description,
        'status', t.status,
        'priority', t.priority,
        'category', t.category,
        'due_date', t.due_date,
        'estimated_minutes', t.estimated_minutes,
        'actual_minutes', t.actual_minutes,
        'reading_item_id', t.reading_item_id,
        'note_id', t.note_id,
        'is_pinned', t.is_pinned,
        'completed_at', t.completed_at,
        'created_at', t.created_at,
        'updated_at', t.updated_at,
        'sort_order', t.sort_order,
        'deleted_at', t.deleted_at,
        'deleted_reason', t.deleted_reason,
        'reference_managed', t.reference_managed,
        'sync_version', t.sync_version,
        'list_id', t.list_id,
        'schedule_start_at', t.schedule_start_at,
        'schedule_end_at', t.schedule_end_at,
        'all_day', t.all_day,
        'timezone', t.timezone,
        'recurrence_rule', t.recurrence_rule,
        'series_id', t.series_id,
        'source_id', t.source_id,
        'parent_task_id', t.parent_task_id,
        'tags', coalesce(jsonb_agg(
          jsonb_build_object('id', tag.id, 'name', tag.name, 'color', tag.color)
        ) filter (where tag.id is not null), '[]'::jsonb)
      ) as row_data
      from public.tasks t
      left join public.task_tags tt on tt.task_id = t.id
      left join public.tags tag on tag.id = tt.tag_id
      where t.user_id = target_user and t.deleted_at is not null
      group by t.id
      order by max(t.deleted_at) desc
    ) rows_data
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_trashed_tasks() from public;
grant execute on function public.list_trashed_tasks() to authenticated;
