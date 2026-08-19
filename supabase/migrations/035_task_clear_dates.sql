-- 035 修复任务日期"清除"语义
--
-- 背景：033 的双向 trigger 无法区分"没碰这个字段"和"显式清空"：
--   - 只清 schedule_start_at（新路径）→ 旧 due_date 非空，被第一条规则回填，日期复活
--   - 只清 due_date（旧路径）→ schedule_start_at 非空，被第二条规则回填，同样复活
-- 结果：详情页"清除日期"刷新后日期复活；任何只 patch 部分字段的调用方都会踩中。
--
-- 修复：UPDATE 时先判断"显式清除"（OLD 非空 → NEW 为空且另一组字段未动），
-- 命中则三组字段（due_date / schedule_start_at / schedule_end_at）全部清空。

create or replace function public.sync_task_due_schedule() returns trigger as $$
begin
  if TG_OP = 'UPDATE' then
    -- 新路径清除：schedule_start_at 被显式清空 → 全部清空
    if new.schedule_start_at is null and old.schedule_start_at is not null then
      new.due_date := null;
      new.schedule_end_at := null;
      return new;
    end if;
    -- 旧路径清除：只把 due_date 置空且 schedule 字段未动 → 全部清空
    if new.due_date is null and old.due_date is not null
       and new.schedule_start_at is not distinct from old.schedule_start_at
       and new.schedule_end_at is not distinct from old.schedule_end_at then
      new.schedule_start_at := null;
      new.schedule_end_at := null;
      return new;
    end if;
  end if;

  -- 旧路径：只写了 due_date（schedule_start_at 没变/为空）→ 把 start 设为 due_date
  if new.due_date is not null and new.schedule_start_at is null then
    new.schedule_start_at := new.due_date;
  end if;
  -- 新路径：写了 schedule_start_at → due_date = coalesce(end, start)
  if new.schedule_start_at is not null then
    new.due_date := coalesce(new.schedule_end_at, new.schedule_start_at);
  end if;
  return new;
end; $$ language plpgsql security definer set search_path = pg_catalog, public;
