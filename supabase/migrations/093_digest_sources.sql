-- 093: 合并整理稿溯源（阶段 4）。
--
-- 整理稿 = 独立 reading_item（URN urn:organize:digest:{key}，key 为来源集合内容
-- 指纹）；本表记录「用了哪些来源、什么版本」：source_id + content_hash（生成时
-- 来源正文 sha256）。不外键 source_id（多态列），归属完整性由两条路径保证：
--   - digest_id 复合外键 (digest_id, user_id) → reading_items(id, user_id)：
--     只能往自己的整理稿名下挂溯源行（091 已建唯一索引）；
--   - 备份导出剪枝剔除来源不在导出集的溯源行（与 collection_items 同口径）。
-- 来源删除 → 溯源行保留（整理稿的可追溯性优先；读取端以 available 标注）。

create table if not exists public.digest_sources (
  id uuid primary key default gen_random_uuid(),
  digest_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  source_type text not null check (source_type in ('reading', 'memo', 'file')),
  source_id uuid not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (digest_id, source_type, source_id)
);

alter table public.digest_sources
  drop constraint if exists digest_sources_digest_id_user_id_fkey;
alter table public.digest_sources
  add constraint digest_sources_digest_id_user_id_fkey
  foreign key (digest_id, user_id)
  references public.reading_items (id, user_id)
  on delete cascade;

create index if not exists idx_digest_sources_digest
  on public.digest_sources(digest_id);

alter table public.digest_sources enable row level security;

drop policy if exists "Users can read own digest sources" on public.digest_sources;
create policy "Users can read own digest sources"
  on public.digest_sources for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own digest sources" on public.digest_sources;
create policy "Users can insert own digest sources"
  on public.digest_sources for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own digest sources" on public.digest_sources;
create policy "Users can update own digest sources"
  on public.digest_sources for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own digest sources" on public.digest_sources;
create policy "Users can delete own digest sources"
  on public.digest_sources for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.digest_sources to authenticated;
revoke all on table public.digest_sources from anon;

-- ========== 备份恢复链 v9（链式模式：复制 092 主体 + 整理稿溯源表）==========
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

  -- 085（idea-canvas）：画布文档结构 JSON 原样恢复；revision 复位为 1
  insert into public.canvas_documents (id, user_id, title, content, revision, deleted_at, created_at, updated_at)
  select row.id, target_user, coalesce(row.title, ''), row.content, 1,
         row.deleted_at, row.created_at, row.updated_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'canvas_documents', '[]'::jsonb)) as row(
    id uuid, title text, content jsonb, deleted_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  ) on conflict (id) do nothing;

  -- 091（备份 v7）：导入任务与逐文件记录（status 客户端已按文件现状归一）
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

  -- 092（备份 v8）：主题集合与引用行（来源 id 均已重映射；user_id 统一落恢复者）
  insert into public.collections (id, user_id, name, created_at, updated_at)
  select row.id, target_user, row.name, row.created_at, row.updated_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'collections', '[]'::jsonb)) as row(
    id uuid, name text, created_at timestamptz, updated_at timestamptz
  ) on conflict (id) do nothing;

  insert into public.collection_items (
    id, collection_id, user_id, reading_item_id, memo_id, import_file_id, created_at
  )
  select row.id, row.collection_id, target_user, row.reading_item_id, row.memo_id,
         row.import_file_id, row.created_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'collection_items', '[]'::jsonb)) as row(
    id uuid, collection_id uuid, reading_item_id uuid, memo_id uuid,
    import_file_id uuid, created_at timestamptz
  ) on conflict (id) do nothing;

  -- 093（备份 v9）：整理稿溯源行（digest_id/source_id 均已重映射；digest 归属
  -- 复合外键自动落到恢复者名下）。悬空来源行（来源不在备份内）由导出剪枝剔除。
  insert into public.digest_sources (id, digest_id, user_id, source_type, source_id, content_hash, created_at)
  select row.id, row.digest_id, target_user, row.source_type, row.source_id,
         row.content_hash, row.created_at
  from jsonb_to_recordset(coalesce(p_payload->'data'->'digest_sources', '[]'::jsonb)) as row(
    id uuid, digest_id uuid, source_type text, source_id uuid,
    content_hash text, created_at timestamptz
  ) on conflict (id) do nothing;

  -- 088 引入的 notes.page_template 回填（深层链插入 notes 时不带该列）
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
  restore_result := jsonb_set(restore_result, '{counts,collections}',
    to_jsonb((select count(*) from public.collections where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,collection_items}',
    to_jsonb((select count(*) from public.collection_items where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,digest_sources}',
    to_jsonb((select count(*) from public.digest_sources where user_id = target_user)));

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_full(jsonb) from public;
grant execute on function public.restore_backup_v2_full(jsonb) to authenticated;
