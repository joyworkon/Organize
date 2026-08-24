-- 可靠任务提醒：Push 订阅、幂等投递队列和并发安全领取。
alter table public.task_reminders
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_web_push_subscriptions_user
  on public.web_push_subscriptions(user_id)
  where disabled_at is null;

alter table public.web_push_subscriptions enable row level security;
drop policy if exists "web_push_subscriptions sel" on public.web_push_subscriptions;
drop policy if exists "web_push_subscriptions ins" on public.web_push_subscriptions;
drop policy if exists "web_push_subscriptions upd" on public.web_push_subscriptions;
drop policy if exists "web_push_subscriptions del" on public.web_push_subscriptions;
create policy "web_push_subscriptions sel"
  on public.web_push_subscriptions for select using (auth.uid() = user_id);
create policy "web_push_subscriptions ins"
  on public.web_push_subscriptions for insert with check (auth.uid() = user_id);
create policy "web_push_subscriptions upd"
  on public.web_push_subscriptions for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "web_push_subscriptions del"
  on public.web_push_subscriptions for delete using (auth.uid() = user_id);
grant select, insert, update, delete on public.web_push_subscriptions to authenticated;

create table if not exists public.task_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid references public.task_reminders(id) on delete cascade not null,
  subscription_id uuid references public.web_push_subscriptions(id) on delete cascade not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reminder_id, subscription_id, scheduled_for)
);

create index if not exists idx_task_reminder_deliveries_pending
  on public.task_reminder_deliveries(status, next_attempt_at, scheduled_for);

alter table public.task_reminder_deliveries enable row level security;
drop policy if exists "task_reminder_deliveries sel" on public.task_reminder_deliveries;
create policy "task_reminder_deliveries sel"
  on public.task_reminder_deliveries for select
  using (
    exists (
      select 1 from public.task_reminders reminder
      where reminder.id = reminder_id and reminder.user_id = auth.uid()
    )
  );
grant select on public.task_reminder_deliveries to authenticated;

create or replace function public.reset_task_reminder_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.notified_at := null;
  new.updated_at := now();
  delete from public.task_reminder_deliveries
  where reminder_id = new.id and status <> 'sent';
  return new;
end;
$$;

drop trigger if exists trg_reset_task_reminder_delivery on public.task_reminders;
create trigger trg_reset_task_reminder_delivery
  before update of anchor, offset_minutes on public.task_reminders
  for each row execute function public.reset_task_reminder_delivery();

create or replace function public.reset_task_reminders_after_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.schedule_start_at is distinct from old.schedule_start_at
    or new.schedule_end_at is distinct from old.schedule_end_at
    or new.status is distinct from old.status
    or new.deleted_at is distinct from old.deleted_at then
    update public.task_reminders
    set notified_at = null, updated_at = now()
    where task_id = new.id;
    delete from public.task_reminder_deliveries delivery
    using public.task_reminders reminder
    where delivery.reminder_id = reminder.id
      and reminder.task_id = new.id
      and delivery.status <> 'sent';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_task_reminders_after_schedule_change on public.tasks;
create trigger trg_reset_task_reminders_after_schedule_change
  after update of schedule_start_at, schedule_end_at, status, deleted_at on public.tasks
  for each row execute function public.reset_task_reminders_after_schedule_change();

create or replace function public.claim_due_task_reminder_deliveries(
  p_limit integer default 100
) returns table (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  task_id uuid,
  task_title text,
  anchor text,
  scheduled_for timestamptz,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.task_reminder_deliveries (
    reminder_id,
    subscription_id,
    scheduled_for
  )
  select due.reminder_id, subscription.id, due.scheduled_for
  from (
    select
      reminder.id as reminder_id,
      reminder.user_id,
      (
        case reminder.anchor
          when 'end' then coalesce(task.schedule_end_at, task.schedule_start_at)
          else task.schedule_start_at
        end
        + make_interval(mins => reminder.offset_minutes)
      ) as scheduled_for
    from public.task_reminders reminder
    join public.tasks task on task.id = reminder.task_id
    where reminder.notified_at is null
      and task.deleted_at is null
      and task.status not in ('done', 'cancelled')
      and task.schedule_start_at is not null
  ) due
  join public.web_push_subscriptions subscription
    on subscription.user_id = due.user_id
   and subscription.disabled_at is null
  where due.scheduled_for <= now()
    and due.scheduled_for >= now() - interval '24 hours'
  on conflict (reminder_id, subscription_id, scheduled_for) do nothing;

  update public.task_reminders reminder
  set notified_at = now(), updated_at = now()
  where reminder.notified_at is null
    and exists (
      select 1 from public.task_reminder_deliveries delivery
      where delivery.reminder_id = reminder.id
    );

  return query
	  with candidates as (
	    select delivery.id
	    from public.task_reminder_deliveries delivery
	    join public.web_push_subscriptions active_subscription
	      on active_subscription.id = delivery.subscription_id
	     and active_subscription.disabled_at is null
	    where (
      delivery.status in ('pending', 'failed')
      and coalesce(delivery.next_attempt_at, delivery.scheduled_for) <= now()
      and delivery.attempt_count < 6
    ) or (
      delivery.status = 'sending'
      and delivery.updated_at < now() - interval '5 minutes'
      and delivery.attempt_count < 6
    )
    order by delivery.scheduled_for
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  ),
  claimed as (
    update public.task_reminder_deliveries delivery
    set status = 'sending',
        attempt_count = delivery.attempt_count + 1,
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    subscription.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_secret,
    task.id,
    task.title,
    reminder.anchor,
    claimed.scheduled_for,
    claimed.attempt_count
  from claimed
  join public.task_reminders reminder on reminder.id = claimed.reminder_id
  join public.tasks task on task.id = reminder.task_id
  join public.web_push_subscriptions subscription
    on subscription.id = claimed.subscription_id
  where subscription.disabled_at is null;
end;
$$;

revoke all on function public.claim_due_task_reminder_deliveries(integer) from public;
grant execute on function public.claim_due_task_reminder_deliveries(integer) to service_role;
