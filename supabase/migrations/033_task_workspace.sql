-- 033_task_workspace.sql
-- 任务工作台与月历：task_lists、task_reminders、task_attachments、task_activities、task_templates
-- + tasks 扩列（list/schedule/all_day/timezone/recurrence/series）+ 双向 trigger + RLS + 备份 v3 扩展
-- 依据任务书「任务1：数据与服务不变量」

-- ============================================================
-- 1. task_lists：用户自建清单
-- ============================================================
create table if not exists public.task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  icon text,                         -- emoji
  color text,                        -- hex 或预设名
  sort_order integer not null default 0,
  is_default boolean not null default false,  -- work/study/life 迁入的默认清单
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_task_lists_user on public.task_lists(user_id, sort_order);

-- ============================================================
-- 2. tasks 扩列
-- ============================================================
alter table public.tasks add column if not exists list_id uuid;
alter table public.tasks add column if not exists schedule_start_at timestamptz;
alter table public.tasks add column if not exists schedule_end_at timestamptz;
alter table public.tasks add column if not exists all_day boolean;
alter table public.tasks add column if not exists timezone text;       -- IANA，如 Asia/Shanghai
alter table public.tasks add column if not exists recurrence_rule jsonb;  -- {frequency:'daily|weekly|monthly|yearly', interval:1}
alter table public.tasks add column if not exists series_id uuid;      -- 重复任务同系列
alter table public.tasks add column if not exists source_id uuid;      -- 来源（复制/模板/重复的原始任务）

-- list_id 外键（先加列再建约束，避免历史数据阻断）
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'tasks_list_id_fkey' and table_name = 'tasks'
  ) then
    alter table public.tasks add constraint tasks_list_id_fkey
      foreign key (list_id) references public.task_lists(id) on delete set null;
  end if;
end $$;

-- recurrence_rule 结构约束：frequency 四选一、interval 固定 1
alter table public.tasks add constraint tasks_recurrence_rule_check check (
  recurrence_rule is null or (
    jsonb_typeof(recurrence_rule) = 'object' and
    recurrence_rule->>'frequency' in ('daily','weekly','monthly','yearly') and
    coalesce((recurrence_rule->>'interval')::int, 1) = 1
  )
);
-- schedule_end_at 不得早于 schedule_start_at（都非空时）
alter table public.tasks add constraint tasks_schedule_order_check check (
  schedule_start_at is null or schedule_end_at is null or schedule_end_at >= schedule_start_at
);

create index if not exists idx_tasks_list on public.tasks(user_id, list_id);
create index if not exists idx_tasks_schedule_start on public.tasks(user_id, schedule_start_at);
create index if not exists idx_tasks_series on public.tasks(series_id);

-- ============================================================
-- 3. task_reminders：提醒（每任务 ≤3）
-- ============================================================
create table if not exists public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete cascade not null,
  anchor text not null check (anchor in ('start','end')),  -- 锚点：schedule_start_at/end_at
  offset_minutes integer not null,    -- 负=提前，正=延后
  notified_at timestamptz,            -- 已触发提醒的时间（幂等：只触发未通知的）
  created_at timestamptz not null default now()
);
create index if not exists idx_task_reminders_task on public.task_reminders(task_id);
create index if not exists idx_task_reminders_pending on public.task_reminders(notified_at);
-- 每任务 ≤3 提醒
create or replace function public.enforce_max_reminders() returns trigger as $$
declare cnt int;
begin
  select count(*) into cnt from public.task_reminders where task_id = new.task_id;
  if cnt >= 3 and tg_op = 'INSERT' then
    raise exception '每任务最多 3 条提醒' using errcode = '23514';
  end if;
  return new;
end; $$ language plpgsql security definer set search_path = pg_catalog, public;
drop trigger if exists trg_enforce_max_reminders on public.task_reminders;
create trigger trg_enforce_max_reminders before insert on public.task_reminders
  for each row execute function public.enforce_max_reminders();

-- ============================================================
-- 4. task_attachments：附件元数据（二进制走 storage bucket）
-- ============================================================
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete cascade not null,
  name text not null,
  bucket text not null default 'attachments',
  path text not null,                 -- storage 对象路径
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_attachments_task on public.task_attachments(task_id);

