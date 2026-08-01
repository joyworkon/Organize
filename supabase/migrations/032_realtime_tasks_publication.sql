-- 032_realtime_tasks_publication.sql
-- G2 双向同步依赖 Realtime：把 tasks 与 task_item_refs 加入 supabase_realtime 发布。
-- 原因：之前项目的 supabase_realtime publication 是空的（puballtables=f，且无表），
-- 双链反向同步（任务→笔记）订阅 tasks UPDATE 收不到事件，导致任务页改状态笔记不回勾。
-- 幂等：IF NOT EXISTS 语义（重复执行不报错，Supabase 的 add table 若已在 publication
-- 里会报错，故用 DO 块捕获）。
do $$
begin
  -- tasks
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
  -- task_item_refs
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_item_refs'
  ) then
    alter publication supabase_realtime add table public.task_item_refs;
  end if;
end $$;
