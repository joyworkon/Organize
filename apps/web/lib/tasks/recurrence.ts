/**
 * 重复任务下一次日期推进的纯函数（G2/任务3 月历改期 + 任务1 RPC 逻辑的可测镜像）。
 * 按时区推进，月末夹到末日、闰日夹到 2 月末。与 033 migration 的 complete_recurring_task 对齐。
 */
export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

/**
 * 给定一个开始日期 + frequency，返回下一次的开始日期。
 * 简化版（不处理 DST，DST 在 DB 层用 timestamptz 处理）。
 */
export function nextOccurrence(start: Date, freq: RecurrenceFrequency): Date {
  const d = new Date(start);
  switch (freq) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      // 月末夹到末日：如果原日期是 31 号，+1 月可能溢出（如 1/31 → 2/31 → 3/3）
      // 检测溢出：如果月份跳了 2 个月（如 1/31 → 3/3），夹回
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

/**
 * 判断 monthly 推进是否发生了月末溢出（如 1/31 → 3/3 而非 2/28）。
 * 如果溢出，夹到目标月的最后一天。
 */
export function clampMonthEnd(originalDay: number, targetDate: Date): Date {
  // 如果 originalDay 是 29/30/31，而 targetDate 的日期 < originalDay，
  // 说明月份溢出了（如 31 → 3 月 3 日），应夹到上月末
  if (originalDay > 28 && targetDate.getDate() < originalDay && targetDate.getDate() < 4) {
    // 夹到目标月的前一个月末
    const clamped = new Date(targetDate);
    clamped.setDate(0); // 上月最后一天
    return clamped;
  }
  return targetDate;
}
