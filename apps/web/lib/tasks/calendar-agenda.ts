import type { CountdownDay, TaskWithTags } from "@organize/shared";

/**
 * 日历通用日期工具与手机议程/圆点的纯函数。
 * 全部按本地日期比较（与 layoutWeekSegments / tasksOnDay 同一口径），不用时刻切断：
 * 结束在次日零点的任务仍盖住次日。
 */

/** 日期键：`年-月(0 起)-日`，与月网格 / 倒数日映射共用。 */
export function calendarDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function calendarDateOnly(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isSameCalendarMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** 天差（对 DST 23/25 小时的天做四舍五入） */
export function calendarDayDiff(a: Date, b: Date): number {
  return Math.round((calendarDateOnly(a).getTime() - calendarDateOnly(b).getTime()) / 86400000);
}

export function shiftCalendarDay(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function getTaskDate(task: { schedule_start_at?: string | null; due_date?: string | null }): Date | null {
  const value = task.schedule_start_at || task.due_date;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 任务结束时刻；无 schedule_end_at 或非法时回落到开始时刻。 */
export function getTaskEnd(task: TaskWithTags): Date | null {
  const start = getTaskDate(task);
  const end = task.schedule_end_at ? new Date(task.schedule_end_at) : start;
  return end && !Number.isNaN(end.getTime()) ? end : start;
}

/** 42 格月网格（默认周一开头，含前后补位的非本月日期；weekStart=0 周日开头）。 */
export function getMonthCells(cursor: Date, weekStart: 0 | 1 = 1): { date: Date; inMonth: boolean }[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = offset; i > 0; i -= 1) cells.push({ date: new Date(year, month, 1 - i), inMonth: false });
  const days = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= days; day += 1) cells.push({ date: new Date(year, month, day), inMonth: true });
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
  }
  return cells;
}

/** 迷你月历按周切行，并裁掉整行都不在本月的尾行（保持紧凑，首行一定含本月日期）。 */
export function compactMonthRows(
  cells: { date: Date; inMonth: boolean }[],
  rowLength = 7
): { date: Date; inMonth: boolean }[][] {
  const rows: { date: Date; inMonth: boolean }[][] = [];
  for (let i = 0; i < cells.length; i += rowLength) rows.push(cells.slice(i, i + rowLength));
  while (rows.length > 1 && rows[rows.length - 1].every((cell) => !cell.inMonth)) rows.pop();
  return rows;
}

export interface AgendaEntry {
  task: TaskWithTags;
  /** 0 = 任务开始当天；>0 = 跨天任务的后续天 */
  spanIndex: number;
  /** 任务按本地日期覆盖的总天数（含首尾） */
  spanDays: number;
}

export interface AgendaDay {
  key: string;
  date: Date;
  entries: AgendaEntry[];
  countdowns: CountdownDay[];
}

function compareTasks(a: TaskWithTags, b: TaskWithTags): number {
  const time = (getTaskDate(a)?.getTime() || 0) - (getTaskDate(b)?.getTime() || 0);
  return time || a.sort_order - b.sort_order || a.id.localeCompare(b.id);
}

/**
 * 手机月议程：任务覆盖到的本月每一天都生成条目（含从上月延续进来、以及延续到下月的），
 * 与仅有倒数日的日期合并，按日期排序。条目内按 开始时刻 → sort_order → id 稳定排序，
 * 因此延续中的任务（开始更早）自然排在当天新开始的任务之前。
 * 传入的 tasks 应已包含重复任务的只读投影（projectRecurringTasks），这里不区分。
 */
