export function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;

  if (startOfDate.getTime() === startOfToday.getTime()) {
    if (hasTime) {
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      return `今天 ${hours}:${minutes}`;
    }
    return "今天";
  }

  if (startOfDate.getTime() === startOfTomorrow.getTime()) {
    if (hasTime) {
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      return `明天 ${hours}:${minutes}`;
    }
    return "明天";
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (hasTime) {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${month}月${day}日 ${hours}:${minutes}`;
  }

  return `${month}月${day}日`;
}

export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

export function getDueDateColorClass(
  dueDateStr: string | null | undefined,
  status: string
): string {
  if (status === "done" || status === "cancelled") {
    return "text-muted-foreground line-through";
  }

  if (!dueDateStr) {
    return "text-muted-foreground";
  }

  const dueDate = new Date(dueDateStr);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfDueDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

  if (dueDate < now && startOfDueDate.getTime() < startOfToday.getTime()) {
    return "text-destructive font-medium";
  }

  if (startOfDueDate.getTime() === startOfToday.getTime()) {
    return "text-orange-500 font-medium dark:text-orange-400";
  }

  if (startOfDueDate.getTime() === startOfTomorrow.getTime()) {
    return "text-amber-600 dark:text-amber-500";
  }

  return "text-muted-foreground";
}

/**
 * 相对时间格式化（「X 前」），用于动态视图等活动流。
 * - < 1 分钟 → "刚刚"
 * - < 1 小时 → "X 分钟前"
 * - < 24 小时 → "X 小时前"
 * - < 48 小时 → "昨天"
 * - < 7 天 → "X 天前"（从 2 起）
 * - ≥ 7 天 → "M月D日"
 * - 非法/无法解析 → ""（UI 侧不显示）
 *
 * @param iso ISO 字符串（如 DatabaseRow.updated_at）
 * @param now 当前时间戳（毫秒），默认 Date.now()；测试可注入固定值
 */
export function formatTimeAgo(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";

  const diff = now - t; // 毫秒；负值（未来时间）当作"刚刚"
  if (diff < 60_000) return "刚刚";

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  if (hours < 48) return "昨天";

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;

  // ≥ 7 天：回退绝对日期 M月D日（用本地时区）
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

