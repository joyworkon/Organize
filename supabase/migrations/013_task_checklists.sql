-- 任务清单项（子任务）
create table if not exists task_checklists (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks on delete cascade not null,
  content text not null,
  is_completed boolean default false not null,
  sort_order integer default 0 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_checklists_task on task_checklists(task_id, sort_order);

alter table task_checklists enable row level security;

create policy "Users can view own checklists" on task_checklists
  for select using (exists (
    select 1 from tasks t where t.id = task_checklists.task_id and t.user_id = auth.uid()
  ));
create policy "Users can insert own checklists" on task_checklists
  for insert with check (exists (
    select 1 from tasks t where t.id = task_checklists.task_id and t.user_id = auth.uid()
  ));
create policy "Users can update own checklists" on task_checklists
  for update using (exists (
    select 1 from tasks t where t.id = task_checklists.task_id and t.user_id = auth.uid()
  ));
create policy "Users can delete own checklists" on task_checklists
  for delete using (exists (
    select 1 from tasks t where t.id = task_checklists.task_id and t.user_id = auth.uid()
  ));

create trigger update_checklists_updated_at
  before update on task_checklists
  for each row execute function update_updated_at_column();

grant all on task_checklists to anon, authenticated;
