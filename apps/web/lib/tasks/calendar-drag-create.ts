import { calendarDateOnly, isSameCalendarDay } from "./calendar-agenda";

/**
 * 月格 / 全天行空白拖选新建跨天全天事件的纯几何与归一函数。
 * 全部按本地日期比较，不带时刻：拖选结果交给 initialCalendarSchedule 以 allDay 归一到
 * 开始日 00:00 与结束日 23:59。
 */

/** 拖选起点超过该位移才视为拖动，否则按轻点处理（与月视图任务改期同阈值）。 */
export const DRAG_CREATE_MOVE_PX = 5;

export interface DragCreateDayRange {
  start: Date;
  end: Date;
}

/** 拖选锚点与当前目标归一为升序的本地日期（去掉时刻；反向拖选也得到 start <= end）。 */
export function dragCreateDayRange(anchor: Date, target: Date): DragCreateDayRange {
  const a = calendarDateOnly(anchor);
  const b = calendarDateOnly(target);
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function isDayInDragCreateRange(day: Date, range: DragCreateDayRange): boolean {
  const date = calendarDateOnly(day);
  return range.start <= date && date <= range.end;
}

/** 拖选过程中的即时文案：`10月22日 – 10月24日 全天`；单日只给 `10月22日 全天`。 */
export function dragCreateRangeLabel(range: DragCreateDayRange): string {
  const fmt = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`;
  if (isSameCalendarDay(range.start, range.end)) return `${fmt(range.start)} 全天`;
  const year = range.end.getFullYear() !== range.start.getFullYear() ? `${range.end.getFullYear()}年` : "";
  return `${fmt(range.start)} – ${year}${fmt(range.end)} 全天`;
}

export interface DragCreateRowRect {
  top: number;
  bottom: number;
}

/**
 * 指针纵坐标命中哪一周行。越过网格上缘夹到首行、越过下缘夹到末行，行间缝隙归上一行，
 * 这样拖出网格也不会丢失选区。没有任何可用行时返回 -1。
 */
export function dragCreateRowIndex(rows: ReadonlyArray<DragCreateRowRect | null | undefined>, clientY: number): number {
  let last = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const rect = rows[index];
    if (!rect) continue;
    if (clientY < rect.top) return last < 0 ? index : last;
    last = index;
    if (clientY < rect.bottom) return index;
  }
  return last;
}

/** 一周可见列（已按隐藏周末裁剪）中落在区间内的首尾列；该周不相交时返回 null。 */
export function dragCreateWeekColumns(week: readonly Date[], range: DragCreateDayRange): { startCol: number; endCol: number } | null {
  let startCol = -1;
  let endCol = -1;
  week.forEach((day, col) => {
    if (!isDayInDragCreateRange(day, range)) return;
    if (startCol < 0) startCol = col;
    endCol = col;
  });
  return startCol < 0 ? null : { startCol, endCol };
}

/** 两个矩形的并集，作为跨格 / 跨列拖选后创建卡的锚点。 */
export function unionRect(a: Pick<DOMRect, "x" | "y" | "width" | "height">, b: Pick<DOMRect, "x" | "y" | "width" | "height">): { x: number; y: number; width: number; height: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
