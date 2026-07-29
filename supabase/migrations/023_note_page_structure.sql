-- Notion-style note page metadata and hierarchy.
alter table notes
  add column if not exists icon text,
  add column if not exists cover_url text,
  add column if not exists cover_position smallint not null default 50
    check (cover_position between 0 and 100),
  add column if not exists parent_note_id uuid references notes(id) on delete set null;

create index if not exists idx_notes_parent_note_id
  on notes(user_id, parent_note_id, updated_at desc)
  where deleted_at is null;

create or replace function validate_note_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_owner uuid;
  cycle_found boolean;
begin
  if new.parent_note_id is null then
    return new;
  end if;

  if new.parent_note_id = new.id then
    raise exception 'A note cannot be its own parent';
  end if;

  select user_id into parent_owner
  from notes
  where id = new.parent_note_id;

  if parent_owner is null or parent_owner <> new.user_id then
    raise exception 'Parent note must belong to the same user';
  end if;

  with recursive ancestors as (
    select id, parent_note_id
    from notes
    where id = new.parent_note_id
    union all
    select note.id, note.parent_note_id
    from notes note
    join ancestors on note.id = ancestors.parent_note_id
  )
  select exists(select 1 from ancestors where id = new.id)
  into cycle_found;

  if cycle_found then
    raise exception 'Note hierarchy cannot contain a cycle';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_note_parent_trigger on notes;
create trigger validate_note_parent_trigger
  before insert or update of parent_note_id, user_id on notes
  for each row execute function validate_note_parent();
