-- 092: 主题集合（阶段 3）——速记、阅读条目、导入文件归入同一个「引用型」集合。
--
-- 语义（任务书 §三）：
--   - 集合只保存引用，不复制正文或原件：collection_items 只有坐标（来源 id），
--     标题/摘要在读取时 join 来源表实时取。
--   - 来源硬删除 → 外键 cascade 清引用行；软删除（回收站）→ 引用行保留，
--     读取时 available=false 显示「来源不可用」（join 条件显式 deleted_at is null）。
--   - 删除集合只 cascade 清引用行，绝不触碰来源。
--   - 同用户归属（沿 091 口径）：collection_items 的三个来源列 + 集合列全部是
--     含 user_id 的复合外键——知道另一账号的 ID 也不能把他人资料挂进自己的集合。
--   - 每来源 (collection_id, 来源id) 唯一：重复加入幂等（不加第二行）。
--   - 三选一 check：reading_item_id / memo_id / import_file_id 恰有一个非空。

-- ========== 集合 ==========
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_collections_user_created
  on public.collections(user_id, created_at desc);

create unique index if not exists collections_id_user_key
  on public.collections (id, user_id);

create trigger update_collections_updated_at
  before update on public.collections
  for each row execute function update_updated_at_column();

alter table public.collections enable row level security;

drop policy if exists "Users can read own collections" on public.collections;
create policy "Users can read own collections"
  on public.collections for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own collections" on public.collections;
create policy "Users can insert own collections"
  on public.collections for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own collections" on public.collections;
create policy "Users can update own collections"
  on public.collections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own collections" on public.collections;
create policy "Users can delete own collections"
  on public.collections for delete
  using (auth.uid() = user_id);

-- ========== 集合引用行 ==========
create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  -- 三选一（check 锁定）；复合外键锁定同用户归属
  reading_item_id uuid references public.reading_items(id) on delete cascade,
  memo_id uuid references public.memos(id) on delete cascade,
  import_file_id uuid references public.import_files(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (
    ((reading_item_id is not null)::int
     + (memo_id is not null)::int
     + (import_file_id is not null)::int) = 1
  )
);

-- 复合外键的引用目标
create unique index if not exists reading_items_id_user_key_092
  on public.reading_items (id, user_id);
create unique index if not exists memos_id_user_key
  on public.memos (id, user_id);
create unique index if not exists import_files_id_user_key
  on public.import_files (id, user_id);
create unique index if not exists collection_items_id_user_key
  on public.collection_items (id, user_id);

-- 同用户归属：集合
alter table public.collection_items
  drop constraint if exists collection_items_collection_id_user_id_fkey;
alter table public.collection_items
  add constraint collection_items_collection_id_user_id_fkey
  foreign key (collection_id, user_id)
  references public.collections (id, user_id)
  on delete cascade;

-- 同用户归属：三个来源（硬删 cascade；091 已建 reading_items (id, user_id) 唯一索引）
alter table public.collection_items
  drop constraint if exists collection_items_reading_item_id_user_id_fkey;
alter table public.collection_items
  add constraint collection_items_reading_item_id_user_id_fkey
  foreign key (reading_item_id, user_id)
  references public.reading_items (id, user_id)
  on delete cascade;

alter table public.collection_items
  drop constraint if exists collection_items_memo_id_user_id_fkey;
alter table public.collection_items
  add constraint collection_items_memo_id_user_id_fkey
  foreign key (memo_id, user_id)
  references public.memos (id, user_id)
  on delete cascade;

alter table public.collection_items
  drop constraint if exists collection_items_import_file_id_user_id_fkey;
alter table public.collection_items
  add constraint collection_items_import_file_id_user_id_fkey
  foreign key (import_file_id, user_id)
  references public.import_files (id, user_id)
  on delete cascade;

-- 幂等：同集合同来源只一行（三列各自条件唯一；NULL 不参与唯一约束，恰好成立）
create unique index if not exists collection_items_collection_reading_key
  on public.collection_items (collection_id, reading_item_id)
  where reading_item_id is not null;
create unique index if not exists collection_items_collection_memo_key
  on public.collection_items (collection_id, memo_id)
  where memo_id is not null;
