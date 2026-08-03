import type { CountdownDay } from "@organize/shared";

export interface CountdownDisplay {
  occurrenceDate: string;
  days: number;
  label: "今天" | "还有" | "已过";
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid date-only value: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function dateAtNoon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayAtNoon(now: Date): Date {
  return dateAtNoon(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 计算年度事件在某一年中的日期，非闰年 2 月 29 日按 2 月 28 日计算。 */
export function annualOccurrenceDate(targetDate: string, year: number): string {
  const { month, day } = parseDateOnly(targetDate);
  const clampedDay = Math.min(day, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

export function nextCountdownOccurrence(
  countdown: Pick<CountdownDay, "target_date" | "repeat_annually">,
  now = new Date()
): string {
  if (!countdown.repeat_annually) return countdown.target_date;
  const today = todayAtNoon(now);
  let occurrence = annualOccurrenceDate(countdown.target_date, now.getFullYear());
  if (dateAtNoon(...Object.values(parseDateOnly(occurrence)) as [number, number, number]) < today) {
    occurrence = annualOccurrenceDate(countdown.target_date, now.getFullYear() + 1);
  }
  return occurrence;
}

export function countdownDisplay(countdown: CountdownDay, now = new Date()): CountdownDisplay {
  const occurrenceDate = nextCountdownOccurrence(countdown, now);
  const occurrence = dateAtNoon(...Object.values(parseDateOnly(occurrenceDate)) as [number, number, number]);
  const today = todayAtNoon(now);
  const days = Math.round((occurrence.getTime() - today.getTime()) / 86400000);
  if (days === 0) return { occurrenceDate, days: 0, label: "今天" };
  return days > 0
    ? { occurrenceDate, days, label: "还有" }
    : { occurrenceDate, days: Math.abs(days), label: "已过" };
}

export function sortCountdownDays(days: CountdownDay[], now = new Date()): CountdownDay[] {
  return [...days].sort((a, b) => {
    const aDisplay = countdownDisplay(a, now);
    const bDisplay = countdownDisplay(b, now);
    const aPast = aDisplay.label === "已过" && !a.repeat_annually;
    const bPast = bDisplay.label === "已过" && !b.repeat_annually;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return aDisplay.occurrenceDate.localeCompare(bDisplay.occurrenceDate) || a.title.localeCompare(b.title);
  });
}

export function formatCountdownDate(value: string): string {
  const { year, month, day } = parseDateOnly(value);
  return `${year}年${month}月${day}日`;
}

