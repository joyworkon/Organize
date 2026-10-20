/**
 * 重复任务下一次日期推进的纯函数（G2/任务3 月历改期 + 任务1 RPC 逻辑的可测镜像）。
 * 按时区推进，月末夹到末日、闰日夹到 2 月末。与 033 migration 的 complete_recurring_task 对齐。
 */
export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

/**
 * 给定一个开始日期 + frequency，返回下一次的开始日期。
 * 按浏览器本地墙钟推进（跨 DST 保持时分）；interval 默认 1，原有调用语义不变。
 */
export function nextOccurrence(start: Date, freq: RecurrenceFrequency, interval = 1): Date {
  const d = new Date(start);
  switch (freq) {
    case "daily":
      d.setDate(d.getDate() + interval);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7 * interval);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + interval);
      // 月末夹到末日：如果原日期是 31 号，+1 月可能溢出（如 1/31 → 2/31 → 3/3）
      // 检测溢出：如果月份跳了 2 个月（如 1/31 → 3/3），夹回
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + interval);
      break;
  }
  return d;
}

/**
 * 可见区间 [from, to) 内的后续发生，不含源日期。始终从原日期推进，避免
 * 1/31 → 2/28 → 3/28 漂移。跳到区间附近再展开，旧 daily 不需要逐日遍历。
 * interval 在持久化类型中固定为 1；这里允许正整数以独立验证推进算法。
 */
export function occurrencesBetween(
  start: Date,
  rule: { frequency: RecurrenceFrequency; interval: number },
  from: Date,
  to: Date,
  limit = 400
): Date[] {
  if (![start, from, to].every((date) => Number.isFinite(date.getTime())) || from >= to ||
      !Number.isSafeInteger(rule.interval) || rule.interval < 1 || !Number.isFinite(limit)) return [];
  const cap = Math.min(400, Math.max(0, Math.floor(limit)));
  let distance: number;
  switch (rule.frequency) {
    case "daily":
    case "weekly":
      distance = (Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000;
      if (rule.frequency === "weekly") distance /= 7;
      break;
    case "monthly":
      distance = (from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth();
      break;
    case "yearly":
      distance = from.getFullYear() - start.getFullYear();
      break;
    default:
      return [];
  }
  const dates: Date[] = [];
  for (let index = Math.max(1, Math.floor(distance / rule.interval) - 1); dates.length < cap; index++) {
    const advanced = nextOccurrence(start, rule.frequency, index * rule.interval);
    const date = rule.frequency === "monthly" || rule.frequency === "yearly"
      ? clampMonthEnd(start.getDate(), advanced) : advanced;
    if (!Number.isFinite(date.getTime()) || date >= to) break;
    if (date >= from) dates.push(date);
  }
  return dates;
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
