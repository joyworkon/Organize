-- Migrate per-note display preferences (full_width / font_family / small_font) onto notes.
-- Also replaces restore_backup_v2 and restore_backup_v2_with_pages to include the new columns.

alter table notes
  add column if not exists full_width boolean not null default false,
  add column if not exists font_family text not null default 'default'
    check (font_family in ('default', 'serif', 'mono')),
  add column if not exists small_font boolean not null default false;

-- Replace restore_backup_v2: same logic plus full_width / font_family / small_font in notes INSERT
create or replace function public.restore_backup_v2(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user uuid := auth.uid();
  payload_data jsonb;
  table_name text;
  total_rows integer := 0;
  reading_ids uuid[];
  note_ids uuid[];
  tag_ids uuid[];
  task_ids uuid[];
  lesson_ids uuid[];
  thread_ids uuid[];
begin
  if target_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'restore_payload_version' <> '1'
     or jsonb_typeof(p_payload->'data') <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid restore payload';
  end if;
  if octet_length(p_payload::text) > 10485760 then
    raise exception using errcode = '22023', message = 'Restore payload too large';
  end if;

  payload_data := p_payload->'data';
  foreach table_name in array array[
    'reading_items', 'notes', 'tags', 'item_tags', 'note_tags', 'tasks',
    'task_checklists', 'task_tags', 'lessons', 'lesson_tags', 'highlights',
    'favorites', 'note_versions', 'note_comment_threads', 'note_comments',
    'note_suggestions'
  ]
  loop
    if jsonb_typeof(payload_data->table_name) <> 'array' then
      raise exception using errcode = '22023', message = 'Missing restore table';
    end if;
    if jsonb_array_length(payload_data->table_name) > 10000 then
      raise exception using errcode = '22023', message = 'Restore table too large';
    end if;
    total_rows := total_rows + jsonb_array_length(payload_data->table_name);
  end loop;
  if total_rows > 50000 then
    raise exception using errcode = '22023', message = 'Too many restore records';
  end if;

  select coalesce(array_agg((row->>'id')::uuid), '{}'::uuid[])
    into reading_ids from jsonb_array_elements(payload_data->'reading_items') row;
  select coalesce(array_agg((row->>'id')::uuid), '{}'::uuid[])
    into note_ids from jsonb_array_elements(payload_data->'notes') row;
  select coalesce(array_agg((row->>'id')::uuid), '{}'::uuid[])
    into tag_ids from jsonb_array_elements(payload_data->'tags') row;
  select coalesce(array_agg((row->>'id')::uuid), '{}'::uuid[])
    into task_ids from jsonb_array_elements(payload_data->'tasks') row;
  select coalesce(array_agg((row->>'id')::uuid), '{}'::uuid[])
    into lesson_ids from jsonb_array_elements(payload_data->'lessons') row;
  select coalesce(array_agg((row->>'id')::uuid), '{}'::uuid[])
    into thread_ids from jsonb_array_elements(payload_data->'note_comment_threads') row;

  if exists (
    select 1 from jsonb_array_elements(payload_data->'notes') row
    where row->>'reading_item_id' is not null
      and not ((row->>'reading_item_id')::uuid = any(reading_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'item_tags') row
    where not ((row->>'item_id')::uuid = any(reading_ids))
       or not ((row->>'tag_id')::uuid = any(tag_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'note_tags') row
    where not ((row->>'note_id')::uuid = any(note_ids))
       or not ((row->>'tag_id')::uuid = any(tag_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'tasks') row
    where (row->>'reading_item_id' is not null
           and not ((row->>'reading_item_id')::uuid = any(reading_ids)))
       or (row->>'note_id' is not null
           and not ((row->>'note_id')::uuid = any(note_ids)))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'task_checklists') row
    where not ((row->>'task_id')::uuid = any(task_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'task_tags') row
    where not ((row->>'task_id')::uuid = any(task_ids))
       or not ((row->>'tag_id')::uuid = any(tag_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'lessons') row
    where (row->>'task_id' is not null
           and not ((row->>'task_id')::uuid = any(task_ids)))
       or (row->>'reading_item_id' is not null
           and not ((row->>'reading_item_id')::uuid = any(reading_ids)))
       or (row->>'note_id' is not null
           and not ((row->>'note_id')::uuid = any(note_ids)))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'lesson_tags') row
    where not ((row->>'lesson_id')::uuid = any(lesson_ids))
       or not ((row->>'tag_id')::uuid = any(tag_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'highlights') row
    where not ((row->>'reading_item_id')::uuid = any(reading_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'note_versions') row
    where not ((row->>'note_id')::uuid = any(note_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'note_comment_threads') row
    where not ((row->>'note_id')::uuid = any(note_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'note_comments') row
    where not ((row->>'thread_id')::uuid = any(thread_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'note_suggestions') row
    where not ((row->>'note_id')::uuid = any(note_ids))
  ) or exists (
    select 1 from jsonb_array_elements(payload_data->'favorites') row
    where case row->>'target_type'
      when 'reading' then not ((row->>'target_id')::uuid = any(reading_ids))
      when 'note' then not ((row->>'target_id')::uuid = any(note_ids))
      when 'task' then not ((row->>'target_id')::uuid = any(task_ids))
      else true
    end
  ) then
    raise exception using errcode = '23503', message = 'Restore contains an unknown reference';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_user::text));
  if exists (select 1 from public.reading_items where user_id = target_user)
     or exists (select 1 from public.notes where user_id = target_user)
     or exists (select 1 from public.tags where user_id = target_user)
     or exists (select 1 from public.tasks where user_id = target_user)
     or exists (select 1 from public.lessons where user_id = target_user)
     or exists (select 1 from public.highlights where user_id = target_user)
     or exists (select 1 from public.favorites where user_id = target_user) then
    return jsonb_build_object('status', 'not_empty');
  end if;

  perform set_config('organize.restore_mode', 'on', true);

  insert into public.reading_items (
    id, user_id, url, title, content, excerpt, cover_image, reading_status,
    reading_progress, is_pinned, started_reading_at, completed_reading_at,
    created_at, updated_at
  )
  select
    row.id, target_user, row.url, row.title, row.content, row.excerpt,
    row.cover_image, row.reading_status, row.reading_progress, row.is_pinned,
    row.started_reading_at, row.completed_reading_at, row.created_at, row.updated_at
  from jsonb_to_recordset(payload_data->'reading_items') as row(
    id uuid, url text, title text, content text, excerpt text, cover_image text,
    reading_status text, reading_progress double precision, is_pinned boolean,
    started_reading_at timestamptz, completed_reading_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  );

  insert into public.notes (
    id, user_id, title, content, reading_item_id, is_pinned,
    full_width, font_family, small_font,
    created_at, updated_at
  )
  select
    row.id, target_user, row.title, row.content, row.reading_item_id,
    row.is_pinned,
    coalesce(row.full_width, false),
    case when row.font_family in ('default', 'serif', 'mono') then row.font_family else 'default' end,
    coalesce(row.small_font, false),
    row.created_at, row.updated_at
  from jsonb_to_recordset(payload_data->'notes') as row(
    id uuid, title text, content jsonb, reading_item_id uuid, is_pinned boolean,
    full_width boolean, font_family text, small_font boolean,
    created_at timestamptz, updated_at timestamptz
  );

  insert into public.tags (id, user_id, name, color, created_at)
  select row.id, target_user, row.name, row.color, row.created_at
  from jsonb_to_recordset(payload_data->'tags') as row(
    id uuid, name text, color text, created_at timestamptz
  );

  insert into public.item_tags (item_id, tag_id)
  select row.item_id, row.tag_id
  from jsonb_to_recordset(payload_data->'item_tags') as row(item_id uuid, tag_id uuid);

  insert into public.note_tags (note_id, tag_id)
  select row.note_id, row.tag_id
  from jsonb_to_recordset(payload_data->'note_tags') as row(note_id uuid, tag_id uuid);

  insert into public.tasks (
    id, user_id, title, description, status, priority, category, due_date,
    estimated_minutes, actual_minutes, reading_item_id, note_id, is_pinned,
    sort_order, completed_at, created_at, updated_at
  )
  select
    row.id, target_user, row.title, row.description, row.status, row.priority,
    row.category, row.due_date, row.estimated_minutes, row.actual_minutes,
    row.reading_item_id, row.note_id, row.is_pinned, row.sort_order,
    row.completed_at, row.created_at, row.updated_at
  from jsonb_to_recordset(payload_data->'tasks') as row(
    id uuid, title text, description text, status text, priority text,
    category text, due_date timestamptz, estimated_minutes integer,
    actual_minutes integer, reading_item_id uuid, note_id uuid,
    is_pinned boolean, sort_order integer, completed_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  );

  insert into public.task_checklists (
    id, task_id, content, is_completed, sort_order, created_at, updated_at
  )
  select
    row.id, row.task_id, row.content, row.is_completed, row.sort_order,
    row.created_at, row.updated_at
  from jsonb_to_recordset(payload_data->'task_checklists') as row(
    id uuid, task_id uuid, content text, is_completed boolean, sort_order integer,
    created_at timestamptz, updated_at timestamptz
  );

  insert into public.task_tags (task_id, tag_id)
  select row.task_id, row.tag_id
  from jsonb_to_recordset(payload_data->'task_tags') as row(task_id uuid, tag_id uuid);

  insert into public.lessons (
    id, user_id, title, content, lesson_type, task_id, reading_item_id, note_id,
    created_at, updated_at
  )
  select
    row.id, target_user, row.title, row.content, row.lesson_type, row.task_id,
    row.reading_item_id, row.note_id, row.created_at, row.updated_at
  from jsonb_to_recordset(payload_data->'lessons') as row(
    id uuid, title text, content jsonb, lesson_type text, task_id uuid,
    reading_item_id uuid, note_id uuid, created_at timestamptz, updated_at timestamptz
  );

  insert into public.lesson_tags (lesson_id, tag_id)
  select row.lesson_id, row.tag_id
  from jsonb_to_recordset(payload_data->'lesson_tags') as row(lesson_id uuid, tag_id uuid);

  insert into public.highlights (
    id, user_id, reading_item_id, content, note, color, anchor_path,
    anchor_offset, created_at, updated_at
  )
  select
    row.id, target_user, row.reading_item_id, row.content, row.note, row.color,
    row.anchor_path, row.anchor_offset, row.created_at, row.updated_at
  from jsonb_to_recordset(payload_data->'highlights') as row(
    id uuid, reading_item_id uuid, content text, note text, color text,
    anchor_path text, anchor_offset integer, created_at timestamptz,
    updated_at timestamptz
  );

  insert into public.favorites (id, user_id, target_type, target_id, note, created_at)
  select row.id, target_user, row.target_type, row.target_id, row.note, row.created_at
  from jsonb_to_recordset(payload_data->'favorites') as row(
    id uuid, target_type text, target_id uuid, note text, created_at timestamptz
  );

  insert into public.note_versions (id, note_id, content, title, message, created_at)
  select row.id, row.note_id, row.content, row.title, row.message, row.created_at
  from jsonb_to_recordset(payload_data->'note_versions') as row(
    id uuid, note_id uuid, content jsonb, title text, message text, created_at timestamptz
  );

  insert into public.note_comment_threads (
    id, note_id, block_id, user_id, resolved_at, created_at, updated_at
  )
  select
    row.id, row.note_id, row.block_id, target_user, row.resolved_at,
    row.created_at, row.updated_at
  from jsonb_to_recordset(payload_data->'note_comment_threads') as row(
    id uuid, note_id uuid, block_id text, resolved_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  );

  insert into public.note_comments (
    id, thread_id, user_id, body, created_at, updated_at
  )
  select
    row.id, row.thread_id, target_user, row.body, row.created_at, row.updated_at
  from jsonb_to_recordset(payload_data->'note_comments') as row(
    id uuid, thread_id uuid, body text, created_at timestamptz, updated_at timestamptz
  );

  insert into public.note_suggestions (
    id, note_id, block_id, user_id, original_block, proposed_block, status,
    created_at, updated_at
  )
  select
    row.id, row.note_id, row.block_id, target_user, row.original_block,
    row.proposed_block, row.status, row.created_at, row.updated_at
  from jsonb_to_recordset(payload_data->'note_suggestions') as row(
    id uuid, note_id uuid, block_id text, original_block jsonb,
    proposed_block jsonb, status text, created_at timestamptz, updated_at timestamptz
  );

  perform set_config('organize.restore_mode', 'off', true);

  return jsonb_build_object(
    'status', 'restored',
    'counts', jsonb_build_object(
      'reading_items', jsonb_array_length(payload_data->'reading_items'),
      'notes', jsonb_array_length(payload_data->'notes'),
      'tags', jsonb_array_length(payload_data->'tags'),
      'tasks', jsonb_array_length(payload_data->'tasks'),
      'lessons', jsonb_array_length(payload_data->'lessons')
    )
  );
end;
$$;

revoke all on function public.restore_backup_v2(jsonb) from public;
grant execute on function public.restore_backup_v2(jsonb) to authenticated;

-- Replace restore_backup_v2_with_pages to apply page settings in the same transaction
create or replace function public.restore_backup_v2_with_pages(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user uuid := auth.uid();
  restore_result jsonb;
begin
  if target_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  restore_result := public.restore_backup_v2(p_payload);
  if restore_result->>'status' <> 'restored' then
    return restore_result;
  end if;

  update public.notes note
  set
    icon = page.icon,
    cover_url = page.cover_url,
    cover_position = coalesce(page.cover_position, 50),
    parent_note_id = page.parent_note_id,
    full_width = coalesce(page.full_width, false),
    font_family = case when page.font_family in ('default','serif','mono') then page.font_family else 'default' end,
    small_font = coalesce(page.small_font, false)
  from jsonb_to_recordset(p_payload->'data'->'notes') as page(
    id uuid,
    icon text,
    cover_url text,
    cover_position smallint,
    parent_note_id uuid,
    full_width boolean,
    font_family text,
    small_font boolean
  )
  where note.id = page.id
    and note.user_id = target_user;

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_with_pages(jsonb) from public;
grant execute on function public.restore_backup_v2_with_pages(jsonb) to authenticated;
