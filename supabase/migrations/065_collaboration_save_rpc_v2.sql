-- 065 协作保存 RPC 分权（P5-02 卡 3/4）
--
-- 卡面要求：保存 RPC 按角色分权，且必须复用 063 的 public.resource_role()，不得重写
-- 等价判定 SQL。本迁移做两件事：
--   1. 新增 save_note_with_tasks_v2：与 v1（051 定稿的 8 参数版本）同签名、同 jsonb
--      状态契约，把「调用者必须是笔记属主」换成「调用者对这篇笔记有 owner 或 editor 权」，
--      并把所有业务行写入的 scope 从 auth.uid() 换成笔记属主。
--   2. 修 save_note_version 触发器：它调用的 prune_note_versions 在 056 里加了
--      「notes.user_id = auth.uid()」校验，协作保存时调用者是协作者而行的属主是别人，
--      校验必然不成立并 raise —— 不修这条，第 1 步的 v2 每次协作者保存都会整体失败。
--
-- 为什么是「新增 v2」而不是就地改 v1：v1 的调用点在 apps/web（notes/[id]/page.tsx 的
-- flushSave 与离线队列），前端接入是下一张卡（PR4）。两版并存期间 v1 仍然只放行属主，
-- 协作者调 v1 得到 forbidden，行为与今天一致，不存在「旧入口绕过新权限」的空档。
--
-- 关键取舍与边界：
--   1. 写入 scope 必须是属主而不是调用者：056 给 task_item_refs 等表建了
--      (note_id, user_id) / (task_id, user_id) 复合外键，refs 行里的 user_id 必须同时
--      等于笔记属主与任务属主。协作者保存时若继续写 auth.uid()，插入直接撞 23503。
--   2. 幂等日志仍按调用者记账（save_mutation_log.user_id = 调用者）：mutation_id 是各
--      客户端自己生成的重试键，A 的重放不该吃掉 B 的日志，反之亦然。
--   3. 任务变更的归属沿用 v1 口径，只把 user_id 换成属主：editor 能改这篇笔记里任务块的
--      title/status（这是「可编辑的共享笔记」的应有语义），但改不到自己账号下的任务，
--      也改不到别人的任务 —— 不在属主名下的 task_id 一律 conflict_task。
--   4. viewer 与非成员得到与 v1 同名的 'forbidden'，前端不必新增状态分支；且「这篇笔记
--      不存在」对无权限调用者同样返回 forbidden（v1 会返回 not_found，等于给了一个
--      笔记 id 存在性探针）。not_found 只在调用者确有权限而行已消失/进垃圾箱时出现。
--   5. 页面结构（parent_note_id）不由本迁移放权：notes 上已有的 validate_note_parent
--      触发器要求「父笔记与子笔记同属主」，协作者把共享笔记挂到自己树下会被它拒绝
--      （抛异常，客户端走通用失败分支，草稿保留）。icon/cover/排版偏好按 Notion 口径
--      交给 editor，因为它们是这一页自己的表现层属性。
--   6. 其余写路径保持属主专属、且都是失败闭合（不会因 v2 而放开）：mutate_trash（回收站
--      进出）、restore_note_version、convert_highlight_reference、move_note_block（RLS
--      无协作者写策略）。这些是 editor 的功能缺口，不是权限漏洞，登记到 ROADMAP 待办。
--   7. 协作者保存同样会写 note_versions（触发器产生），但 064 没放开子资源可见性：
--      协作者看不到历史，属主看得到全部。

