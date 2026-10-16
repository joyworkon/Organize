"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Repeat2, Sun, X } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TaskRecurrenceRule } from "@organize/shared";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";

interface TaskDatePopoverProps {
  value: TaskSchedule;
  onChange: (value: TaskSchedule) => Promise<void> | void;
  trigger?: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  /** T03：默认触发器仅在任务真正逾期时标红；未来日期/已完成不再无条件红色 */
  overdue?: boolean;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const RECURRENCE_LABELS: Record<string, string> = {
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
  yearly: "每年",
};

function dateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localParts(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return { key: dateKey(new Date()), time: "09:00" };
  return { key: dateKey(date), time: date.toTimeString().slice(0, 5) };
}

function toIso(key: string, time: string) {
  const [hour, minute] = (time || "09:00").split(":").map(Number);
  const date = parseDateKey(key);
  date.setHours(hour || 0, minute || 0, 0, 0);
  return date.toISOString();
}

function monthCells(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const cells: Date[] = [];
  for (let i = offset; i > 0; i -= 1) {
    cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), 1 - i));
  }
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= days; day += 1) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    cells.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  return cells;
}

export function formatTaskDate(value: string | null | undefined) {
  if (!value) return "设置日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "设置日期";
  // T03：统一中文短日期；跨年补年份，非零点补时间（全天/零点不显示冗余时间）
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const datePart = sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
  if (!hasTime) return datePart;
  return `${datePart} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function TaskDatePopover({
  value,
  onChange,
  trigger,
  align = "end",
  side,
  className,
  overdue = false,
}: TaskDatePopoverProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"single" | "range">("single");
  const [draft, setDraft] = useState<TaskSchedule>(value);
  const [cursor, setCursor] = useState(() => new Date());
  const start = localParts(draft.schedule_start_at);
  const end = localParts(draft.schedule_end_at || draft.schedule_start_at);
  const cells = useMemo(() => monthCells(cursor), [cursor]);

  // 父组件每次渲染都会传入新的 value 对象（字面量构造），若直接放进依赖数组，
  // 弹窗开着时任何父级重渲染都会把草稿重置回旧值，导致选好的日期“存不上”。
  // 因此只在弹窗打开那一刻同步一次草稿，期间以本地 draft 为准。
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (!open) return;
    const current = valueRef.current;
    setDraft(current);
    setMode(current.schedule_end_at && current.schedule_end_at !== current.schedule_start_at ? "range" : "single");
    const base = current.schedule_start_at ? new Date(current.schedule_start_at) : new Date();
    setCursor(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [open]);

  const updateStart = (key: string, time = start.time) => {
    setDraft((current) => ({ ...current, schedule_start_at: toIso(key, time) }));
  };

  const updateEnd = (key: string, time = end.time) => {
    setDraft((current) => ({ ...current, schedule_end_at: toIso(key, time) }));
  };

  const chooseQuick = (days: number, time?: string) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const key = dateKey(date);
    const next = { ...draft, schedule_start_at: toIso(key, time || (draft.all_day ? "00:00" : "09:00")), schedule_end_at: null, all_day: !time };
    setDraft(next);
    setCursor(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const clear = async () => {
    const empty: TaskSchedule = { schedule_start_at: null, schedule_end_at: null, all_day: false, timezone: null, recurrence_rule: null };
    setDraft(empty);
    await onChange(empty);
    setOpen(false);
  };

  const apply = async () => {
    const next = { ...draft };
    if (next.schedule_start_at && mode === "single") next.schedule_end_at = null;
    if (next.schedule_start_at && next.schedule_end_at && new Date(next.schedule_end_at) < new Date(next.schedule_start_at)) {
      next.schedule_end_at = next.schedule_start_at;
    }
    if (next.all_day && next.schedule_start_at) {
      const startDate = localParts(next.schedule_start_at).key;
      next.schedule_start_at = toIso(startDate, "00:00");
      if (mode === "range" && next.schedule_end_at) next.schedule_end_at = toIso(localParts(next.schedule_end_at).key, "23:59");
    }
    next.timezone = next.schedule_start_at ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
    await onChange(next);
    setOpen(false);
  };

  const triggerNode = trigger || (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 md:min-h-8 items-center gap-1.5 rounded-lg px-2 py-1 text-sm transition-colors duration-100 motion-reduce:duration-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px] hover:bg-accent hover:text-accent-foreground",
        overdue ? "text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20" : "text-muted-foreground"
      )}
    >
      <CalendarDays className="h-4 w-4" />
      {formatTaskDate(value.schedule_start_at)}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{triggerNode}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className={cn(
          // M03：窄屏不超出视口（320px 也可完整显示），高度受视口约束
          "w-[min(360px,calc(100vw-1.5rem))] p-0 overflow-hidden flex flex-col max-h-[min(640px,calc(100dvh-1.5rem))]",
          className
        )}
        // Radix Portal 挂在 body 下，但 React 合成事件仍沿组件树冒泡：
        // 不拦截的话弹窗里的每次点击都会触发任务行的 onClick 打开详情
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="overflow-y-auto flex-1 min-h-0">
        <div className="flex rounded-xl bg-muted p-1 m-3 mb-2">
          <button type="button" onClick={() => setMode("single")} className={cn("min-h-11 md:min-h-8 flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100 motion-reduce:duration-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]", mode === "single" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>日期</button>
          <button type="button" onClick={() => setMode("range")} className={cn("min-h-11 md:min-h-8 flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100 motion-reduce:duration-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]", mode === "range" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>时间段</button>
        </div>

        <div className="flex items-center justify-around px-4 py-2 text-muted-foreground">
          <button type="button" onClick={() => chooseQuick(0)} title="今天" className="inline-flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]"><Sun className="h-5 w-5" /></button>
          <button type="button" onClick={() => chooseQuick(1)} title="明天" className="inline-flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]"><Sun className="h-5 w-5 opacity-70" /></button>
          <button type="button" onClick={() => chooseQuick(0, "20:00")} title="今晚" className="inline-flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]"><Clock3 className="h-5 w-5" /></button>
          <button type="button" onClick={() => setDraft((current) => ({ ...current, all_day: !current.all_day }))} title="全天" className={cn("inline-flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]", draft.all_day && "text-primary")}><CalendarDays className="h-5 w-5" /></button>
        </div>

        <div className="px-4 pb-2">
          <div className="flex items-center justify-between mb-2">
            <strong className="text-lg">{cursor.getFullYear()}年{cursor.getMonth() + 1}月</strong>
            <div className="flex gap-1">
              <button type="button" aria-label="上个月" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="inline-flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="下个月" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="inline-flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground mb-1">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {cells.map((date) => {
              const key = dateKey(date);
              const active = key === start.key || (mode === "range" && key === end.key);
              const inMonth = date.getMonth() === cursor.getMonth();
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => mode === "range" && draft.schedule_start_at ? updateEnd(key) : updateStart(key)}
                  className={cn("mx-auto grid h-11 w-full max-w-11 md:h-8 md:w-8 place-items-center rounded-full text-sm transition-colors duration-100 motion-reduce:duration-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]", !inMonth && "text-muted-foreground", active && "bg-primary text-primary-foreground", !active && "hover:bg-muted")}
                >{date.getDate()}</button>
              );
            })}
          </div>
        </div>

        <div className="border-t px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <input aria-label="开始日期" type="date" value={start.key} onChange={(event) => updateStart(event.target.value)} className="min-w-0 flex-1 bg-transparent" />
            {!draft.all_day && <input aria-label="开始时间" type="time" value={start.time} onChange={(event) => updateStart(start.key, event.target.value)} className="w-[92px] bg-transparent" />}
          </div>
          {mode === "range" && (
            <div className="flex items-center gap-2 text-sm">
              <Clock3 className="h-4 w-4 text-muted-foreground" />
              <input aria-label="结束日期" type="date" value={end.key} onChange={(event) => updateEnd(event.target.value)} className="min-w-0 flex-1 bg-transparent" />
              {!draft.all_day && <input aria-label="结束时间" type="time" value={end.time} onChange={(event) => updateEnd(end.key, event.target.value)} className="w-[92px] bg-transparent" />}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={draft.all_day} onChange={(event) => setDraft((current) => ({ ...current, all_day: event.target.checked }))} />全天</label>
          <div className="flex items-center gap-2 text-sm">
            <Repeat2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">重复</span>
            <select aria-label="重复规则" value={draft.recurrence_rule?.frequency || "none"} onChange={(event) => setDraft((current) => ({ ...current, recurrence_rule: event.target.value === "none" ? null : { frequency: event.target.value as TaskRecurrenceRule["frequency"], interval: 1 } }))} className="ml-auto bg-transparent">
              <option value="none">不重复</option>
              {Object.entries(RECURRENCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
        </div>

        </div>
        <div className="flex gap-2 border-t p-3 shrink-0">
          <button type="button" onClick={clear} className="min-h-11 md:min-h-8 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-100 motion-reduce:duration-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]"><X className="inline h-4 w-4 mr-1" />清除</button>
          <button type="button" onClick={apply} className="min-h-11 md:min-h-8 flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors duration-100 motion-reduce:duration-0 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]"><Check className="inline h-4 w-4 mr-1" />确定</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
