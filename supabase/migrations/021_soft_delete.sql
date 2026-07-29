-- Recoverable deletion for the four core resource types.

alter table public.notes
  add column if not exists deleted_at timestamptz;
alter table public.reading_items
  add column if not exists deleted_at timestamptz;
alter table public.tasks
  add column if not exists deleted_at timestamptz;
alter table public.lessons
  add column if not exists deleted_at timestamptz;

create index if not exists idx_notes_user_deleted_at
  on public.notes(user_id, deleted_at);
create index if not exists idx_reading_items_user_deleted_at
  on public.reading_items(user_id, deleted_at);
create index if not exists idx_tasks_user_deleted_at
  on public.tasks(user_id, deleted_at);
create index if not exists idx_lessons_user_deleted_at
  on public.lessons(user_id, deleted_at);

drop policy if exists "Users can view own notes" on public.notes;
drop policy if exists "Users can insert own notes" on public.notes;
drop policy if exists "Users can update own notes" on public.notes;
drop policy if exists "Users can delete own notes" on public.notes;
create policy "Users can view own notes" on public.notes
  for select using (auth.uid() = user_id and deleted_at is null);
create policy "Users can insert own notes" on public.notes
  for insert with check (auth.uid() = user_id and deleted_at is null);
create policy "Users can update own notes" on public.notes
  for update using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can view own reading items" on public.reading_items;
drop policy if exists "Users can insert own reading items" on public.reading_items;
drop policy if exists "Users can update own reading items" on public.reading_items;
drop policy if exists "Users can delete own reading items" on public.reading_items;
create policy "Users can view own reading items" on public.reading_items
  for select using (auth.uid() = user_id and deleted_at is null);
create policy "Users can insert own reading items" on public.reading_items
  for insert with check (auth.uid() = user_id and deleted_at is null);
create policy "Users can update own reading items" on public.reading_items
  for update using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can view own tasks" on public.tasks;
drop policy if exists "Users can insert own tasks" on public.tasks;
drop policy if exists "Users can update own tasks" on public.tasks;
drop policy if exists "Users can delete own tasks" on public.tasks;
create policy "Users can view own tasks" on public.tasks
  for select using (auth.uid() = user_id and deleted_at is null);
create policy "Users can insert own tasks" on public.tasks
  for insert with check (auth.uid() = user_id and deleted_at is null);
create policy "Users can update own tasks" on public.tasks
  for update using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can view own lessons" on public.lessons;
drop policy if exists "Users can insert own lessons" on public.lessons;
drop policy if exists "Users can update own lessons" on public.lessons;
drop policy if exists "Users can delete own lessons" on public.lessons;
create policy "Users can view own lessons" on public.lessons
  for select using (auth.uid() = user_id and deleted_at is null);
create policy "Users can insert own lessons" on public.lessons
  for insert with check (auth.uid() = user_id and deleted_at is null);
create policy "Users can update own lessons" on public.lessons
  for update using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id and deleted_at is null);

-- Active rows can no longer be physically deleted through table APIs.
revoke delete on table public.notes from anon, authenticated;
revoke delete on table public.reading_items from anon, authenticated;
revoke delete on table public.tasks from anon, authenticated;
revoke delete on table public.lessons from anon, authenticated;

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
     and p_resource_type not in ('note', 'reading_item', 'task', 'lesson') then
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
  if p_resource_type not in ('note', 'reading_item', 'task', 'lesson') then
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
    else
      update public.lessons set deleted_at = now()
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
    else
      update public.lessons set deleted_at = null
      where user_id = target_user and id = any(p_ids) and deleted_at is not null;
    end if;
    get diagnostics affected = row_count;
    return affected;
  end if;

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
  else
    delete from public.lessons
    where user_id = target_user and id = any(p_ids) and deleted_at is not null;
  end if;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Keep the token capability boundary, but hide soft-deleted resources.
create or replace function public.get_public_share(p_token text)
returns table (
  status text,
  resource_type text,
  expires_at timestamptz,
  resource jsonb
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  selected_share public.shares%rowtype;
  payload jsonb;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 256 then
    return query select 'missing'::text, null::text, null::timestamptz, null::jsonb;
    return;
  end if;

  select s.* into selected_share
  from public.shares s
  where s.token = p_token
  limit 1;

  if not found or not selected_share.is_public then
    return query select 'missing'::text, null::text, null::timestamptz, null::jsonb;
    return;
  end if;
  if selected_share.expires_at is not null and selected_share.expires_at <= now() then
    return query
      select 'expired'::text, selected_share.resource_type, selected_share.expires_at, null::jsonb;
    return;
  end if;

  if selected_share.resource_type = 'note' then
    select jsonb_build_object('id', n.id, 'title', n.title, 'content', n.content)
      into payload
      from public.notes n
      where n.id = selected_share.resource_id
        and n.user_id = selected_share.owner_id
        and n.deleted_at is null;
  elsif selected_share.resource_type = 'reading_item' then
    select jsonb_build_object(
      'id', r.id, 'title', r.title, 'content', r.content, 'excerpt', r.excerpt,
      'cover_image', r.cover_image, 'url', r.url
    )
      into payload
      from public.reading_items r
      where r.id = selected_share.resource_id
        and r.user_id = selected_share.owner_id
        and r.deleted_at is null;
  end if;

  if payload is null then
    return query select 'missing'::text, null::text, null::timestamptz, null::jsonb;
    return;
  end if;
  return query
    select 'active'::text, selected_share.resource_type, selected_share.expires_at, payload;
end;
$$;

revoke all on function public.get_public_share(text) from public;
grant execute on function public.get_public_share(text) to anon, authenticated;

revoke all on function public.list_trash(text) from public;
revoke all on function public.mutate_trash(text, text, uuid[]) from public;
grant execute on function public.list_trash(text) to authenticated;
grant execute on function public.mutate_trash(text, text, uuid[]) to authenticated;
