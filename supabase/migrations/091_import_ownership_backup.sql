-- 091: 导入数据归属约束 + 孤儿资产回收 + 备份恢复链 v7（阶段 2）。
--
-- 1) 归属约束（任务书 §二：知道另一个账号的 ID 也不能建立跨用户关联）：
--    import_files.task_id 原单列外键只指向 import_tasks.id，不校验属主——
--    知道他人 task_id 即可把自己的文件行挂到他人任务下。改为复合外键：
--      import_files (task_id, user_id) → import_tasks (id, user_id)
--    reading_item_id 同理（import_files.reading_item_id 单列外键可指向他人条目）：
--      import_files (reading_item_id, user_id) → reading_items (id, user_id)
--      ON DELETE SET NULL (reading_item_id)——阅读条目删除只置空该列，user_id 保持
--      （PG15 列级 SET NULL；其余列不动，文件行不消失）。
-- 2) 孤儿资产回收（任务书 §二：删除造成的孤儿资产）：import_files 行被删
--    （直接删或任务级联）时，删除 import-files 桶内该行资产
--    （原件 {uid}/{taskId}/{rowId}.* 与 DOCX 嵌入图 {rowId}-imgN.*，前缀匹配一并回收）。
--    重试覆盖写同一路径（upsert）不产生孤儿；恢复后重试的旧路径残留由 API 层
--    重试前清理（见 /api/imports POST）。
-- 3) restore_backup_v2_full 链式扩展（与 058/075/087 同模式）：import_tasks /
--    import_files 落库（备份 v7 起收录）。ID 均已在客户端重映射；user_id 统一
--    落 target_user，复合外键在 security definer 下仍然强制（跨用户关联不可能）。

-- ========== 0. 嵌入图资产清单列 ==========
-- DOCX 嵌入图（{rowId}-imgN.ext）此前只存在于桶内、无行级记录，备份打包无从扫描。
-- 导入时把每个上传成功的嵌入图路径记入 asset_paths，使其成为一等资产（可打包/可回收）。
alter table public.import_files
  add column if not exists asset_paths text[] not null default '{}';

-- ========== 1. 复合唯一索引（复合外键的引用目标）==========
create unique index if not exists import_tasks_id_user_key
  on public.import_tasks (id, user_id);
create unique index if not exists reading_items_id_user_key
  on public.reading_items (id, user_id);

-- ========== 2. import_files 外键改为同用户复合外键 ==========
alter table public.import_files
  drop constraint if exists import_files_task_id_fkey;
alter table public.import_files
  add constraint import_files_task_id_user_id_fkey
  foreign key (task_id, user_id)
  references public.import_tasks (id, user_id)
  on delete cascade;

alter table public.import_files
  drop constraint if exists import_files_reading_item_id_fkey;
alter table public.import_files
  add constraint import_files_reading_item_id_user_id_fkey
  foreign key (reading_item_id, user_id)
  references public.reading_items (id, user_id)
  on delete set null (reading_item_id);

-- ========== 3. 孤儿资产回收触发器 ==========
create or replace function public.delete_import_file_assets()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
begin
  -- storage.objects 挂有 protect_delete 触发器禁止直删（防误删孤儿对象）；
  -- 本函数是受控的服务端清理路径，经官方逃生门（事务局部设置）放行后删除。
  -- set_config 的 is_local=true：设置只在本事务内生效，不泄漏到后续语句。
  perform set_config('storage.allow_delete_query', 'true', true);
  -- 前缀 {uid}/{taskId}/{rowId} 同时命中原件（{rowId}.{ext}）与嵌入图（{rowId}-imgN.{ext}）；
  -- uuid 字符集不含 LIKE 通配符，拼接安全
  delete from storage.objects
  where bucket_id = 'import-files'
    and name like (old.user_id::text || '/' || old.task_id::text || '/' || old.id::text || '%');
  return old;
end;
$$;

drop trigger if exists delete_import_file_assets_trigger on public.import_files;
create trigger delete_import_file_assets_trigger
  before delete on public.import_files
  for each row execute function public.delete_import_file_assets();

-- ========== 4. restore_backup_v2_full 链式扩展（复制 087 主体 + import 两表）==========
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

  -- 085（idea-canvas）：画布文档结构 JSON 原样恢复（schemaVersion 由客户端校验保障）；
  -- revision 复位为 1，避免恢复后客户端以旧修订号发起 CAS。
  insert into public.canvas_documents (id, user_id, title, content, revision, deleted_at, created_at, updated_at)
  select row.id, target_user, coalesce(row.title, ''), row.content, 1,
         row.deleted_at, row.created_at, row.updated_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'canvas_documents', '[]'::jsonb)) as row(
    id uuid, title text, content jsonb, deleted_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  ) on conflict (id) do nothing;

  -- 091（备份 v7）：导入任务与逐文件记录。status 由客户端按文件现状归一后写入
  -- （备份时未完成的进行中状态恢复为 failed，可重试不伪造成功）。
  insert into public.import_tasks (id, user_id, status, created_at, updated_at)
  select row.id, target_user, row.status, row.created_at, row.updated_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'import_tasks', '[]'::jsonb)) as row(
    id uuid, status text, created_at timestamptz, updated_at timestamptz
  ) on conflict (id) do nothing;

  insert into public.import_files (
    id, task_id, user_id, file_name, mime, size, kind, storage_path, asset_paths,
    status, error, reading_item_id, page_count, retry_key, created_at, updated_at
  )
  select row.id, row.task_id, target_user, row.file_name, row.mime, row.size, row.kind,
         row.storage_path, coalesce(row.asset_paths, '{}'::text[]), row.status, row.error,
         row.reading_item_id, row.page_count, row.retry_key, row.created_at, row.updated_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'import_files', '[]'::jsonb)) as row(
    id uuid, task_id uuid, file_name text, mime text, size bigint, kind text,
    storage_path text, asset_paths text[], status text, error text, reading_item_id uuid,
    page_count integer, retry_key text, created_at timestamptz, updated_at timestamptz
  ) on conflict (id) do nothing;

  -- 088 引入的 notes.page_template 回填（087 主体没有这一步，链式覆写必须携带）：
  -- 深层链插入 notes 时不带 page_template，这里按载荷补齐；只更新恢复者自己的行
  update public.notes n
  set page_template = case when row.page_template = 'red-blue' then 'red-blue' else 'default' end
  from jsonb_to_recordset(coalesce(p_payload->'data'->'notes', '[]'::jsonb)) as row(id uuid, page_template text)
  where n.id = row.id and n.user_id = target_user;

  restore_result := jsonb_set(restore_result, '{counts,memos}',
    to_jsonb((select count(*) from public.memos where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,task_item_refs}',
    to_jsonb((select count(*) from public.task_item_refs where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,memo_notes}',
    to_jsonb((select count(*) from public.memo_notes where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,canvas_documents}',
    to_jsonb((select count(*) from public.canvas_documents where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,import_tasks}',
    to_jsonb((select count(*) from public.import_tasks where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,import_files}',
    to_jsonb((select count(*) from public.import_files where user_id = target_user)));

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_full(jsonb) from public;
grant execute on function public.restore_backup_v2_full(jsonb) to authenticated;
