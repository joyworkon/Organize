-- Track first real reading transitions without inventing timestamps for legacy rows.

alter table public.reading_items
  add column if not exists started_reading_at timestamptz,
  add column if not exists completed_reading_at timestamptz;

create index if not exists idx_reading_items_started_at
  on public.reading_items(user_id, started_reading_at)
  where started_reading_at is not null;

create index if not exists idx_reading_items_completed_at
  on public.reading_items(user_id, completed_reading_at)
  where completed_reading_at is not null;

create or replace function public.set_reading_lifecycle_timestamps()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.started_reading_at := case
      when new.reading_status in ('reading', 'read') then now()
      else null
    end;
    new.completed_reading_at := case
      when new.reading_status = 'read' then now()
      else null
    end;
    return new;
  end if;

  -- Lifecycle timestamps are server-owned and immutable once written.
  new.started_reading_at := old.started_reading_at;
  new.completed_reading_at := old.completed_reading_at;

  if old.reading_status is distinct from new.reading_status then
    if new.started_reading_at is null
       and new.reading_status in ('reading', 'read') then
      new.started_reading_at := now();
    end if;

    if new.completed_reading_at is null
       and new.reading_status = 'read' then
      new.completed_reading_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists set_reading_lifecycle_timestamps on public.reading_items;
create trigger set_reading_lifecycle_timestamps
  before insert or update on public.reading_items
  for each row execute function public.set_reading_lifecycle_timestamps();
