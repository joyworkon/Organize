-- 056 数据库越权热修（P0-02）
--
-- 三层收紧：
--   1. prune_note_versions 补属主校验：它是 SECURITY DEFINER（绕过 RLS）且此前
--      无属主检查、EXECUTE 默认对 PUBLIC 开放——任意认证（甚至匿名）用户可裁剪
--      他人笔记的历史版本。
--   2. 函数 EXECUTE 显式化：public schema 全部函数 revoke PUBLIC/anon（消除
--      PostgreSQL 默认 PUBLIC EXECUTE），按调用方分层 grant：
--        - 仅服务端（cron，service_role 专用）：claim/reset 系列
--        - 公开（匿名分享页 / 生成列求值）：get_public_share、tiptap_extract_text
--        - 其余（客户端 RPC 与内部触发器）：authenticated + service_role
--   3. 父子同租户：七处父子关系改复合外键 (parent_id, user_id) → parent(id, user_id)，
--      在 DB 层拒绝「把自己的子记录挂到别人的父资源」（含跨租户级联删除/置空向量）。
--      无 user_id 的 note_versions / task_checklists 已由 RLS WITH CHECK(EXISTS 父)
--      覆盖，不在复合外键范围。
-- 存量数据：单用户开发期数据天然满足同租户；若生产存在跨租户存量行，本迁移会
-- 显式失败（应当失败，先清洗再升）。
-- 存量 pgTAP 96 断言、既有 RLS 与表级 GRANT 不受影响。