-- ============================================================
-- 5. task_activities：动态（DB 自动产生）
-- ============================================================
create table if not exists public.task_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete cascade not null,
  action text not null,               -- created/updated/status_changed/checklist_added/tag_added/attachment_added/...
  detail jsonb,                       -- 变更详情
  created_at timestamptz not null default now()
);
create index if not exists idx_task_activities_task on public.task_activities(task_id, created_at desc);
create index if not exists idx_task_activities_user on public.task_activities(user_id, created_at desc);

-- ============================================================
-- 6. task_templates：保存为模板
-- ============================================================
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  template jsonb not null,            -- 任务快照（白名单字段）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_task_templates_user on public.task_templates(user_id, created_at desc);

-- ============================================================
-- 7. 双向 BEFORE trigger：due_date ↔ schedule_start_at
-- ============================================================
-- 旧 due_date-only 写入 → 同步 schedule_start_at
-- 新 schedule 写入 → due_date = coalesce(end, start)
create or replace function public.sync_task_due_schedule() returns trigger as $$
begin
  -- 旧路径：只写了 due_date（schedule_start_at 没变/为空）→ 把 start 设为 due_date
  if new.due_date is not null and new.schedule_start_at is null then
    new.schedule_start_at := new.due_date;
  end if;
  -- 新路径：写了 schedule_start_at → due_date = coalesce(end, start)
  if new.schedule_start_at is not null then
    new.due_date := coalesce(new.schedule_end_at, new.schedule_start_at);
  end if;
  return new;
end; $$ language plpgsql security definer set search_path = pg_catalog, public;
drop trigger if exists trg_sync_task_due_schedule on public.tasks;
create trigger trg_sync_task_due_schedule before insert or update on public.tasks
  for each row execute function public.sync_task_due_schedule();

-- ============================================================
-- 8. 旧数据回填：schedule_start_at = due_date（保持 category，旧任务不猜 all_day/timezone）
-- ============================================================
update public.tasks set schedule_start_at = due_date
where due_date is not null and schedule_start_at is null;

-- ============================================================
-- 9. work/study/life 自动迁入默认清单
-- ============================================================
-- 为每个有任务的 user + category 建 is_default 清单，把 tasks.list_id 指过去
insert into public.task_lists (user_id, name, icon, color, sort_order, is_default)
select distinct t.user_id,
  case t.category
    when 'work' then '工作' when 'study' then '学习' when 'life' then '生活'
    else '其他' end,
  case t.category when 'work' then '💼' when 'study' then '📚' when 'life' then '🏠' else '📋' end,
  case t.category when 'work' then '#3b82f6' when 'study' then '#8b5cf6' when 'life' then '#10b981' else '#6b7280' end,
  case t.category when 'work' then 0 when 'study' then 1 when 'life' then 2 else 3 end,
  true
from public.tasks t
where t.deleted_at is null
  and not exists (
    select 1 from public.task_lists tl
    where tl.user_id = t.user_id and tl.name =
      case t.category when 'work' then '工作' when 'study' then '学习' when 'life' then '生活' else '其他' end
  )
on conflict do nothing;

-- 回填 list_id（匹配同名默认清单）
update public.tasks t set list_id = tl.id
from public.task_lists tl
where tl.user_id = t.user_id and tl.is_default = true
  and tl.name = case t.category when 'work' then '工作' when 'study' then '学习' when 'life' then '生活' else '其他' end
  and t.list_id is null;

-- ============================================================
-- 10. RLS（新表全部按 user_id 隔离）
-- ============================================================
-- task_lists
alter table public.task_lists enable row level security;
drop policy if exists "task_lists sel" on public.task_lists;
drop policy if exists "task_lists ins" on public.task_lists;
drop policy if exists "task_lists upd" on public.task_lists;
drop policy if exists "task_lists del" on public.task_lists;
create policy "task_lists sel" on public.task_lists for select using (auth.uid() = user_id);
create policy "task_lists ins" on public.task_lists for insert with check (auth.uid() = user_id);
create policy "task_lists upd" on public.task_lists for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "task_lists del" on public.task_lists for delete using (auth.uid() = user_id);

