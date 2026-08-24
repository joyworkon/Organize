-- 阅读高亮可原子转换为笔记或任务，并保留稳定来源引用。
alter table public.highlights
  add column if not exists note_id uuid,
  add column if not exists task_id uuid;

create index if not exists idx_highlights_note_id
  on public.highlights(user_id, note_id)
  where note_id is not null;
create index if not exists idx_highlights_task_id
  on public.highlights(user_id, task_id)
  where task_id is not null;

create or replace function public.validate_highlight_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.note_id is not null
    and not exists (
      select 1
      from public.notes note
      where note.id = new.note_id
        and note.user_id = new.user_id
        and note.deleted_at is null
    )
  then
    raise exception using
      errcode = '23503',
      message = '高亮关联笔记不存在、已删除或不属于当前用户';
  end if;

  if new.task_id is not null
    and not exists (
      select 1
      from public.tasks task
      where task.id = new.task_id
        and task.user_id = new.user_id
        and task.deleted_at is null
    )
  then
    raise exception using
      errcode = '23503',
      message = '高亮关联任务不存在、已删除或不属于当前用户';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_highlight_reference_trigger on public.highlights;
create trigger validate_highlight_reference_trigger
  before insert or update of note_id, task_id, user_id
  on public.highlights
  for each row execute function public.validate_highlight_reference();

create or replace function public.convert_highlight_reference(
  p_highlight_id uuid,
  p_target_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user uuid := auth.uid();
  source_highlight public.highlights%rowtype;
  source_reading public.reading_items%rowtype;
  target_id uuid;
  note_content jsonb;
begin
  if target_user is null then
    raise exception using errcode = '42501', message = '未授权';
  end if;
  if p_target_type not in ('note', 'task') then
    raise exception using errcode = '22023', message = '目标类型必须是 note 或 task';
  end if;

  select *
  into source_highlight
  from public.highlights
  where id = p_highlight_id and user_id = target_user
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '高亮不存在或无权访问';
  end if;

  select *
  into source_reading
  from public.reading_items
  where id = source_highlight.reading_item_id
    and user_id = target_user
    and deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = '来源阅读不存在或已删除';
  end if;

  if p_target_type = 'note' then
    if source_highlight.note_id is not null then
      return jsonb_build_object(
        'status', 'existing',
        'target_type', 'note',
        'target_id', source_highlight.note_id
      );
    end if;

    note_content := jsonb_build_object(
      'type', 'doc',
      'content', jsonb_build_array(
        jsonb_build_object(
          'type', 'heading',
          'attrs', jsonb_build_object('level', 2),
          'content', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', coalesce(source_reading.title, '阅读高亮'))
          )
        ),
        jsonb_build_object(
          'type', 'blockquote',
          'content', jsonb_build_array(
            jsonb_build_object(
              'type', 'paragraph',
              'content', jsonb_build_array(
                jsonb_build_object('type', 'text', 'text', source_highlight.content)
              )
            )
          )
        ),
        jsonb_build_object(
          'type', 'paragraph',
          'content', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', '来源：'),
            jsonb_build_object(
              'type', 'text',
              'text', source_reading.url,
              'marks', jsonb_build_array(
                jsonb_build_object(
                  'type', 'link',
                  'attrs', jsonb_build_object('href', source_reading.url, 'target', '_blank')
                )
              )
            )
          )
        )
      )
    );

    insert into public.notes(user_id, title, content, reading_item_id)
    values (
      target_user,
      left(coalesce(source_reading.title, source_highlight.content, '阅读高亮'), 120),
      note_content,
      source_reading.id
    )
    returning id into target_id;

    update public.highlights set note_id = target_id where id = source_highlight.id;
    if source_highlight.task_id is not null then
      update public.tasks
      set note_id = target_id
      where id = source_highlight.task_id
        and user_id = target_user
        and deleted_at is null
        and note_id is null;
    end if;
  else
    if source_highlight.task_id is not null then
      return jsonb_build_object(
        'status', 'existing',
        'target_type', 'task',
        'target_id', source_highlight.task_id
      );
    end if;

    insert into public.tasks(
      user_id, title, description, status, priority, category,
      reading_item_id, note_id
    )
    values (
      target_user,
      left(source_highlight.content, 120),
      source_highlight.content || E'\n\n来源：《' || coalesce(source_reading.title, '无标题文章') || '》',
      'todo',
      'medium',
      'study',
      source_reading.id,
      source_highlight.note_id
    )
    returning id into target_id;

    update public.highlights set task_id = target_id where id = source_highlight.id;
  end if;

  return jsonb_build_object(
    'status', 'created',
    'target_type', p_target_type,
    'target_id', target_id
  );