export function buildMonthAgenda(
  tasks: TaskWithTags[],
  countdownsByDay: Map<string, CountdownDay[]>,
  cursor: Date
): AgendaDay[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const days = new Map<string, AgendaDay>();
  const dayFor = (date: Date): AgendaDay => {
    const key = calendarDayKey(date);
    let day = days.get(key);
    if (!day) {
      day = { key, date: calendarDateOnly(date), entries: [], countdowns: [] };
      days.set(key, day);
    }
    return day;
  };

  for (const task of tasks) {
    const start = getTaskDate(task);
    if (!start) continue;
    const first = calendarDateOnly(start);
    const endDay = calendarDateOnly(getTaskEnd(task) ?? start);
    const last = endDay < first ? first : endDay;
    if (last < monthStart || first > monthEnd) continue;
    const spanDays = calendarDayDiff(last, first) + 1;
    const from = first < monthStart ? monthStart : first;
    const to = last > monthEnd ? monthEnd : last;
    for (let cursorDay = from; cursorDay <= to; cursorDay = shiftCalendarDay(cursorDay, 1)) {
      dayFor(cursorDay).entries.push({ task, spanIndex: calendarDayDiff(cursorDay, first), spanDays });
    }
  }

  for (const [key, items] of countdownsByDay) {
    if (items.length === 0) continue;
    const [y, m, d] = key.split("-").map(Number);
    if (y !== year || m !== month) continue;
    dayFor(new Date(y, m, d)).countdowns = items;
  }

  return Array.from(days.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((day) => ({ ...day, entries: [...day.entries].sort((a, b) => compareTasks(a.task, b.task)) }));
}

/**
 * 把选中日按时间顺序插入议程（若该日已有分组则原样返回），
 * 让「点空日 → 看到该日空态行 + 添加按钮」与「滚到今天」共用一条滚动逻辑。
 * 选中日不在 cursor 月时不插入。
 */
export function withSelectedAgendaDay(agenda: AgendaDay[], selected: Date | null, cursor: Date): AgendaDay[] {
  if (!selected || !isSameCalendarMonth(selected, cursor)) return agenda;
  const key = calendarDayKey(selected);
  if (agenda.some((day) => day.key === key)) return agenda;
  const inserted: AgendaDay = { key, date: calendarDateOnly(selected), entries: [], countdowns: [] };
  const index = agenda.findIndex((day) => day.date.getTime() > inserted.date.getTime());
  return index === -1 ? [...agenda, inserted] : [...agenda.slice(0, index), inserted, ...agenda.slice(index)];
}

/**
 * 进入当前月时议程应滚到的分组：今天有安排就是今天，否则今天之后最近一个有安排的日期。
 * 不是当前月或之后没有安排时返回 null（调用方滚回顶部）。
 */
export function agendaScrollTargetKey(agenda: AgendaDay[], today: Date, cursor: Date): string | null {
  if (!isSameCalendarMonth(today, cursor)) return null;
  const todayTime = calendarDateOnly(today).getTime();
  return agenda.find((day) => day.date.getTime() >= todayTime)?.key ?? null;
}

export interface CalendarDayMarker {
  tasks: number;
  countdowns: number;
}

/**
 * 日期条 / 迷你月历每格的圆点计数：盖住当天的任务（含跨天首尾与重复投影）与当天倒数日。
 */
export function calendarDayMarkers(
  tasks: TaskWithTags[],
  countdownsByDay: Map<string, CountdownDay[]>,
  days: Date[]
): Map<string, CalendarDayMarker> {
  const result = new Map<string, CalendarDayMarker>();
  const targets = days.map((day) => ({ key: calendarDayKey(day), time: calendarDateOnly(day).getTime() }));
  for (const { key } of targets) {
    result.set(key, { tasks: 0, countdowns: countdownsByDay.get(key)?.length ?? 0 });
  }
  for (const task of tasks) {
    const start = getTaskDate(task);
    if (!start) continue;
    const end = getTaskEnd(task) ?? start;
    const first = calendarDateOnly(start).getTime();
    const last = Math.max(first, calendarDateOnly(end).getTime());
    for (const { key, time } of targets) {
      if (time >= first && time <= last) result.get(key)!.tasks += 1;
    }
  }
  return result;
}

/** 空月份「添加任务」的目标日：选中日在本月优先，其次今天在本月，否则本月 1 日。 */
export function emptyMonthAddDate(cursor: Date, today: Date, selected: Date | null): Date {
  if (selected && isSameCalendarMonth(selected, cursor)) return calendarDateOnly(selected);
  if (isSameCalendarMonth(today, cursor)) return calendarDateOnly(today);
  return new Date(cursor.getFullYear(), cursor.getMonth(), 1);
}