create unique index if not exists collection_items_collection_import_key
  on public.collection_items (collection_id, import_file_id)
  where import_file_id is not null;

create index if not exists idx_collection_items_collection_created
  on public.collection_items(collection_id, created_at desc);

create trigger update_collection_items_updated_at
  before update on public.collection_items
  for each row execute function update_updated_at_column();

alter table public.collection_items enable row level security;

drop policy if exists "Users can read own collection items" on public.collection_items;
create policy "Users can read own collection items"
  on public.collection_items for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own collection items" on public.collection_items;
create policy "Users can insert own collection items"
  on public.collection_items for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own collection items" on public.collection_items;
create policy "Users can update own collection items"
  on public.collection_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own collection items" on public.collection_items;
create policy "Users can delete own collection items"
  on public.collection_items for delete
  using (auth.uid() = user_id);

-- ========== GRANT / anon 收口（沿 090 约定）==========
grant select, insert, update, delete on public.collections to authenticated;
grant select, insert, update, delete on public.collection_items to authenticated;
revoke all on table public.collections from anon;
revoke all on table public.collection_items from anon;

-- ========== 集合条目查询 RPC（security invoker，RLS 自动隔离）==========
-- 返回引用行 + 实时来源快照（标题/摘要），软删来源 available=false（前端显示
-- 「来源不可用」）。file 来源透传 file_name 与（若有）reading_item_id。
-- 排序 ci.created_at DESC, ci.id DESC；游标二元组 (created_at, id)。
create or replace function public.collection_items_query(
  p_collection_id uuid,
  p_limit integer default 50,
  p_cursor_created timestamptz default null,
  p_cursor_id uuid default null,
  p_q text default null
)
returns table (
  id uuid,
  source_type text,
  source_id uuid,
  title text,
  excerpt text,
  available boolean,
  reading_item_id uuid,
  file_name text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    ci.id,
    ci.source_type,
    ci.source_id,
    ci.title,
    ci.excerpt,
    ci.available,
    ci.reading_item_id,
    ci.file_name,
    ci.created_at
  from (
    select
      ci0.id,
      'reading'::text as source_type,
      r.id as source_id,
      r.title as title,
      left(coalesce(r.excerpt, ''), 280) as excerpt,
      (r.id is not null) as available,
      r.id as reading_item_id,
      null::text as file_name,
      ci0.created_at
    from public.collection_items ci0
    left join public.reading_items r
      on r.id = ci0.reading_item_id and r.deleted_at is null
    where ci0.collection_id = p_collection_id
      and ci0.reading_item_id is not null

    union all

    select
      ci0.id,
      'memo'::text,
      m.id,
      null::text,
      left(m.content, 280),
      (m.id is not null),
      null::uuid,
      null::text,
      ci0.created_at
    from public.collection_items ci0
    left join public.memos m
      on m.id = ci0.memo_id and m.deleted_at is null
    where ci0.collection_id = p_collection_id
      and ci0.memo_id is not null

    union all

    select
      ci0.id,
      'file'::text,
      f.id,
      f.file_name,
      null::text,
      (f.id is not null),
      f.reading_item_id,
      f.file_name,
      ci0.created_at
    from public.collection_items ci0
    left join public.import_files f
      on f.id = ci0.import_file_id
    where ci0.collection_id = p_collection_id
      and ci0.import_file_id is not null
  ) ci
  where p_cursor_created is null
     or (
       ci.created_at < p_cursor_created
       or (ci.created_at = p_cursor_created and ci.id > p_cursor_id)
     )
  order by ci.created_at desc, ci.id asc
  limit case when p_limit between 1 and 200 then p_limit else 50 end;
$$;

revoke all on function public.collection_items_query(uuid, integer, timestamptz, uuid, text) from anon, authenticated;
grant execute on function public.collection_items_query(uuid, integer, timestamptz, uuid, text) to authenticated;

-- ========== 备份恢复链 v8（链式模式：复制 091 主体 + 集合两表）==========
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

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_full(jsonb) from public;
grant execute on function public.restore_backup_v2_full(jsonb) to authenticated;
