-- 独立倒数日：日期只保存为 date，避免时区转换造成日期偏移。
create table if not exists public.countdown_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  target_date date not null,
  repeat_annually boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_countdown_days_user_deleted_date
  on public.countdown_days(user_id, deleted_at, target_date);
create index if not exists idx_countdown_days_user_deleted
  on public.countdown_days(user_id, deleted_at);

drop trigger if exists countdown_days_set_updated_at on public.countdown_days;
create trigger countdown_days_set_updated_at
  before update on public.countdown_days
  for each row execute function public.update_updated_at_column();

alter table public.countdown_days enable row level security;
drop policy if exists "Users can view own countdown days" on public.countdown_days;
drop policy if exists "Users can insert own countdown days" on public.countdown_days;
drop policy if exists "Users can update own countdown days" on public.countdown_days;
drop policy if exists "Users can delete own countdown days" on public.countdown_days;
create policy "Users can view own countdown days" on public.countdown_days
  for select using (auth.uid() = user_id and deleted_at is null);
create policy "Users can insert own countdown days" on public.countdown_days
  for insert with check (auth.uid() = user_id and deleted_at is null);
create policy "Users can update own countdown days" on public.countdown_days
  for update using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id and deleted_at is null);

grant select, insert, update on table public.countdown_days to authenticated;
revoke delete on table public.countdown_days from anon, authenticated;

-- 统一垃圾箱：倒数日和数据库都必须走 RPC，不能通过表 API 直接物理删除。
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
     and p_resource_type not in ('note', 'reading_item', 'task', 'lesson', 'database', 'countdown') then
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
    ) deleted
    order by deleted.deleted_at desc
    limit 500;
end;
$$;

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
      update public.tasks set deleted_at = now()
      where user_id = target_user and id = any(p_ids) and deleted_at is null;
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
      update public.tasks set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
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
    delete from public.favorites where user_id = target_user and target_type = 'task' and target_id = any(p_ids);
    delete from public.tasks where user_id = target_user and id = any(p_ids) and deleted_at is not null;
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

revoke all on function public.list_trash(text) from public;
revoke all on function public.mutate_trash(text, text, uuid[]) from public;
grant execute on function public.list_trash(text) to authenticated;
grant execute on function public.mutate_trash(text, text, uuid[]) to authenticated;

-- 034 备份恢复：倒数日是可选表，旧 v2/v3 备份缺少该 key 时跳过。
create or replace function public.restore_backup_v2_with_pages(p_payload jsonb)
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

  restore_result := public.restore_backup_v2(p_payload);
  if (restore_result->>'status') = 'not_empty' or (restore_result->>'status') = 'error' then
    return restore_result;
  end if;

  if jsonb_typeof(p_payload->'data'->'task_lists') = 'array' then
    insert into public.task_lists (id, user_id, name, icon, color, sort_order, is_default, created_at, updated_at)
    select row.id, target_user, row.name, row.icon, row.color, row.sort_order, coalesce(row.is_default, false), row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'task_lists') as row(
      id uuid, name text, icon text, color text, sort_order int, is_default boolean, created_at timestamptz, updated_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'task_reminders') = 'array' then
    insert into public.task_reminders (id, user_id, task_id, anchor, offset_minutes, notified_at, created_at)
    select row.id, target_user, row.task_id, row.anchor, row.offset_minutes, row.notified_at, row.created_at
    from jsonb_to_recordset(p_payload->'data'->'task_reminders') as row(
      id uuid, task_id uuid, anchor text, offset_minutes int, notified_at timestamptz, created_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'task_attachments') = 'array' then
    insert into public.task_attachments (id, user_id, task_id, name, bucket, path, mime_type, size_bytes, created_at)
    select row.id, target_user, row.task_id, row.name, coalesce(row.bucket, 'attachments'), row.path, row.mime_type, row.size_bytes, row.created_at
    from jsonb_to_recordset(p_payload->'data'->'task_attachments') as row(
      id uuid, task_id uuid, name text, bucket text, path text, mime_type text, size_bytes bigint, created_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'task_activities') = 'array' then
    insert into public.task_activities (id, user_id, task_id, action, detail, created_at)
    select row.id, target_user, row.task_id, row.action, row.detail, row.created_at
    from jsonb_to_recordset(p_payload->'data'->'task_activities') as row(
      id uuid, task_id uuid, action text, detail jsonb, created_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'task_templates') = 'array' then
    insert into public.task_templates (id, user_id, name, template, created_at, updated_at)
    select row.id, target_user, row.name, row.template, row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'task_templates') as row(
      id uuid, name text, template jsonb, created_at timestamptz, updated_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'countdown_days') = 'array' then
    insert into public.countdown_days (id, user_id, title, target_date, repeat_annually, deleted_at, created_at, updated_at)
    select row.id, target_user, row.title, row.target_date, coalesce(row.repeat_annually, false), row.deleted_at, row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'countdown_days') as row(
      id uuid, title text, target_date date, repeat_annually boolean, deleted_at timestamptz,
      created_at timestamptz, updated_at timestamptz
    ) on conflict (id) do nothing;
  end if;

  return restore_result;
end;
$$;
revoke all on function public.restore_backup_v2_with_pages(jsonb) from public;
grant execute on function public.restore_backup_v2_with_pages(jsonb) to authenticated;
