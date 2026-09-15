-- 080_complete_recurring_wall_clock.sql
-- C05 S3（决策项 R1 默认墙钟语义，用户 2026-09-15 确认）：重复任务按「任务时区的墙钟」推进，
-- 跨夏令时不再漂移——「每天 09:00」在 DST 切换后仍是本地 09:00（033 绝对 interval 推进会漂成 08:00/10:00）。
--
-- 语义：
--   - tasks.timezone（033 已有列，UI 建任务时写入浏览器 IANA 时区）为解释时区——
--     R2 跨时区旅行：任务始终按创建时区的墙钟解释，不随查看设备时区变。
--   - 推进在 naive 墙钟上做日历运算：monthly 自动夹月末（1/31 → 2/28）、yearly 自动夹闰日（2/29 → 2/28）。
--   - 回退合同：timezone 为 null / 非法 / 推进失败 → 保持 033 原绝对 interval 推进（存量任务兼容，
--     不迁移数据、不回滚 033）。
--   - DST gap（当地不存在的墙钟时刻）由 Postgres 以转换前偏移解释（平台既定行为，确定性）。
--
-- 幂等/复制/标签/清单/提醒逻辑不变；本迁移只改推进计算 + 新增纯函数。

-- 墙钟推进纯函数：返回 null 表示「该时区不可用」（调用方回退绝对推进）。
create or replace function public.advance_recurring_wall_clock(
  p_moment timestamptz,
  p_timezone text,
  p_frequency text
) returns timestamptz
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_local timestamp;
  v_advanced timestamp;
begin
  if p_moment is null or p_timezone is null then
    return null;
  end if;
  -- 时区合法性：非法名在 AT TIME ZONE 求值时抛错 → 回退信号
  begin
    v_local := p_moment at time zone p_timezone;
  exception when others then
    return null;
  end;

  v_advanced := case p_frequency
    when 'daily'   then v_local + interval '1 day'
    when 'weekly'  then v_local + interval '7 days'
    when 'monthly' then v_local + interval '1 month'
    when 'yearly'  then v_local + interval '1 year'
    else null
  end;
  if v_advanced is null then
    return null;
  end if;
  return v_advanced at time zone p_timezone;
end; $$;

create or replace function public.complete_recurring_task(p_task_id uuid)
returns uuid  -- 返回新建任务 id（或 null）
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task record;
  v_new_id uuid;
  v_next_start timestamptz;
  v_next_end timestamptz;
  v_freq text;
  v_series uuid;
begin
  select * into v_task from public.tasks where id = p_task_id and auth.uid() = user_id;
  if not found then return null; end if;
  if v_task.recurrence_rule is null then return null; end if;
  if v_task.status <> 'done' then return null; end if;

  v_freq := v_task.recurrence_rule->>'frequency';
  v_series := coalesce(v_task.series_id, v_task.id);

  v_next_start := v_task.schedule_start_at;
  v_next_end := v_task.schedule_end_at;
  if advance_recurring_wall_clock(v_next_start, v_task.timezone, v_freq) is not null then
    -- C05 S3 墙钟语义：本地钟点跨 DST 不漂移；月末/闰日夹取由 naive 日历推进完成
    v_next_start := advance_recurring_wall_clock(v_next_start, v_task.timezone, v_freq);
    if v_next_end is not null then
      v_next_end := advance_recurring_wall_clock(v_next_end, v_task.timezone, v_freq);
    end if;
  else
    -- 回退：033 原绝对 interval 推进（timezone 缺失/非法时保持既有行为）
    case v_freq
      when 'daily'   then v_next_start := v_next_start + interval '1 day';
                        if v_next_end is not null then v_next_end := v_next_end + interval '1 day'; end if;
      when 'weekly'  then v_next_start := v_next_start + interval '7 days';
                        if v_next_end is not null then v_next_end := v_next_end + interval '7 days'; end if;
      when 'monthly' then
        begin
          v_next_start := v_next_start + interval '1 month';
          if v_next_end is not null then v_next_end := v_next_end + interval '1 month'; end if;
        exception when datetime_field_overflow then
          v_next_start := date_trunc('month', v_next_start + interval '1 month') + interval '1 month - 1 day';
        end;
      when 'yearly'  then
        begin
          v_next_start := v_next_start + interval '1 year';
          if v_next_end is not null then v_next_end := v_next_end + interval '1 year'; end if;
        exception when datetime_field_overflow then
          v_next_start := date_trunc('year', v_next_start + interval '1 year') + interval '2 months - 1 day';
        end;
      else return null;
    end case;
  end if;

  -- 幂等：同系列已有 source_id 指向本任务且未删的，不重复建
  perform 1 from public.tasks
  where series_id = v_series and source_id = p_task_id and deleted_at is null;
  if found then return null; end if;

  -- 复制安全字段（白名单）
  insert into public.tasks (
    user_id, title, description, status, priority, category, list_id,
    schedule_start_at, schedule_end_at, all_day, timezone, recurrence_rule,
    series_id, source_id, estimated_minutes, reference_managed, sort_order
  ) values (
    v_task.user_id, v_task.title, v_task.description, 'todo', v_task.priority,
    v_task.category, v_task.list_id, v_next_start, v_next_end, v_task.all_day,
    v_task.timezone, v_task.recurrence_rule, v_series, p_task_id,
    v_task.estimated_minutes, false, 0
  ) returning id into v_new_id;

  -- 复制标签
  insert into public.task_tags (task_id, tag_id)
  select v_new_id, tag_id from public.task_tags where task_id = p_task_id
  on conflict do nothing;

  -- 复制未勾选的清单项
  insert into public.task_checklists (task_id, content, is_completed, sort_order)
  select v_new_id, content, false, sort_order from public.task_checklists
  where task_id = p_task_id and is_completed = false;

  -- 复制未触发提醒（notified_at is null）
  insert into public.task_reminders (user_id, task_id, anchor, offset_minutes)
  select v_task.user_id, v_new_id, anchor, offset_minutes from public.task_reminders
  where task_id = p_task_id and notified_at is null;

  return v_new_id;
end; $$;

grant execute on function public.advance_recurring_wall_clock(timestamptz, text, text) to authenticated;
grant execute on function public.complete_recurring_task(uuid) to authenticated;