-- ============================================================
-- 1. 版本裁剪拆出「按属主」内核，触发器不再依赖调用者身份
-- ============================================================
-- 行为与原 prune_note_versions 一致，只是属主由参数给出：
-- 触发器上下文里正确的答案是 NEW.user_id，而 auth.uid() 在协作保存时是协作者。
create or replace function public.prune_note_versions_for(p_note_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_note_id is null or p_owner is null then
    return;
  end if;
  -- 只允许裁剪「确属该属主」的笔记版本：p_owner 不能当作免检通行证
  if not exists (
    select 1 from public.notes
    where id = p_note_id and user_id = p_owner
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

-- 对外签名不变（056 的属主校验契约、036/056 的既有测试都继续成立），只是改为委托
create or replace function public.prune_note_versions(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prune_note_versions_for(p_note_id, auth.uid());
end;
$$;

create or replace function public.save_note_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  -- 056 在这里跳过「无用户上下文」的写入，是因为 prune 只认 auth.uid()；
  -- 现在按 NEW.user_id 裁剪，不需要再借调用者身份，但保留同一道闸门：
  -- 无 JWT 的批量写入（备份恢复等）仍不触发裁剪，避免恢复过程边写边删。
  if auth.uid() is not null then
    perform public.prune_note_versions_for(NEW.id, NEW.user_id);
  end if;

  return NEW;
end;
$$;

-- ============================================================
-- 2. 协作版原子保存 RPC
-- ============================================================
drop function if exists public.save_note_with_tasks_v2(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid, jsonb
);

create function public.save_note_with_tasks_v2(
  p_note_id uuid,
  p_content jsonb,
  p_expected_note_revision integer,
  p_title text default null,
  p_task_mutations jsonb default null,           -- [{"task_id","title","status"}]
  p_expected_task_revisions jsonb default null,  -- {"<task_id>": <rev int>}
  p_mutation_id uuid default null,
  p_note_snapshot jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_cur_rev integer;
  v_role text;
  v_mutation_result jsonb;
  v_task_id uuid;
  v_task_rev integer;
  v_exp_rev integer;
  v_new_task_rev integer;
  v_title text;
  v_status text;
  v_task_revisions jsonb := '{}'::jsonb;
  v_m record;
begin
  if v_user is null then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if p_mutation_id is not null then
    -- 幂等回放仅限同一篇笔记：跨笔记复用 mutation_id 视为新请求重新执行
    select result into v_mutation_result
    from public.save_mutation_log
    where mutation_id = p_mutation_id and user_id = v_user
      and (note_id is null or note_id = p_note_id);
    if found then
      return v_mutation_result;
    end if;
  end if;

  -- 权限判定唯一入口：063 的 resource_role()（owner 含属主本人，editor 含被授权成员）。
  -- 刻意排在存在性查询之前：v1 用 forbidden / not_found 两个状态区分「不是你的」和
  -- 「不存在」，对无权限的调用者等于一个笔记 id 存在性探针。这里对两者一律 forbidden，
  -- not_found 只留给确有权限、但行已消失或进了垃圾箱的调用者。
  v_role := public.resource_role('note', p_note_id);
  if v_role is null or v_role not in ('owner', 'editor') then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 已进垃圾箱的笔记拒绝写入（security definer 绕过 RLS，必须在此显式校验）
  select user_id, content_revision into v_owner, v_cur_rev
  from public.notes
  where id = p_note_id and deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_cur_rev <> p_expected_note_revision then
    return jsonb_build_object(
      'status', 'conflict_note',
      'current_revision', v_cur_rev
    );
  end if;

  if p_task_mutations is not null then
    for v_m in select jsonb_array_elements(p_task_mutations) as elem
    loop
      v_task_id := (v_m.elem->>'task_id')::uuid;
      select sync_version into v_task_rev
      from public.tasks
      where id = v_task_id and user_id = v_owner and deleted_at is null
      for update;
      if not found then
        return jsonb_build_object(
          'status', 'conflict_task',
          'task_id', v_task_id,
          'reason', 'not_found_or_forbidden'
        );
      end if;
      if p_expected_task_revisions is not null then
        v_exp_rev := coalesce(
          (p_expected_task_revisions->>(v_m.elem->>'task_id'))::integer,
          0
        );
        if v_task_rev <> v_exp_rev then
          return jsonb_build_object(
            'status', 'conflict_task',
            'task_id', v_task_id,
            'current_sync_version', v_task_rev
          );
        end if;
      end if;
    end loop;
  end if;

  update public.notes
  set content = p_content,
      content_revision = v_cur_rev + 1,
      title = coalesce(p_title, title),
      icon = case
        when p_note_snapshot ? 'icon' then p_note_snapshot->>'icon'
        else icon
      end,
      cover_url = case
        when p_note_snapshot ? 'cover_url' then p_note_snapshot->>'cover_url'
        else cover_url
      end,
      cover_position = case
        when p_note_snapshot ? 'cover_position'
          then coalesce((p_note_snapshot->>'cover_position')::smallint, 50)
        else cover_position
      end,
      parent_note_id = case
        when p_note_snapshot ? 'parent_note_id'
          then nullif(p_note_snapshot->>'parent_note_id', '')::uuid
        else parent_note_id
      end,
      full_width = case
        when p_note_snapshot ? 'full_width'
          then coalesce((p_note_snapshot->>'full_width')::boolean, false)
        else full_width
      end,
      font_family = case
        when p_note_snapshot ? 'font_family'
          then coalesce(p_note_snapshot->>'font_family', 'default')
        else font_family
      end,
      small_font = case
        when p_note_snapshot ? 'small_font'
          then coalesce((p_note_snapshot->>'small_font')::boolean, false)
        else small_font
      end,
      updated_at = now()
  where id = p_note_id;

  if p_task_mutations is not null then
    for v_m in select jsonb_array_elements(p_task_mutations) as elem
    loop
      v_task_id := (v_m.elem->>'task_id')::uuid;
      v_title := v_m.elem->>'title';
      v_status := v_m.elem->>'status';
      update public.tasks
      set title = case when v_title is not null then v_title else title end,
          -- 复选框只表达完成/未完成两态语义（051 口径，不因协作而变）
          status = case
            when v_status = 'done' and status <> 'done' then 'done'
            when v_status = 'todo' and status = 'done' then 'todo'
            else status
          end,
          completed_at = case
            when v_status = 'done' and status <> 'done' then now()
            when v_status = 'todo' and status = 'done' then null
            else completed_at
          end,
          sync_version = sync_version + 1,
          updated_at = now()
      where id = v_task_id and user_id = v_owner
      returning sync_version into v_new_task_rev;
      v_task_revisions := v_task_revisions
        || jsonb_build_object(v_task_id::text, v_new_task_rev);
    end loop;
  end if;

  delete from public.task_item_refs where note_id = p_note_id;

  -- refs 的 user_id 写属主：056 的复合外键要求它同时等于笔记与任务的 user_id
  insert into public.task_item_refs (user_id, task_id, note_id, block_id)
  select v_owner, task_id, p_note_id, block_id
  from public.extract_task_items(p_content)
  where task_id is not null
  on conflict (note_id, block_id) do nothing;

  with affected_tasks as (
    select id from public.tasks
    where user_id = v_owner
      and reference_managed = true
      and deleted_at is null
      and not exists (
        select 1 from public.task_item_refs r
        where r.task_id = public.tasks.id
      )
  )
  update public.tasks
  set deleted_at = now(),
      deleted_reason = 'orphaned',
      updated_at = now()
  where id in (select id from affected_tasks);

  v_mutation_result := jsonb_build_object(
    'status', 'ok',
    'note_revision', v_cur_rev + 1,
    'task_revisions', v_task_revisions
  );
  if p_mutation_id is not null then
    -- 记账主体是调用者：重试键属于各客户端自己的会话
    insert into public.save_mutation_log (mutation_id, user_id, note_id, result)
    values (p_mutation_id, v_user, p_note_id, v_mutation_result)
    on conflict (mutation_id) do nothing;
  end if;

  return v_mutation_result;
end;
$$;

-- ============================================================
-- 3. 函数 EXECUTE 分层（沿 056 / 063 / 064 约定）
-- ============================================================
do $$
declare r record;
  client_fn text[] := array['save_note_with_tasks_v2'];
  internal_only text[] := array['prune_note_versions_for'];
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname::text = any (client_fn || internal_only)
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    if r.proname::text = any (internal_only) then
      -- 接受任意 owner uuid，客户端直调等于给别人笔记的版本库装了一个删除按钮；
      -- 只允许被同为 DEFINER 的触发器函数内部调用
      execute format('revoke execute on function public.%I(%s) from authenticated', r.proname, r.args);
      execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
    end if;
  end loop;
end $$;