-- ============================================================
-- 1. prune_note_versions 属主校验
-- ============================================================
create or replace function public.prune_note_versions(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- P0-02：DEFINER 绕过 RLS，必须显式校验属主
  if not exists (
    select 1 from public.notes
    where id = p_note_id and user_id = auth.uid()
  ) then
    raise exception 'Note not found or access denied';
  end if;

  delete from public.note_versions
  where note_id = p_note_id
    and message is null
    and (
      -- 90 天前：全删
      created_at < now() - interval '90 days'
      -- 7~90 天：每天只留最新 1 版
      or (
        created_at < now() - interval '7 days'
        and id not in (
          select distinct on (date_trunc('day', created_at)) id
          from public.note_versions
          where note_id = p_note_id
            and message is null
            and created_at >= now() - interval '90 days'
            and created_at < now() - interval '7 days'
          order by date_trunc('day', created_at), created_at desc
        )
      )
      -- 7 天内：每小时只留最新 1 版
      or (
        created_at >= now() - interval '7 days'
        and id not in (
          select distinct on (date_trunc('hour', created_at)) id
          from public.note_versions
          where note_id = p_note_id
            and message is null
            and created_at >= now() - interval '7 days'
          order by date_trunc('hour', created_at), created_at desc
        )
      )
    );
end;
$$;

-- ============================================================
-- 1b. save_note_version 触发器：裁剪调用需要属主上下文
--     prune 已加属主校验，而触发器在无 JWT 的上下文（服务端/管理写入）里
--     auth.uid() 为 NULL 会直接炸掉笔记更新——此类写入跳过裁剪，
--     时间分级由下一次用户编辑补做（裁剪是纯维护操作，无正确性影响）
-- ============================================================
create or replace function public.save_note_version()
returns trigger as $$
declare
  last_time timestamptz;
begin
  -- 只在 content 或 title 真正变化时才记录
  if (TG_OP = 'UPDATE' and NEW.content IS NOT DISTINCT FROM OLD.content
      and NEW.title IS NOT DISTINCT FROM OLD.title) then
    return NEW;
  end if;

  -- 距上次快照不足 5 分钟 → 跳过（连续编辑去抖；时间分级在裁剪端完成）
  select created_at into last_time
    from public.note_versions
    where note_id = NEW.id
    order by created_at desc
    limit 1;
  if last_time is not null
     and last_time > now() - interval '5 minutes' then
    return NEW;
  end if;

  insert into public.note_versions (note_id, content, title, created_at)
  values (NEW.id, OLD.content, OLD.title, now());

  -- P0-02：prune 现在内置属主校验；无用户上下文的写入跳过裁剪
  if auth.uid() is not null then
    perform public.prune_note_versions(NEW.id);
  end if;

  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

-- ============================================================
-- 2. search_path 补齐（未设置的函数统一 public，防搜索路径劫持）
--    仅处理盘点出的其余两个未设置函数；已显式设置的不动
--    （避免误伤引用 extensions schema 的函数）
-- ============================================================
do $$
declare r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname in ('update_updated_at_column', 'extract_task_items')
  loop
    execute format('alter function %s set search_path = public', r.oid::regprocedure::text);
  end loop;
end $$;

-- ============================================================
-- 3. 函数 EXECUTE 分层授权（消除默认 PUBLIC EXECUTE）
--    - 全部函数：revoke PUBLIC、revoke anon
--    - server_only：仅 service_role（/api/cron 经 service_role 客户端调用）
--    - anon_ok：另授 anon（匿名分享页、生成列求值）
--    - 其余：authenticated + service_role（函数内部已有属主校验/由 RLS 兜底）
--    按 pg_proc 逐函数处理，天然覆盖 restore_backup_v2 等重载族
-- ============================================================
do $$
declare r record;
  server_only text[] := array[
    'claim_due_task_reminder_deliveries',
    'reset_task_reminder_delivery',
    'reset_task_reminders_after_schedule_change'
  ];
  anon_ok text[] := array['get_public_share', 'tiptap_extract_text'];
begin
  for r in
    select p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function public.%I(%s) from public', r.proname, r.args);
    execute format('revoke execute on function public.%I(%s) from anon', r.proname, r.args);
    if r.proname = any (server_only) then
      execute format('revoke execute on function public.%I(%s) from authenticated', r.proname, r.args);
      execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.args);
    elsif r.proname = any (anon_ok) then
      execute format('grant execute on function public.%I(%s) to anon, authenticated, service_role', r.proname, r.args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
    end if;
  end loop;
end $$;

-- ============================================================
-- 4. 父子同租户复合外键
--    父表 (id, user_id) 唯一索引作为 FK 引用目标；子表外键升级为
--    (parent_id, user_id) → parent(id, user_id)，跨租户插入/更新直接 23503
-- ============================================================
create unique index if not exists tasks_id_user_key
  on public.tasks (id, user_id);
create unique index if not exists notes_id_user_key
  on public.notes (id, user_id);
create unique index if not exists note_comment_threads_id_user_key
  on public.note_comment_threads (id, user_id);

-- 动态丢弃涉及以下父子对的旧单列外键（user_id → auth.users 的外键不在清单，保留）
do $$
declare r record;
begin
  for r in
    select con.conname, con.conrelid::regclass as child
    from pg_constraint con
    join pg_class parent on parent.oid = con.confrelid
    where con.contype = 'f'
      and (
        (con.conrelid = 'public.task_reminders'::regclass and parent.relname = 'tasks')
     or (con.conrelid = 'public.task_attachments'::regclass and parent.relname = 'tasks')
     or (con.conrelid = 'public.task_item_refs'::regclass and parent.relname in ('tasks', 'notes'))
     or (con.conrelid = 'public.task_dependencies'::regclass and parent.relname = 'tasks')
     or (con.conrelid = 'public.note_comment_threads'::regclass and parent.relname = 'notes')
     or (con.conrelid = 'public.note_comments'::regclass and parent.relname = 'note_comment_threads')
     or (con.conrelid = 'public.tasks'::regclass and con.confrelid = 'public.tasks'::regclass)
      )
  loop
    execute format('alter table %s drop constraint %I', r.child, r.conname);
  end loop;
end $$;

alter table public.task_reminders
  add constraint task_reminders_task_same_tenant_fk
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade;

alter table public.task_attachments
  add constraint task_attachments_task_same_tenant_fk
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade;

alter table public.task_item_refs
  add constraint task_item_refs_task_same_tenant_fk
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade;

alter table public.task_item_refs
  add constraint task_item_refs_note_same_tenant_fk
  foreign key (note_id, user_id) references public.notes (id, user_id) on delete cascade;

alter table public.task_dependencies
  add constraint task_dependencies_task_same_tenant_fk
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade;

alter table public.task_dependencies
  add constraint task_dependencies_depends_on_same_tenant_fk
  foreign key (depends_on_task_id, user_id) references public.tasks (id, user_id) on delete cascade;

alter table public.note_comment_threads
  add constraint note_comment_threads_note_same_tenant_fk
  foreign key (note_id, user_id) references public.notes (id, user_id) on delete cascade;

alter table public.note_comments
  add constraint note_comments_thread_same_tenant_fk
  foreign key (thread_id, user_id) references public.note_comment_threads (id, user_id) on delete cascade;

-- 子任务自引用（040）：跨租户父任务可被级联删除/置空（原 on delete set null 会
-- 连 user_id 一起置空违反 NOT NULL），改复合 FK 并用 PG15 列清单语法只置空父列
alter table public.tasks
  add constraint tasks_parent_task_same_tenant_fk
  foreign key (parent_task_id, user_id) references public.tasks (id, user_id)
  on delete set null (parent_task_id);
