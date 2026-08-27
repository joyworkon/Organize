-- 049 tasks INSERT 策略放宽：允许插入即带 deleted_at 的行
--
-- 背景（X1 离线删除 E2E 排查结论）：
-- 1. 直接 UPDATE 设置 deleted_at 会被 RLS 拒绝（42501）——这是 021 的有意设计：
--    UPDATE 时 SELECT 策略的 USING 会作为新行的隐式检查（更新后的行必须仍对
--    属主可见），因此「软删除必须走 mutate_trash RPC（security definer，
--    任务分支自带子树级联）」。任务页直接 update deleted_at 是前端 bug，
--    已改为调用 RPC，见同批前端修复。
-- 2. X1 离线「建后删」：离线创建任务后又删除，队列把 deleted_at 合入 create
--    载荷，回放为一次 INSERT。原 INSERT with check 要求新行 deleted_at IS NULL
--    会拒绝这种「创建即软删」的幂等回放——属正当载荷，放宽为仅校验属主。
--    （插入不要求新行满足 SELECT 可见性，放宽仅影响这一场景。）

drop policy if exists "Users can insert own tasks" on public.tasks;
create policy "Users can insert own tasks" on public.tasks
  for insert with check (auth.uid() = user_id);
