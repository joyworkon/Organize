"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useIsNarrowViewport } from "@/components/canvas/use-is-narrow-viewport";
import {
  calendarDateOnly,
  calendarDayKey,
  calendarDayMarkers,
  compactMonthRows,
  isSameCalendarDay,
  isSameCalendarMonth,
  shiftCalendarDay,
} from "@/lib/tasks/calendar-agenda";
import { monthCellsForView, weekStartOf, type CalendarWeekStart } from "@/lib/tasks/calendar-view-options";
import { type CalendarJumpMode } from "@/lib/tasks/calendar-jump-date";
import { projectRecurringTasks } from "@/lib/tasks/recurring-occurrences";
import { annualOccurrenceDate } from "@/lib/tasks/countdown";
import { WEEKDAYS_SHORT, weekdayLabel } from "./calendar-shared";
import { cn } from "@/lib/utils";
import type { CountdownDay, TaskWithTags } from "@organize/shared";

const MONTH_NAMES = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

/** 与月视图 countdownsInRange 同口径的按日铺开（重复倒数日按年展开）；独立实现避免与 task-month-view 互相 import。 */
function countdownsForRange(countdowns: CountdownDay[], start: Date, end: Date): Map<string, CountdownDay[]> {
  const map = new Map<string, CountdownDay[]>();
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (const item of countdowns) {
    for (let year = from.getFullYear(); year <= to.getFullYear(); year += 1) {
      const occurrence = item.repeat_annually ? annualOccurrenceDate(item.target_date, year) : item.target_date;
      const [y, m, d] = occurrence.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      if (date < from || date > to) continue;
      const key = calendarDayKey(date);
      map.set(key, [...(map.get(key) || []), item]);
    }
  }
  return map;
}

/** 打开面板时月历先聚焦哪天：选中日在本月 → 选中日；今天在本月 → 今天；否则本月 1 日。 */
function initialFocusDate(viewMonth: Date, today: Date, selected: Date): Date {
  if (isSameCalendarMonth(selected, viewMonth)) return calendarDateOnly(selected);
  if (isSameCalendarMonth(today, viewMonth)) return calendarDateOnly(today);
  return new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
}

function findDayButton(grid: HTMLElement, date: Date): HTMLButtonElement | null {
  return grid.querySelector<HTMLButtonElement>(`[data-jump-day="${calendarDayKey(date)}"]`);
}

/** 聚焦目标日；隐藏周末时沿 direction 跳过无格子的周末继续找（direction 0 表示只查一次）。 */
function focusDay(grid: HTMLElement, date: Date, direction: -1 | 0 | 1): HTMLButtonElement | null {
  let current = date;
  for (let i = 0; i <= 7; i += 1) {
    const button = findDayButton(grid, current);
    if (button) {
      button.focus();
      return button;
    }
    if (direction === 0) return null;
    current = shiftCalendarDay(current, direction);
  }
  return null;
}

interface CalendarJumpDateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CalendarJumpMode;
  /** 当前视图 cursor；打开面板时月历从这里起步。 */
  cursor: Date;
  today: Date;
  selectedDate: Date;
  weekStart?: CalendarWeekStart;
  showWeekends?: boolean;
  /** 已过滤的排期任务（未做重复投影；面板按显示月自行投影）。 */
  tasks: TaskWithTags[];
  countdowns?: CountdownDay[];
  onSelectDate: (date: Date) => void;
  /** 触发器文案（顶栏标题）。 */
  children: ReactNode;
}

/**
 * 日历顶栏「跳转到日期」：点标题（或按 g）弹出迷你月历选日。
 * 桌面用 Popover 锚在标题下，手机窄屏用底部 Dialog（与快速新建同模式）；
 * 年视图先选年月再选日，其余模式直接月历。纯展示与选日回调，落点由调用方决定。
 */
