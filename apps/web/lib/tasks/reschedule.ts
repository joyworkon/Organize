/**
 * 月历拖拽改期的时间计算（纯函数）。
 *
 * 以"原开始时刻"为锚把整段日程平移到目标日期：保留持续时长，
 * 避免只平移 start 导致 end < start 触发 tasks_schedule_order_check
 * 约束（033），或 due_date 被 trigger 用旧 end 覆盖。
 */
export function computeDragReschedule(opts: {
  /** 原开始（ISO 字符串或 null） */
  schedule_start_at: string | null;
  /** 原结束（ISO 字符串或 null） */
  schedule_end_at: string | null;
  /** 目标开始时间（月历已按原墙钟时分拼好的目标日期） */
  target: Date;
}): { schedule_start_at: string; schedule_end_at: string | null } {
  const { schedule_start_at, schedule_end_at, target } = opts;
  const oldStart = schedule_start_at ? new Date(schedule_start_at).getTime() : null;
  const oldEnd = schedule_end_at ? new Date(schedule_end_at).getTime() : null;
  const duration =
    oldStart !== null && oldEnd !== null && oldEnd >= oldStart
      ? oldEnd - oldStart
      : null;
  return {
    schedule_start_at: target.toISOString(),
    schedule_end_at: duration !== null ? new Date(target.getTime() + duration).toISOString() : null,
  };
}
