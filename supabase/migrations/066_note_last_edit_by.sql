-- 066 协作者归属列 notes.last_edit_by（P5 后续待办：ROADMAP P5-02 卡 3 登记的独立卡）
--
-- 卡面要求（ADR 0002「065 落地时追加的边界」第 4 条 + ROADMAP 待办）：写「谁改了这篇笔记」
-- 必须先加列，并同步升级备份合同 v4、mock seed 与相关测试，不能「顺便写一下」。
-- 本迁移做三件事：
--   1. notes 加 last_edit_by uuid 列
--   2. save_note_with_tasks（v1，现行定义在 051）与 save_note_with_tasks_v2（065）的
--      notes UPDATE 各加一行 last_edit_by = 调用者。其余语句逐字保留，行为不变
--   3. 把 065 测试里 `hasnt_column('notes','last_edit_by')` 的钉子翻转为 has_column
--
-- 刻意的边界：
--   * **不带外键**：归属是展示性事实，不是属主权。跨账号恢复、协作者注销都会让
--     uuid 悬空；带 FK 会让 restore / 账号删除连锁炸掉。消费方（冲突对话框）按
--     「查 user_profiles 拿不到名字就回退通用文案」处理悬空。
--   * **不回填**：列引入之前的编辑者不可知，NULL 是诚实值；不造「属主一定编辑过」的假话。
--     新笔记由首次保存落值，创建→首次保存间隔为秒级，无观测空白。
--   * **restore 不搬运**：restore_backup_v2_* 链的 notes INSERT 列清单不加它。归属是
--     「活协作上下文」的状态，不是内容本身；恢复（尤其跨账号）后旧归属无意义，
--     重置为 NULL，由下一次保存重新落值。导出侧仍导出（用户数据可检视），见备份合同。
--   * **只由保存 RPC 写**：垃圾桶进出（mutate_trash）、直接表更新都不改它——
--     它回答「谁最后一次编辑了内容」，不是「谁最后一次碰了这行」。

-- ============================================================
-- 1. 列
-- ============================================================
alter table public.notes add column if not exists last_edit_by uuid;

-- ============================================================
-- 2. v1 原样重述（源自 051，唯一差异：notes UPDATE 加 last_edit_by）
-- ============================================================
drop function if exists public.save_note_with_tasks(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid, jsonb
);

create function public.save_note_with_tasks(
  p_note_id uuid,
  p_content jsonb,
  p_expected_note_revision integer,
  p_title text default null,
  p_task_mutations jsonb default null,
  p_expected_task_revisions jsonb default null,
  p_mutation_id uuid default null,
  p_note_snapshot jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_note_owner uuid;
  v_cur_rev integer;
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

  -- 已进垃圾箱的笔记拒绝写入（security definer 绕过 RLS，必须在此显式校验）
  select user_id, content_revision into v_note_owner, v_cur_rev
  from public.notes
  where id = p_note_id and deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_note_owner <> v_user then
    return jsonb_build_object('status', 'forbidden');
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
      where id = v_task_id and user_id = v_user and deleted_at is null
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
      last_edit_by = v_user,
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
          -- 复选框只表达完成/未完成两态语义：勾选=从非 done 真实完成；
          -- 取消勾选=仅把已完成的回退为 todo；不把 in_progress/cancelled 抹成 todo。
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
      where id = v_task_id and user_id = v_user
      returning sync_version into v_new_task_rev;
      v_task_revisions := v_task_revisions
        || jsonb_build_object(v_task_id::text, v_new_task_rev);
    end loop;
  end if;

  delete from public.task_item_refs where note_id = p_note_id;

  insert into public.task_item_refs (user_id, task_id, note_id, block_id)
  select v_user, task_id, p_note_id, block_id
  from public.extract_task_items(p_content)
  where task_id is not null
  on conflict (note_id, block_id) do nothing;

  with affected_tasks as (
    select id from public.tasks
    where user_id = v_user
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
    insert into public.save_mutation_log (mutation_id, user_id, note_id, result)
    values (p_mutation_id, v_user, p_note_id, v_mutation_result)
    on conflict (mutation_id) do nothing;
  end if;

  return v_mutation_result;
end;
$$;

revoke all on function public.save_note_with_tasks(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid, jsonb
) from public;
grant execute on function public.save_note_with_tasks(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid, jsonb
) to authenticated;

-- ============================================================
-- 3. v2 原样重述（源自 065，唯一差异：notes UPDATE 加 last_edit_by = 调用者。
--    权限闸照旧只调 resource_role()；写入 scope 照旧是笔记属主）
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
      -- 归属记调用者（协作者保存 = 协作者），与业务行写入的属主 scope 刻意不同：
      -- 这列回答的是「谁编辑的」，不是「这行是谁的」
      last_edit_by = v_user,
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
-- 4. 函数 EXECUTE 分层与 065 一致（restate 后权限不变）
-- ============================================================
revoke all on function public.save_note_with_tasks_v2(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid, jsonb
) from public;
grant execute on function public.save_note_with_tasks_v2(
  uuid, jsonb, integer, text, jsonb, jsonb, uuid, jsonb
) to authenticated;