export function CalendarJumpDate({
  open,
  onOpenChange,
  mode,
  cursor,
  today,
  selectedDate,
  weekStart = 1,
  showWeekends = true,
  tasks,
  countdowns = [],
  onSelectDate,
  children,
}: CalendarJumpDateProps) {
  const mobile = useIsNarrowViewport();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pick = (date: Date) => {
    onOpenChange(false);
    onSelectDate(date);
  };
  const body = (
    <JumpPanelBody
      mode={mode}
      cursor={cursor}
      today={today}
      selectedDate={selectedDate}
      weekStart={weekStart}
      showWeekends={showWeekends}
      tasks={tasks}
      countdowns={countdowns}
      onPick={pick}
    />
  );
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      data-calendar-jump-trigger=""
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-keyshortcuts="g"
      title="跳转到日期（g）"
      onClick={() => onOpenChange(!open)}
      /* h-6 与纯文本标题同高：顶栏高度不变（手机月议程的行位置对顶栏高度敏感） */
      className="-mx-1.5 flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{children}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );

  if (mobile) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent
            hideCloseButton
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus({ preventScroll: true });
            }}
            className="rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
            style={{ left: 0, top: "auto", bottom: 0, transform: "none", width: "100%", maxWidth: "none" }}
          >
            <DialogTitle className="sr-only">跳转到日期</DialogTitle>
            <div className="mx-auto w-fit">{body}</div>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{trigger}</PopoverAnchor>
      <PopoverContent
        align="start"
        collisionPadding={8}
        aria-label="跳转到日期"
        className="w-64 p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus({ preventScroll: true });
        }}
      >
        {body}
      </PopoverContent>
    </Popover>
  );
}

