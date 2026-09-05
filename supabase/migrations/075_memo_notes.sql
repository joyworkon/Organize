-- R11：速记转笔记闭环。
-- 一条速记首版关联一个正式笔记（unique (user_id, memo_id)）；再次转换返回已有笔记（幂等）。
-- 服务端单事务完成：笔记（标题/正文）+ 来源关联 + #标签 → note tags 映射（upsert 既有规则：
-- 名称 trim 精确匹配、缺失创建，见 /api/notes/[id]/tags 的 onConflict user_id,name）。
-- 备份覆盖：restore_backup_v2_full 重定义（复制 058 主体 + memo_notes 落库块，仓库既有链式模式）。

-- ========== 关联表 ==========
create table if not exists memo_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  memo_id uuid references public.memos on delete cascade not null,
  note_id uuid references public.notes on delete cascade not null,
  created_at timestamptz default now() not null,
  -- 一条速记只关联一个正式笔记（转换幂等与「再次点击打开已有笔记」的数据库保证）
  constraint memo_notes_user_memo_unique unique (user_id, memo_id)
);

alter table memo_notes enable row level security;

create policy "Users can view own memo notes" on memo_notes
  for select using (auth.uid() = user_id);
create policy "Users can insert own memo notes" on memo_notes
  for insert with check (auth.uid() = user_id);
create policy "Users can delete own memo notes" on memo_notes
  for delete using (auth.uid() = user_id);

grant all on memo_notes to anon, authenticated;

-- ========== 转换 RPC（单事务，消除「先建空笔记再 update」的部分成功）==========
create or replace function public.convert_memo_to_note(p_memo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_memo public.memos%rowtype;
  v_existing_note_id uuid;
  v_new_note_id uuid;
  v_first_line text;
  v_title text;
  v_paragraphs jsonb;
  v_tag text;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  -- 软删除速记不可转换（deleted_at 非空 = 已移入垃圾箱语义，走恢复流程而非静默新建）
  select * into v_memo from public.memos
  where id = p_memo_id and user_id = v_user and deleted_at is null;
  if v_memo.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- 幂等：已转换过 → 返回既有笔记（再次点击=打开已有笔记）
  select note_id into v_existing_note_id
  from public.memo_notes where user_id = v_user and memo_id = p_memo_id;
  if v_existing_note_id is not null then
    return jsonb_build_object('status', 'exists', 'note_id', v_existing_note_id);
  end if;

  -- 标题：首个非空行截断 50 字符（剥掉行首 #标签标记的 # 号，保留文字）；正文完整保留（#标签保留在正文）
  v_first_line := split_lines_first_nonempty(v_memo.content);
  v_title := left(v_first_line, 50);

  select coalesce(jsonb_agg(jsonb_build_object('type', 'paragraph', 'content',
    jsonb_build_array(jsonb_build_object('type', 'text', 'text', line))) order by ord), '[{"type":"paragraph"}]'::jsonb)
  into v_paragraphs
  from (
    select line, ord
    from unnest(string_to_array(v_memo.content, E'\n')) with ordinality as t(line, ord)
    where btrim(line) <> ''
  ) s;

  insert into public.notes (user_id, title, content)
  values (v_user, v_title, jsonb_build_object('type', 'doc', 'content', v_paragraphs))
  returning id into v_new_note_id;

  insert into public.memo_notes (user_id, memo_id, note_id)
  values (v_user, p_memo_id, v_new_note_id);

  -- #标签 → note tags（与既有规则一致：trim 精确匹配 upsert；note_tags 幂等）
  foreach v_tag in array v_memo.tags loop
    if coalesce(btrim(v_tag), '') <> '' then
      insert into public.tags (user_id, name)
      values (v_user, btrim(v_tag))
      on conflict (user_id, name) do nothing;

      insert into public.note_tags (note_id, tag_id)
      select v_new_note_id, t.id
      from public.tags t
      where t.user_id = v_user and t.name = btrim(v_tag)
      on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object('status', 'created', 'note_id', v_new_note_id);
exception
  when unique_violation then
    -- 并发双击：另一请求已建立关联 → 返回既有笔记（等价幂等命中）
    select note_id into v_existing_note_id
    from public.memo_notes where user_id = v_user and memo_id = p_memo_id;
    if v_existing_note_id is not null then
      return jsonb_build_object('status', 'exists', 'note_id', v_existing_note_id);
    end if;
    raise;
end;
$$;

-- 辅助：取首个非空行（去首尾空白）
create or replace function public.split_lines_first_nonempty(p_text text)
returns text
language sql
stable
as $$
  select coalesce(btrim(line), '')
  from unnest(string_to_array(coalesce(p_text, ''), E'\n')) as t(line)
  where btrim(line) <> ''
  limit 1
$$;

revoke all on function public.convert_memo_to_note(uuid) from public, anon;
grant execute on function public.convert_memo_to_note(uuid) to authenticated, service_role;

-- ========== 备份恢复链扩展（复制 058 主体 + memo_notes 落库；链式模式与 027/058 一致）==========
create or replace function public.restore_backup_v2_full(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  restore_result jsonb;
  target_user uuid := auth.uid();
begin
  restore_result := public.restore_backup_v2_with_highlight_references(p_payload);
  if (restore_result->>'status') <> 'restored' then
    return restore_result;
  end if;

  -- memos：ID 已在客户端重映射，此处直接落库（tags 数组原样恢复）
  insert into public.memos (id, user_id, content, tags, deleted_at, created_at, updated_at)
  select row.id, target_user, row.content,
         coalesce(row.tags, '{}'::text[]), row.deleted_at, row.created_at, row.updated_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'memos', '[]'::jsonb)) as row(
    id uuid, content text, tags text[], deleted_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  ) on conflict (id) do nothing;

  -- task_item_refs：task_id/note_id 已重映射；唯一键 (note_id, block_id) 冲突跳过
  insert into public.task_item_refs (id, user_id, task_id, note_id, block_id, created_at)
  select row.id, target_user, row.task_id, row.note_id, row.block_id, row.created_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'task_item_refs', '[]'::jsonb)) as row(
    id uuid, task_id uuid, note_id uuid, block_id text, created_at timestamptz
  ) on conflict (id) do nothing;

  -- R11：memo_notes（memo_id/note_id 均已重映射；唯一键 (user_id, memo_id) 冲突跳过）
  insert into public.memo_notes (id, user_id, memo_id, note_id, created_at)
  select row.id, target_user, row.memo_id, row.note_id, row.created_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'memo_notes', '[]'::jsonb)) as row(
    id uuid, memo_id uuid, note_id uuid, created_at timestamptz
  ) on conflict do nothing;

  restore_result := jsonb_set(restore_result, '{counts,memos}',
    to_jsonb((select count(*) from public.memos where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,task_item_refs}',
    to_jsonb((select count(*) from public.task_item_refs where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,memo_notes}',
    to_jsonb((select count(*) from public.memo_notes where user_id = target_user)));

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_full(jsonb) from public;
grant execute on function public.restore_backup_v2_full(jsonb) to authenticated;
