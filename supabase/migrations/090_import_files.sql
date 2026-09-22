-- 090: 文件导入（阶段 D）——导入任务 / 逐文件结果 / 私有原件桶。
--
-- 三份内容分离（任务书 §八）：原始文件（import-files 桶）→ 提取正文（reading_items）
-- → 可选 AI 整理稿（既有 AI 链路，不动）。导入记录只存关联，不复制正文。
--
-- 隐私：import-files 为**私有**桶——公开分享阅读条目不会暴露原件
-- （对照 026 attachments 是公开桶，不能用于敏感原件）。
--
-- 执行机制（任务书 §八「不能依赖内存 Promise 冒充后台队列」）：
-- 解析在 POST 请求内同步完成（预算保证有界：≤6 文件 / ≤20MB / PDF ≤200 页 /
-- ≤50 工作表 / ≤10 万单元格 / 输出 ≤10 万字符），状态逐文件落库，
-- 刷新后经 GET /api/imports 恢复；重试用稳定 retry_key 幂等（唯一约束），
-- 重复提交/网络重试不产生重复资料。

-- ========== 私有原件桶 ==========
insert into storage.buckets (id, name, public)
values ('import-files', 'import-files', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload own import files" on storage.objects;
create policy "Users can upload own import files"
on storage.objects for insert
with check (
  bucket_id = 'import-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 仅本人可读原件（服务端生成短时签名 URL 供下载；不开放公共读）
drop policy if exists "Users can read own import files" on storage.objects;
create policy "Users can read own import files"
on storage.objects for select
using (
  bucket_id = 'import-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own import files" on storage.objects;
create policy "Users can delete own import files"
on storage.objects for delete
using (
  bucket_id = 'import-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ========== 导入任务（一批 = 一行）==========
create table if not exists public.import_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  -- processing（仍有文件未终态）/ saved（全部成功）/ partial（部分失败）/ failed（全部失败）
  status text not null default 'processing'
    check (status in ('processing', 'saved', 'partial', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_import_tasks_user_created
  on public.import_tasks(user_id, created_at desc);

create trigger update_import_tasks_updated_at
  before update on public.import_tasks
  for each row execute function update_updated_at_column();

alter table public.import_tasks enable row level security;

drop policy if exists "Users can read own import tasks" on public.import_tasks;
create policy "Users can read own import tasks"
  on public.import_tasks for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own import tasks" on public.import_tasks;
create policy "Users can insert own import tasks"
  on public.import_tasks for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own import tasks" on public.import_tasks;
create policy "Users can update own import tasks"
  on public.import_tasks for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own import tasks" on public.import_tasks;
create policy "Users can delete own import tasks"
  on public.import_tasks for delete
  using (auth.uid() = user_id);

-- ========== 逐文件结果（一个文件 = 一行，独立状态与错误，失败可单独重试）==========
create table if not exists public.import_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.import_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  file_name text not null,
  mime text not null default 'application/octet-stream',
  size bigint not null default 0,
  -- text | markdown | csv | json | pdf | docx | xlsx | image | audio
  kind text not null,
  storage_path text,                       -- import-files 桶内路径（原件；解析前为空）
  -- pending → uploading → parsing → saved | failed
  status text not null default 'pending'
    check (status in ('pending', 'uploading', 'parsing', 'saved', 'failed')),
  error text,                              -- 失败原因（用户可读；扫描型/加密/超限分别明示）
  reading_item_id uuid references public.reading_items(id) on delete set null,
  page_count integer,                      -- PDF 页数等提取元数据
  -- 稳定请求标识：客户端为「任务×文件」生成，重试复用同一键；唯一约束幂等
  retry_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, retry_key)
);

create index if not exists idx_import_files_task
  on public.import_files(task_id);
create index if not exists idx_import_files_user_created
  on public.import_files(user_id, created_at desc);

create trigger update_import_files_updated_at
  before update on public.import_files
  for each row execute function update_updated_at_column();

alter table public.import_files enable row level security;

drop policy if exists "Users can read own import files" on public.import_files;
create policy "Users can read own import files"
  on public.import_files for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own import files" on public.import_files;
create policy "Users can insert own import files"
  on public.import_files for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own import files" on public.import_files;
create policy "Users can update own import files"
  on public.import_files for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own import files" on public.import_files;
create policy "Users can delete own import files"
  on public.import_files for delete
  using (auth.uid() = user_id);

-- ========== 表级 GRANT（RLS 只管行级；缺 GRANT 一切写入 permission denied）==========
grant select, insert, update, delete on public.import_tasks to authenticated;
grant select, insert, update, delete on public.import_files to authenticated;
