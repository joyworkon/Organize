-- 030_task_note_links.sql
-- G1 数据底座:任务↔笔记待办双向链接的表结构 + RLS + GRANT
-- 依据 docs/g0-protocol.md §6 数据模型

-- ========== 1. task_item_refs:引用关系 ==========
create table if not exists public.task_item_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete cascade not null,
  note_id uuid references public.notes(id) on delete cascade not null,
  block_id text not null,                 -- content 里 taskItem 的 attrs.id
  created_at timestamptz not null default now(),
  -- 一个笔记块最多引一个任务
  unique (note_id, block_id)
);

-- 索引:按任务查引用、按笔记查引用
create index if not exists idx_task_item_refs_task on public.task_item_refs(task_id);
create index if not exists idx_task_item_refs_note on public.task_item_refs(note_id);
create index if not exists idx_task_item_refs_user on public.task_item_refs(user_id);

-- ========== 2. tasks 新增列 ==========
alter table public.tasks add column if not exists reference_managed boolean not null default false;
alter table public.tasks add column if not exists sync_version integer not null default 0;
alter table public.tasks add column if not exists deleted_reason text;  -- 'orphaned' | 'manual' | null

-- deleted_reason 取值约束(允许 null,兼容历史)
alter table public.tasks add constraint tasks_deleted_reason_check
  check (deleted_reason is null or deleted_reason in ('orphaned', 'manual'));

-- ========== 3. notes 新增乐观锁列 ==========
alter table public.notes add column if not exists content_revision integer not null default 0;

-- ========== 4. save_mutation_log:原子保存 RPC 的幂等键 ==========
create table if not exists public.save_mutation_log (
  mutation_id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  result jsonb not null,                  -- RPC 返回值缓存(幂等重放用)
  created_at timestamptz not null default now()
);
create index if not exists idx_save_mutation_log_user on public.save_mutation_log(user_id, created_at desc);

-- ========== 5. task_item_refs RLS ==========
alter table public.task_item_refs enable row level security;
drop policy if exists "Users can view own task_item_refs" on public.task_item_refs;
drop policy if exists "Users can insert own task_item_refs" on public.task_item_refs;
drop policy if exists "Users can update own task_item_refs" on public.task_item_refs;
drop policy if exists "Users can delete own task_item_refs" on public.task_item_refs;
create policy "Users can view own task_item_refs" on public.task_item_refs
  for select using (auth.uid() = user_id);
create policy "Users can insert own task_item_refs" on public.task_item_refs
  for insert with check (auth.uid() = user_id);
create policy "Users can update own task_item_refs" on public.task_item_refs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own task_item_refs" on public.task_item_refs
  for delete using (auth.uid() = user_id);

-- save_mutation_log RLS(用户只能看自己的幂等记录)
alter table public.save_mutation_log enable row level security;
drop policy if exists "Users can view own mutations" on public.save_mutation_log;
drop policy if exists "Users can insert own mutations" on public.save_mutation_log;
create policy "Users can view own mutations" on public.save_mutation_log
  for select using (auth.uid() = user_id);
create policy "Users can insert own mutations" on public.save_mutation_log
  for insert with check (auth.uid() = user_id);

-- ========== 6. GRANT(沿用 003 模式) ==========
-- task_item_refs:RPC 用 security definer 绕过 RLS,但客户端也需直接读(批量加载引用);
-- 写入主要走 RPC,这里给 authenticated 基本权限(RLS 兜底)
grant select, insert, update, delete on public.task_item_refs to authenticated;
grant select on public.task_item_refs to anon;

-- save_mutation_log:仅 authenticated(RPC 内部 + 客户端查重)
grant select, insert on public.save_mutation_log to authenticated;

-- 新列的序列权限(若有);本迁移无新序列,跳过

-- ========== 7. 备份 schema 兼容 ==========
-- task_item_refs / 新列纳入备份恢复(restore_backup_v2_with_pages):
-- 见 031 RPC 与 lib/backup/schema.ts(G1 客户端侧)。
