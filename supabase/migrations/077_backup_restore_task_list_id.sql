-- 077 备份恢复链补写 tasks.list_id（B01 演练实测缺陷 #3）
--
-- 缺陷：tasks.list_id（033）从未进入恢复链——live 的 restore_backup_v2（044）
-- tasks 插入列不含 list_id，后续各 wrapper 也未补写。备份往返后所有任务脱离
-- 所属列表（掉回默认清单）。导出侧 B01 已补 list_id 列与剪枝（置空悬空引用），
-- 本迁移补 DB 侧落库。
--
-- 模式沿 040：with_hierarchy 层在下游（pages → base）插完 tasks / task_lists
-- 之后，用 payload 后置 UPDATE 补列。task_lists 由 033 的 with_pages 层插入，
-- 执行到本层 update 时已存在，FK tasks_list_id_fkey 可满足；payload 携带
-- 不存在的 list_id 会触发 FK 违例 → 整体回滚（fail-closed，与表级引用严格度
-- 一致）。parent_task_id 的自引用/缺失父/循环预检保持 040 原样。
create or replace function public.restore_backup_v2_with_hierarchy(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  restore_result jsonb;
  target_user uuid := auth.uid();
begin
  if target_user is null then
    return jsonb_build_object('status', 'error', 'message', '未授权');
  end if;

  if jsonb_typeof(p_payload->'data'->'tasks') = 'array' then
    if exists (
      select 1
      from jsonb_array_elements(p_payload->'data'->'tasks') task
      where task->>'parent_task_id' is not null
        and (
          task->>'parent_task_id' = task->>'id'
          or not exists (
            select 1
            from jsonb_array_elements(p_payload->'data'->'tasks') parent
            where parent->>'id' = task->>'parent_task_id'
          )
        )
    ) then
      raise exception using
        errcode = '23503',
        message = 'Restore contains an invalid parent task reference';
    end if;

    if exists (
      with recursive task_links as (
        select
          (task->>'id')::uuid as id,
          (task->>'parent_task_id')::uuid as parent_id
        from jsonb_array_elements(p_payload->'data'->'tasks') task
        where task->>'parent_task_id' is not null
      ),
      ancestry as (
        select id as origin_id, parent_id, array[id] as path
        from task_links
        union all
        select ancestry.origin_id, task_links.parent_id, ancestry.path || task_links.id
        from ancestry
        join task_links on task_links.id = ancestry.parent_id
        where not task_links.id = any(ancestry.path)
      )
      select 1 from ancestry where parent_id = origin_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'Restore task hierarchy cannot contain a cycle';
    end if;
  end if;

  restore_result := public.restore_backup_v2_with_pages(p_payload);
  if (restore_result->>'status') <> 'restored' then
    return restore_result;
  end if;

  update public.tasks task
  set parent_task_id = (payload_task->>'parent_task_id')::uuid
  from jsonb_array_elements(p_payload->'data'->'tasks') payload_task
  where payload_task ? 'parent_task_id'
    and payload_task->>'parent_task_id' is not null
    and task.id = (payload_task->>'id')::uuid
    and task.user_id = target_user;

  -- B01：list_id 补写（033 列；导出侧已带列并剪枝悬空引用，restore.ts 已重映射）
  update public.tasks task
  set list_id = (payload_task->>'list_id')::uuid
  from jsonb_array_elements(p_payload->'data'->'tasks') payload_task
  where payload_task ? 'list_id'
    and payload_task->>'list_id' is not null
    and task.id = (payload_task->>'id')::uuid
    and task.user_id = target_user;

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_with_hierarchy(jsonb) from public;
grant execute on function public.restore_backup_v2_with_hierarchy(jsonb) to authenticated;