end;
$$;

revoke all on function public.convert_highlight_reference(uuid, text) from public;
grant execute on function public.convert_highlight_reference(uuid, text) to authenticated;

create or replace function public.get_highlight_reference_states(
  p_reading_item_id uuid default null,
  p_note_id uuid default null,
  p_task_id uuid default null
)
returns table (
  highlight_id uuid,
  reading_item_id uuid,
  reading_title text,
  reading_state text,
  note_id uuid,
  note_title text,
  note_state text,
  task_id uuid,
  task_title text,
  task_state text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    highlight.id,
    highlight.reading_item_id,
    reading.title,
    case
      when reading.id is null then 'missing'
      when reading.deleted_at is not null then 'deleted'
      else 'active'
    end,
    highlight.note_id,
    note.title,
    case
      when highlight.note_id is null then null
      when note.id is null then 'missing'
      when note.deleted_at is not null then 'deleted'
      else 'active'
    end,
    highlight.task_id,
    task.title,
    case
      when highlight.task_id is null then null
      when task.id is null then 'missing'
      when task.deleted_at is not null then 'deleted'
      else 'active'
    end
  from public.highlights highlight
  left join public.reading_items reading
    on reading.id = highlight.reading_item_id and reading.user_id = auth.uid()
  left join public.notes note
    on note.id = highlight.note_id and note.user_id = auth.uid()
  left join public.tasks task
    on task.id = highlight.task_id and task.user_id = auth.uid()
  where highlight.user_id = auth.uid()
    and (p_reading_item_id is null or highlight.reading_item_id = p_reading_item_id)
    and (p_note_id is null or highlight.note_id = p_note_id)
    and (p_task_id is null or highlight.task_id = p_task_id)
  order by highlight.created_at desc;
$$;

revoke all on function public.get_highlight_reference_states(uuid, uuid, uuid) from public;
grant execute on function public.get_highlight_reference_states(uuid, uuid, uuid) to authenticated;

create or replace function public.get_linked_content_states(
  p_reading_item_id uuid default null,
  p_note_id uuid default null,
  p_task_id uuid default null
)
returns table (
  reading_item_id uuid,
  reading_title text,
  reading_state text,
  note_id uuid,
  note_title text,
  note_state text,
  task_id uuid,
  task_title text,
  task_state text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    p_reading_item_id,
    reading.title,
    case
      when p_reading_item_id is null then null
      when reading.id is null then 'missing'
      when reading.deleted_at is not null then 'deleted'
      else 'active'
    end,
    p_note_id,
    note.title,
    case
      when p_note_id is null then null
      when note.id is null then 'missing'
      when note.deleted_at is not null then 'deleted'
      else 'active'
    end,
    p_task_id,
    task.title,
    case
      when p_task_id is null then null
      when task.id is null then 'missing'
      when task.deleted_at is not null then 'deleted'
      else 'active'
    end
  from (select 1) seed
  left join public.reading_items reading
    on reading.id = p_reading_item_id and reading.user_id = auth.uid()
  left join public.notes note
    on note.id = p_note_id and note.user_id = auth.uid()
  left join public.tasks task
    on task.id = p_task_id and task.user_id = auth.uid();
$$;

revoke all on function public.get_linked_content_states(uuid, uuid, uuid) from public;
grant execute on function public.get_linked_content_states(uuid, uuid, uuid) to authenticated;

create or replace function public.restore_backup_v2_with_highlight_references(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  restore_result jsonb;
  target_user uuid := auth.uid();
begin
  restore_result := public.restore_backup_v2_with_dependencies(p_payload);
  if (restore_result->>'status') <> 'restored' then
    return restore_result;
  end if;

  update public.highlights highlight
  set
    note_id = nullif(row.value->>'note_id', '')::uuid,
    task_id = nullif(row.value->>'task_id', '')::uuid
  from jsonb_array_elements(coalesce(p_payload->'data'->'highlights', '[]'::jsonb)) row
  where highlight.id = (row.value->>'id')::uuid
    and highlight.user_id = target_user;

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_with_highlight_references(jsonb) from public;
grant execute on function public.restore_backup_v2_with_highlight_references(jsonb) to authenticated;
