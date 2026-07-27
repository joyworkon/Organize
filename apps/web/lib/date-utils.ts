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