-- task_reminders
alter table public.task_reminders enable row level security;
drop policy if exists "task_reminders sel" on public.task_reminders;
drop policy if exists "task_reminders ins" on public.task_reminders;
drop policy if exists "task_reminders upd" on public.task_reminders;
drop policy if exists "task_reminders del" on public.task_reminders;
create policy "task_reminders sel" on public.task_reminders for select using (auth.uid() = user_id);
create policy "task_reminders ins" on public.task_reminders for insert with check (auth.uid() = user_id);
create policy "task_reminders upd" on public.task_reminders for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "task_reminders del" on public.task_reminders for delete using (auth.uid() = user_id);

-- task_attachments
alter table public.task_attachments enable row level security;
drop policy if exists "task_attachments sel" on public.task_attachments;
drop policy if exists "task_attachments ins" on public.task_attachments;
drop policy if exists "task_attachments upd" on public.task_attachments;
drop policy if exists "task_attachments del" on public.task_attachments;
create policy "task_attachments sel" on public.task_attachments for select using (auth.uid() = user_id);
create policy "task_attachments ins" on public.task_attachments for insert with check (auth.uid() = user_id);
create policy "task_attachments upd" on public.task_attachments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "task_attachments del" on public.task_attachments for delete using (auth.uid() = user_id);

-- task_activities
alter table public.task_activities enable row level security;
drop policy if exists "task_activities sel" on public.task_activities;
create policy "task_activities sel" on public.task_activities for select using (auth.uid() = user_id);

-- task_templates
alter table public.task_templates enable row level security;
drop policy if exists "task_templates sel" on public.task_templates;
drop policy if exists "task_templates ins" on public.task_templates;
drop policy if exists "task_templates upd" on public.task_templates;
drop policy if exists "task_templates del" on public.task_templates;
create policy "task_templates sel" on public.task_templates for select using (auth.uid() = user_id);
create policy "task_templates ins" on public.task_templates for insert with check (auth.uid() = user_id);
create policy "task_templates upd" on public.task_templates for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "task_templates del" on public.task_templates for delete using (auth.uid() = user_id);

-- ============================================================
-- 11. GRANT（沿用 003 模式）
-- ============================================================
grant select, insert, update, delete on public.task_lists to authenticated;
grant select on public.task_lists to anon;
grant select, insert, update, delete on public.task_reminders to authenticated;
grant select on public.task_reminders to anon;
grant select, insert, update, delete on public.task_attachments to authenticated;
grant select on public.task_attachments to anon;
grant select, insert on public.task_activities to authenticated;
grant select on public.task_activities to anon;
grant select, insert, update, delete on public.task_templates to authenticated;
grant select on public.task_templates to anon;

