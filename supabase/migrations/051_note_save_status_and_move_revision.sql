-- 051 修复两处绕过乐观锁 / 状态语义的写路径
-- A) save_note_with_tasks 的笔记复选框状态同步改为「真实变迁」语义：
--    此前每次保存都把绑定任务状态强写为 done/todo——任务在任务工作台被置为
--    in_progress / cancelled 后，任何一次对绑定笔记的编辑保存都会把它抹回
--    todo（completed_at 连带被清），已放弃的任务被「复活」。
--    新语义：勾选（done）= 从非 done 真实完成；取消勾选（todo）= 仅把已完成的
--    任务回退为 todo；in_progress / cancelled 不受笔记复选框影响。
-- B) move_note_block 递增 content_revision / updated_at：
--    此前移动块只改 content 不动 revision，其他标签页里打开的源/目标笔记
--    仍持有旧 revision，其下一次自动保存会通过乐观锁检查并把刚移动的块
--    写回原位（静默覆盖），与 046 修复的版本恢复问题同根因。

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


-- ========== B. move_note_block 递增乐观锁修订 ==========
drop function if exists public.move_note_block(uuid, uuid, text);

create function public.move_note_block(
  p_source_note_id uuid,
  p_target_note_id uuid,
  p_block_id text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_content jsonb;
  target_content jsonb;
  moving_block jsonb;
  source_blocks jsonb;
  target_blocks jsonb;
begin
  if p_source_note_id = p_target_note_id then
    raise exception 'Source and target notes must be different';
  end if;

  select content into source_content
  from notes
  where id = p_source_note_id and user_id = auth.uid()
  for update;

  select content into target_content
  from notes
  where id = p_target_note_id and user_id = auth.uid()
  for update;

  if source_content is null or target_content is null then
    raise exception 'Note not found or access denied';
  end if;

  source_blocks := coalesce(source_content->'content', '[]'::jsonb);
  target_blocks := coalesce(target_content->'content', '[]'::jsonb);

  select block into moving_block
  from jsonb_array_elements(source_blocks) as block
  where block->'attrs'->>'id' = p_block_id
  limit 1;

  if moving_block is null then
    raise exception 'Block not found';
  end if;

  select coalesce(jsonb_agg(block), '[]'::jsonb) into source_blocks
  from jsonb_array_elements(source_blocks) as block
  where block->'attrs'->>'id' is distinct from p_block_id;

  if jsonb_array_length(source_blocks) = 0 then
    source_blocks := '[{"type":"paragraph"}]'::jsonb;
  end if;

  -- content 变了就必须递增 content_revision，否则其他标签页里打开的
  -- 源/目标笔记下一次自动保存会按旧 revision 覆盖掉这次移动（见文件头 B）
  update notes
  set content = jsonb_set(source_content, '{content}', source_blocks, true),
      content_revision = content_revision + 1,
      updated_at = now()
  where id = p_source_note_id and user_id = auth.uid();

  update notes
  set content = jsonb_set(target_content, '{content}', target_blocks || jsonb_build_array(moving_block), true),
      content_revision = content_revision + 1,
      updated_at = now()
  where id = p_target_note_id and user_id = auth.uid();

  -- 批注与建议跟随区块移动，避免在源笔记留下不可见的孤儿锚点。
  update note_comment_threads
  set note_id = p_target_note_id
  where note_id = p_source_note_id and block_id = p_block_id and user_id = auth.uid();

  update note_suggestions
  set note_id = p_target_note_id
  where note_id = p_source_note_id and block_id = p_block_id and user_id = auth.uid();
end;
$$;