/** 面板内容（随弹层开合挂载/卸载，状态每次打开都从当前视图重新起步）。 */
function JumpPanelBody({
  mode,
  cursor,
  today,
  selectedDate,
  weekStart,
  showWeekends,
  tasks,
  countdowns,
  onPick,
}: {
  mode: CalendarJumpMode;
  cursor: Date;
  today: Date;
  selectedDate: Date;
  weekStart: CalendarWeekStart;
  showWeekends: boolean;
  tasks: TaskWithTags[];
  countdowns: CountdownDay[];
  onPick: (date: Date) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [viewMonth, setViewMonth] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  // 年视图先选年月再选日；点月份标签也能回到这一步。
  const [stage, setStage] = useState<"months" | "days">(mode === "year" ? "months" : "days");
  const cells = useMemo(() => monthCellsForView(viewMonth, weekStart, showWeekends), [viewMonth, weekStart, showWeekends]);
  const rows = useMemo(() => compactMonthRows(cells, showWeekends ? 7 : 5), [cells, showWeekends]);
  const weekdayHeaders = rows[0].map((cell) => WEEKDAYS_SHORT[(cell.date.getDay() + 6) % 7]);
  const markers = useMemo(() => {
    const first = cells[0]?.date ?? viewMonth;
    const last = cells[cells.length - 1]?.date ?? viewMonth;
    const projected = projectRecurringTasks(tasks, first, shiftCalendarDay(last, 1));
    return calendarDayMarkers(projected, countdownsForRange(countdowns, first, last), cells.map((cell) => cell.date));
  }, [tasks, countdowns, cells, viewMonth]);
  const monthsGridYear = viewMonth.getFullYear();
  const highlightedMonth = isSameCalendarMonth(selectedDate, viewMonth)
    ? selectedDate.getMonth()
    : isSameCalendarMonth(today, viewMonth)
      ? today.getMonth()
      : -1;

  // 打开 / 切回某一步时把焦点放进网格：天格 → 选中日或今天，月份格 → 当前月。
  // 只依赖 stage（挂载 + 阶段切换各跑一次）；翻月由 ‹ › 按钮持焦，不抢焦点。
  const latest = useRef({ viewMonth, today, selectedDate });
  latest.current = { viewMonth, today, selectedDate };
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const { viewMonth, today, selectedDate } = latest.current;
    if (stage === "months") {
      grid.querySelector<HTMLButtonElement>(`[data-jump-month="${viewMonth.getMonth()}"]`)?.focus();
      return;
    }
    focusDay(grid, initialFocusDate(viewMonth, today, selectedDate), 1);
  }, [stage]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const key = event.key;
    if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown" && key !== "Home" && key !== "End") return;
    const grid = gridRef.current;
    if (!grid) return;
    if (stage === "days") {
      const dayButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-jump-day]");
      if (!dayButton) return;
      const [y, m, d] = dayButton.dataset.jumpDay!.split("-").map(Number);
      const base = new Date(y, m, d);
      let target: Date;
      let direction: -1 | 0 | 1 = 0;
      if (key === "ArrowLeft") {
        target = shiftCalendarDay(base, -1);
        direction = -1;
      } else if (key === "ArrowRight") {
        target = shiftCalendarDay(base, 1);
        direction = 1;
      } else if (key === "ArrowUp") {
        target = shiftCalendarDay(base, -7);
      } else if (key === "ArrowDown") {
        target = shiftCalendarDay(base, 7);
      } else if (key === "Home") {
        target = weekStartOf(base, weekStart);
        direction = 1;
      } else {
        target = shiftCalendarDay(weekStartOf(base, weekStart), showWeekends ? 6 : 4);
        direction = -1;
      }
      if (focusDay(grid, target, direction)) event.preventDefault();
      return;
    }
    const monthButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-jump-month]");
    if (!monthButton) return;
    const index = Number(monthButton.dataset.jumpMonth);
    const next =
      key === "ArrowLeft" ? index - 1
      : key === "ArrowRight" ? index + 1
      : key === "ArrowUp" ? index - 3
      : key === "ArrowDown" ? index + 3
      : key === "Home" ? 0
      : 11;
    const button = grid.querySelector<HTMLButtonElement>(`[data-jump-month="${Math.max(0, Math.min(11, next))}"]`);
    if (button) {
      event.preventDefault();
      button.focus();
    }
  };

  const headerButton = "h-7 w-7";

  return (
    <div data-calendar-jump-panel="" className="text-sm" onKeyDown={handleKeyDown}>
      {stage === "months" ? (
        <>
          <div className="mb-2 flex items-center justify-between">
            <Button type="button" variant="ghost" size="icon" className={headerButton} aria-label="上一年" onClick={() => setViewMonth(new Date(monthsGridYear - 1, viewMonth.getMonth(), 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums">{monthsGridYear}年</span>
            <Button type="button" variant="ghost" size="icon" className={headerButton} aria-label="下一年" onClick={() => setViewMonth(new Date(monthsGridYear + 1, viewMonth.getMonth(), 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div ref={gridRef} className="grid grid-cols-3 gap-1">
            {MONTH_NAMES.map((name, month) => (
              <button
                key={name}
                type="button"
                data-jump-month={month}
                aria-pressed={month === highlightedMonth}
                onClick={() => {
                  setViewMonth(new Date(monthsGridYear, month, 1));
                  setStage("days");
                }}
                className={cn(
                  "h-9 rounded-md text-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  month === highlightedMonth ? "bg-primary font-medium text-primary-foreground" : "hover:bg-muted"
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <Button type="button" variant="ghost" size="icon" className={headerButton} aria-label="上一月" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              type="button"
              aria-label="选择月份"
              onClick={() => setStage("months")}
              className="rounded-md px-2 py-0.5 text-sm font-medium tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {viewMonth.getFullYear()}年{viewMonth.getMonth() + 1}月
            </button>
            <Button type="button" variant="ghost" size="icon" className={headerButton} aria-label="下一月" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div ref={gridRef} role="group" aria-label={`${viewMonth.getFullYear()}年${viewMonth.getMonth() + 1}月`}>
            <div className={cn("grid text-center text-xs text-muted-foreground", showWeekends ? "grid-cols-7" : "grid-cols-5")}>
              {weekdayHeaders.map((day, i) => <span key={`${day}-${i}`} className="py-1">{day}</span>)}
            </div>
            {rows.map((row) => (
              <div key={calendarDayKey(row[0].date)} className={cn("grid", showWeekends ? "grid-cols-7" : "grid-cols-5")}>
                {row.map(({ date, inMonth }) => {
                  const key = calendarDayKey(date);
                  const marker = inMonth ? markers.get(key) : undefined;
                  const isToday = isSameCalendarDay(date, today);
                  const selected = isSameCalendarDay(date, selectedDate);
                  const summary = [
                    marker && marker.tasks > 0 ? `${marker.tasks} 个任务` : "",
                    marker && marker.countdowns > 0 ? `${marker.countdowns} 个倒数日` : "",
                  ].filter(Boolean).join("，");
                  return (
                    <button
                      key={key}
                      type="button"
                      data-jump-day={key}
                      aria-pressed={selected}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdayLabel(date)}${isToday ? "，今天" : ""}${summary ? `，${summary}` : ""}`}
                      onClick={() => onPick(date)}
                      className={cn(
                        "relative mx-auto grid h-8 w-8 place-items-center rounded-full text-sm tabular-nums",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        inMonth ? "text-foreground" : "text-muted-foreground/70",
                        !selected && "hover:bg-muted",
                        selected && "bg-primary font-semibold text-primary-foreground",
                        isToday && "font-semibold",
                        isToday && !selected && "ring-1 ring-inset ring-primary"
                      )}
                    >
                      {date.getDate()}
                      {(marker && (marker.tasks > 0 || marker.countdowns > 0)) && (
                        <span className="absolute bottom-0.5 flex h-1 gap-px" aria-hidden="true">
                          {marker!.tasks > 0 && <span data-marker="task" className={cn("block h-1 w-1 rounded-full", selected ? "bg-primary-foreground" : "bg-primary")} />}
                          {marker!.countdowns > 0 && <span data-marker="countdown" className={cn("block h-1 w-1 rounded-full", selected ? "bg-primary-foreground" : "bg-muted-foreground")} />}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
