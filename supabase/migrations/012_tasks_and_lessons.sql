-- 任务和经验总结功能
-- 新增表：tasks（任务）、lessons（经验总结）、task_tags（任务-标签）、lesson_tags（经验-标签）

-- 任务表
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  description text,
  status text default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')) not null,
  priority text default 'medium' check (priority in ('high', 'medium', 'low')) not null,
  category text default 'work' check (category in ('work', 'study', 'life')) not null,
  due_date timestamptz,
  estimated_minutes integer,
  actual_minutes integer,
  reading_item_id uuid references reading_items on delete set null,
  note_id uuid references notes on delete set null,
  is_pinned boolean default false not null,
  completed_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 经验总结表
create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  title text,
  content jsonb,
  lesson_type text default 'reflection' check (lesson_type in ('reflection', 'lesson', 'insight')) not null,
  task_id uuid references tasks on delete set null,
  reading_item_id uuid references reading_items on delete set null,
  note_id uuid references notes on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 任务-标签关联表
create table if not exists task_tags (
  task_id uuid references tasks on delete cascade,
  tag_id uuid references tags on delete cascade,
  primary key (task_id, tag_id)
);

-- 经验-标签关联表
create table if not exists lesson_tags (
  lesson_id uuid references lessons on delete cascade,
  tag_id uuid references tags on delete cascade,
  primary key (lesson_id, tag_id)
);

-- 索引
create index if not exists idx_tasks_user_id on tasks(user_id);
create index if not exists idx_tasks_status on tasks(user_id, status);
create index if not exists idx_tasks_category on tasks(user_id, category);
create index if not exists idx_tasks_due_date on tasks(user_id, due_date);
create index if not exists idx_tasks_pinned on tasks(user_id, is_pinned, created_at desc);
create index if not exists idx_lessons_user_id on lessons(user_id);
create index if not exists idx_lessons_type on lessons(user_id, lesson_type);
create index if not exists idx_lessons_task on lessons(task_id);
create index if not exists idx_task_tags_tag on task_tags(tag_id);
create index if not exists idx_lesson_tags_tag on lesson_tags(tag_id);

-- RLS
alter table tasks enable row level security;
alter table lessons enable row level security;
alter table task_tags enable row level security;
alter table lesson_tags enable row level security;

-- tasks RLS
create policy "Users can view own tasks" on tasks
  for select using (auth.uid() = user_id);
create policy "Users can insert own tasks" on tasks
  for insert with check (auth.uid() = user_id);
create policy "Users can update own tasks" on tasks
  for update using (auth.uid() = user_id);
create policy "Users can delete own tasks" on tasks
  for delete using (auth.uid() = user_id);

-- lessons RLS
create policy "Users can view own lessons" on lessons
  for select using (auth.uid() = user_id);
create policy "Users can insert own lessons" on lessons
  for insert with check (auth.uid() = user_id);
create policy "Users can update own lessons" on lessons
  for update using (auth.uid() = user_id);
create policy "Users can delete own lessons" on lessons
  for delete using (auth.uid() = user_id);

-- task_tags RLS：通过关联的task/user权限控制，但简化为用户可管理自己任务的标签
create policy "Users can view own task_tags" on task_tags
  for select using (exists (
    select 1 from tasks t where t.id = task_tags.task_id and t.user_id = auth.uid()
  ));
create policy "Users can insert own task_tags" on task_tags
  for insert with check (exists (
    select 1 from tasks t where t.id = task_tags.task_id and t.user_id = auth.uid()
  ));
create policy "Users can delete own task_tags" on task_tags
  for delete using (exists (
    select 1 from tasks t where t.id = task_tags.task_id and t.user_id = auth.uid()
  ));

-- lesson_tags RLS
create policy "Users can view own lesson_tags" on lesson_tags
  for select using (exists (
    select 1 from lessons l where l.id = lesson_tags.lesson_id and l.user_id = auth.uid()
  ));
create policy "Users can insert own lesson_tags" on lesson_tags
  for insert with check (exists (
    select 1 from lessons l where l.id = lesson_tags.lesson_id and l.user_id = auth.uid()
  ));
create policy "Users can delete own lesson_tags" on lesson_tags
  for delete using (exists (
    select 1 from lessons l where l.id = lesson_tags.lesson_id and l.user_id = auth.uid()
  ));

-- updated_at 触发器
create trigger update_tasks_updated_at
  before update on tasks
  for each row execute function update_updated_at_column();

create trigger update_lessons_updated_at
  before update on lessons
  for each row execute function update_updated_at_column();

-- 表级权限（参考 003 迁移，anon/authenticated 需要 GRANT）
grant all on tasks to anon, authenticated;
grant all on lessons to anon, authenticated;
grant all on task_tags to anon, authenticated;
grant all on lesson_tags to anon, authenticated;

-- 自增ID权限（如果使用serial，但这里用uuid不需要）
