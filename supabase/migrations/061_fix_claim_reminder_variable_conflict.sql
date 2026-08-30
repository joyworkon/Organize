-- 修复 claim_due_task_reminder_deliveries 的 PL/pgSQL 变量歧义（P2-03 云库验证发现）。
--
-- 039 的函数用 RETURNS TABLE 声明了 OUT 参数（其中包含 subscription_id），
-- 函数体内 `on conflict (reminder_id, subscription_id, scheduled_for)` 的
-- 冲突目标列名与 OUT 参数同名，默认 variable_conflict=error 下运行即报
-- 42702 "column reference subscription_id is ambiguous"，导致 cron 提醒领取 500。
-- 本地/CI 一直未带数据真实执行过该函数体，pgTAP 056 只测了权限，故未暴露。
--
-- 修法：整体替换函数体并声明 #variable_conflict use_column——
-- 函数体内所有裸名引用均意在指表列，不存在需要引用 OUT 参数的语句。
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
#variable_conflict use_column
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