-- ============================================================
-- 12. DB 自动产活动：tasks insert/update → task_activities
-- ============================================================
create or replace function public.log_task_activity() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_activities (user_id, task_id, action, detail)
    values (new.user_id, new.id, 'created', jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' then
    -- 只记状态变化（避免每次 update 都记）
    if old.status is distinct from new.status then
      insert into public.task_activities (user_id, task_id, action, detail)
      values (new.user_id, new.id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end; $$ language plpgsql security definer set search_path = pg_catalog, public;
drop trigger if exists trg_log_task_activity on public.tasks;
create trigger trg_log_task_activity after insert or update on public.tasks
  for each row execute function public.log_task_activity();

-- ============================================================
-- 13. 重复任务幂等 RPC：complete_recurring_task(p_task_id)
-- 每次 done 才生成下一条；series_id 标识系列；source_id 指向原任务；
-- 只复制安全字段（不含附件/动态/置顶/note同步字段）；reference_managed=false
-- ============================================================
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

  -- 按时区推进（timezone 在 v_task.timezone）
  -- 简化：直接用 interval 推进；月末/闰日夹到末日
  v_next_start := v_task.schedule_start_at;
  v_next_end := v_task.schedule_end_at;
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
        -- 月末夹到末日：取下月最后一天
        v_next_start := date_trunc('month', v_next_start + interval '1 month') + interval '1 month - 1 day';
      end;
    when 'yearly'  then
      begin
        v_next_start := v_next_start + interval '1 year';
        if v_next_end is not null then v_next_end := v_next_end + interval '1 year'; end if;
      exception when datetime_field_overflow then
        -- 闰日夹到 2 月末
        v_next_start := date_trunc('year', v_next_start + interval '1 year') + interval '2 months - 1 day';
      end;
    else return null;
  end case;

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
grant execute on function public.complete_recurring_task(uuid) to authenticated;

-- ============================================================
-- 14. 备份 v3 扩展：restore_backup_v2_with_pages 加新表（参照 027 模式）
-- ============================================================
create or replace function public.restore_backup_v2_with_pages(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  restore_result jsonb;
  target_user uuid := auth.uid();
  has_task_lists boolean;
  has_task_reminders boolean;
  has_task_attachments boolean;
  has_task_activities boolean;
  has_task_templates boolean;
  v_old_id uuid;
  v_new_id uuid;
begin
  if target_user is null then
    return jsonb_build_object('status', 'error', 'message', '未授权');
  end if;

  -- 委托给 frozen 基础函数（处理 v2 的 16 张表）
  restore_result := public.restore_backup_v2(p_payload);
  if (restore_result->>'status') = 'not_empty' or (restore_result->>'status') = 'error' then
    return restore_result;
  end if;

  -- 检测可选新表（v2 备份没有这些 key，跳过）
  has_task_lists := jsonb_typeof(p_payload->'data'->'task_lists') = 'array';
  has_task_reminders := jsonb_typeof(p_payload->'data'->'task_reminders') = 'array';
  has_task_attachments := jsonb_typeof(p_payload->'data'->'task_attachments') = 'array';
  has_task_activities := jsonb_typeof(p_payload->'data'->'task_activities') = 'array';
  has_task_templates := jsonb_typeof(p_payload->'data'->'task_templates') = 'array';

  -- task_lists
  if has_task_lists then
    insert into public.task_lists (id, user_id, name, icon, color, sort_order, is_default, created_at, updated_at)
    select row.id, target_user, row.name, row.icon, row.color, row.sort_order, coalesce(row.is_default, false), row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'task_lists') as row(
      id uuid, name text, icon text, color text, sort_order int, is_default boolean, created_at timestamptz, updated_at timestamptz
    )
    on conflict (id) do nothing;
  end if;

  -- task_reminders
  if has_task_reminders then
    insert into public.task_reminders (id, user_id, task_id, anchor, offset_minutes, notified_at, created_at)
    select row.id, target_user, row.task_id, row.anchor, row.offset_minutes, row.notified_at, row.created_at
    from jsonb_to_recordset(p_payload->'data'->'task_reminders') as row(
      id uuid, task_id uuid, anchor text, offset_minutes int, notified_at timestamptz, created_at timestamptz
    )
    on conflict (id) do nothing;
  end if;

  -- task_attachments（二进制不在备份里，只恢复元数据）
  if has_task_attachments then
    insert into public.task_attachments (id, user_id, task_id, name, bucket, path, mime_type, size_bytes, created_at)
    select row.id, target_user, row.task_id, row.name, coalesce(row.bucket, 'attachments'), row.path, row.mime_type, row.size_bytes, row.created_at
    from jsonb_to_recordset(p_payload->'data'->'task_attachments') as row(
      id uuid, task_id uuid, name text, bucket text, path text, mime_type text, size_bytes bigint, created_at timestamptz
    )
    on conflict (id) do nothing;
  end if;

  -- task_activities
  if has_task_activities then
    insert into public.task_activities (id, user_id, task_id, action, detail, created_at)
    select row.id, target_user, row.task_id, row.action, row.detail, row.created_at
    from jsonb_to_recordset(p_payload->'data'->'task_activities') as row(
      id uuid, task_id uuid, action text, detail jsonb, created_at timestamptz
    )
    on conflict (id) do nothing;
  end if;

  -- task_templates
  if has_task_templates then
    insert into public.task_templates (id, user_id, name, template, created_at, updated_at)
    select row.id, target_user, row.name, row.template, row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'task_templates') as row(
      id uuid, name text, template jsonb, created_at timestamptz, updated_at timestamptz
    )
    on conflict (id) do nothing;
  end if;

  -- 回填 tasks 新列（schedule/list_id 等，v2 备份的 tasks 可能没有这些字段）
  -- 由 restore_backup_v2 已插入 tasks 行，新列为默认值（null），此处不覆盖。

  return restore_result;
end; $$;
grant execute on function public.restore_backup_v2_with_pages(jsonb) to authenticated;
