-- 任务手动排序字段
alter table tasks add column if not exists sort_order integer default 0 not null;
create index if not exists idx_tasks_sort on tasks(user_id, is_pinned desc, sort_order, created_at desc);
