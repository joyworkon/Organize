-- 031_save_note_with_tasks_rpc.sql
-- G1:原子保存 RPC —— 笔记快照 + 任务变更 + 引用对齐,单事务,幂等
-- 依据 docs/g0-protocol.md §7
--
-- 签约:
--   save_note_with_tasks(
--     p_note_id, p_content, p_expected_note_revision,
--     p_title, p_task_mutations, p_expected_task_revisions, p_mutation_id
--   ) → jsonb { note_revision, task_revisions, status }
--
--   status: 'ok' | 'conflict_note' | 'conflict_task' | 'not_found' | 'forbidden'

create or replace function public.save_note_with_tasks(
  p_note_id uuid,
  p_content jsonb,
  p_expected_note_revision integer,
  p_title text default null,
  p_task_mutations jsonb default null,           -- [{"task_id","title","status"}]
  p_expected_task_revisions jsonb default null,  -- {"<task_id>": <rev int>}
  p_mutation_id uuid default null
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
  v_block record;
begin
  -- 0) 鉴权:必须登录
  if v_user is null then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 1) 幂等:mutation_id 已处理过则直接返回缓存结果
  if p_mutation_id is not null then
    select result into v_mutation_result
    from public.save_mutation_log
    where mutation_id = p_mutation_id and user_id = v_user;
    if found then
      return v_mutation_result;
    end if;
  end if;

  -- 2) 锁定笔记行 + 校验归属 + revision
  select user_id, content_revision into v_note_owner, v_cur_rev
  from public.notes
  where id = p_note_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_note_owner <> v_user then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if v_cur_rev <> p_expected_note_revision then
    return jsonb_build_object('status', 'conflict_note', 'current_revision', v_cur_rev);
  end if;

  -- 3) 锁定 + 校验各 task 的归属，可选校验 revision(乐观锁)
  --    p_expected_task_revisions 整体为 null 时跳过 sync_version 校验（单用户本地场景放宽，
  --    避免前端未维护 sync_version 缓存导致每次都 conflict）。任务存在+归属始终校验。
  if p_task_mutations is not null then
    for v_m in select jsonb_array_elements(p_task_mutations) as elem
    loop
      v_task_id := (v_m.elem->>'task_id')::uuid;
      select sync_version into v_task_rev
      from public.tasks
      where id = v_task_id and user_id = v_user
      for update;
      if not found then
        return jsonb_build_object('status', 'conflict_task', 'task_id', v_task_id, 'reason', 'not_found_or_forbidden');
      end if;
      if p_expected_task_revisions is not null then
        v_exp_rev := coalesce((p_expected_task_revisions->>(v_m.elem->>'task_id'))::integer, 0);
        if v_task_rev <> v_exp_rev then
          return jsonb_build_object('status', 'conflict_task', 'task_id', v_task_id, 'current_sync_version', v_task_rev);
        end if;
      end if;
    end loop;
  end if;

  -- 4) 保存笔记(全量 content 快照 + revision+1);title 可选
  update public.notes
  set content = p_content,
      content_revision = v_cur_rev + 1,
      title = coalesce(p_title, title),
      updated_at = now()
  where id = p_note_id;

  -- 5) 应用任务变更(仅 title + status,其它字段不在同步范围)
  if p_task_mutations is not null then
    for v_m in select jsonb_array_elements(p_task_mutations) as elem
    loop
      v_task_id := (v_m.elem->>'task_id')::uuid;
      v_title := v_m.elem->>'title';
      v_status := v_m.elem->>'status';
      -- sync_version+1;status 校验靠 tasks_status_check 约束兜底
      update public.tasks
      set title = case when v_title is not null then v_title else title end,
          status = case when v_status is not null then v_status else status end,
          completed_at = case
            when v_status = 'done' and completed_at is null then now()
            when v_status in ('todo','in_progress','cancelled') then null
            else completed_at end,
          sync_version = sync_version + 1,
          updated_at = now()
      where id = v_task_id and user_id = v_user
      returning sync_version into v_new_task_rev;
      v_task_revisions := v_task_revisions || jsonb_build_object(v_task_id::text, v_new_task_rev);
    end loop;
  end if;

  -- 6) 对齐 task_item_refs:从 p_content 解析所有 taskItem 块的 (block_id, task_id)
  --    先删该笔记不再出现的 ref,再 upsert 当前出现的。
  --    快照不覆盖 canonical task:本步只维护引用关系,不写 tasks 内容。
  --    block_id 来自 taskItem.attrs.id;task_id 来自 taskItem.attrs.taskId。
  --    解析用 jsonb_path_exists / 递归 CTE 提取所有 taskItem 节点。
  --    (这里用 plpgsql + jsonb_array_elements 递归遍历,见辅助函数 extract_task_items)

  -- 删除该笔记所有 ref(RPC 内用 security definer 绕过 RLS)
  delete from public.task_item_refs where note_id = p_note_id;

  -- 重新插入从快照解析出的绑定块
  insert into public.task_item_refs (user_id, task_id, note_id, block_id)
  select v_user, task_id, p_note_id, block_id
  from public.extract_task_items(p_content)
  where task_id is not null
  on conflict (note_id, block_id) do nothing;

  -- 7) 回收 orphaned:reference_managed 任务若活动 ref 数=0 → 软删(orphaned)
  --    仅处理本次可能受影响的任务(p_task_mutations 涉及的 + 原 note 引用过的)
  with affected_tasks as (
    select id from public.tasks
    where user_id = v_user
      and reference_managed = true
      and deleted_at is null
      and not exists (
        select 1 from public.task_item_refs r where r.task_id = public.tasks.id
      )
  )
  update public.tasks
  set deleted_at = now(),
      deleted_reason = 'orphaned',
      updated_at = now()
  where id in (select id from affected_tasks);

  -- 8) 结果 + 写幂等日志
  v_mutation_result := jsonb_build_object(
    'status', 'ok',
    'note_revision', v_cur_rev + 1,
    'task_revisions', v_task_revisions
  );
  if p_mutation_id is not null then
    insert into public.save_mutation_log (mutation_id, user_id, result)
    values (p_mutation_id, v_user, v_mutation_result)
    on conflict (mutation_id) do nothing;
  end if;

  return v_mutation_result;
end;
$$;

-- ========== 辅助函数:从 notes.content 递归提取 taskItem 的 (block_id, task_id) ==========
-- 返回每行 (block_id, task_id),仅含 task_id 非 null 的块。
-- 用 ANY path 递归遍历 content 树。
create or replace function public.extract_task_items(p_doc jsonb)
returns table(block_id text, task_id uuid)
language plpgsql
immutable
as $$
begin
  return query
  with recursive walk as (
    -- 起点:doc 根
    select p_doc as node
    union all
    -- 递归:进入 content 数组的每个子节点
    select child
    from walk, jsonb_array_elements(walk.node->'content') as child
    where jsonb_typeof(walk.node->'content') = 'array'
  )
  select
    walk.node->'attrs'->>'id',
    nullif(walk.node->'attrs'->>'taskId', '')::uuid
  from walk
  where walk.node->>'type' = 'taskItem'
    and walk.node->'attrs'->>'id' is not null
    and nullif(walk.node->'attrs'->>'taskId', '') is not null;
end;
$$;

-- RPC 权限:authenticated 可调用
grant execute on function public.save_note_with_tasks(uuid, jsonb, integer, text, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.extract_task_items(jsonb) to authenticated;
