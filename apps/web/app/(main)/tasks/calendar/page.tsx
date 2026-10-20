"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskMonthView } from "@/components/tasks/task-month-view";
import { TaskInlineDetail } from "@/components/tasks/task-inline-detail";
import type { SidebarSelection } from "@/components/tasks/task-sidebar";
import { useTaskWorkspaceData, filterTasksByScope } from "@/lib/tasks/workspace";
import { computeDragReschedule } from "@/lib/tasks/reschedule";
import { useTaskMutations } from "@/lib/tasks/use-task-mutations";
import { getTaskDependencyView } from "@/lib/tasks/dependencies";
import { COUNTDOWN_LOAD_ERROR_MESSAGE, nextCountdownDaysAfterLoad } from "@/lib/tasks/countdown";
import { isOnline } from "@/lib/offline/network";
import { addTaskDeadLetterEntry } from "@/lib/offline/task-dead-letter";
import type { PendingTaskOp } from "@/lib/offline/task-queue";
import { hasOpenDialog, useHotkey } from "@/lib/hooks/use-hotkey";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { CountdownDay, TaskRecurrenceRule } from "@organize/shared";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";

const RECURRENCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
];

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface CalendarAddDialogProps {
  range: { start: Date; end?: Date } | null;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  supabase: ReturnType<typeof useTaskWorkspaceData>["supabase"];
  defaultListId: string | null;
}

/** 点击日历日期后弹出的快捷创建弹窗：任务 / 倒数日两个页签 */
function CalendarAddDialog({ range, onClose, onCreated, supabase, defaultListId }: CalendarAddDialogProps) {
  const date = range?.start;
  const [tab, setTab] = useState<"task" | "countdown">("task");
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [endNextDay, setEndNextDay] = useState(false);
  const [repeat, setRepeat] = useState("none");
  const [repeatAnnually, setRepeatAnnually] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (date) {
      setTab("task");
      setTitle("");
      setAllDay(false);
      // 网格总是传 end（含零点），只有普通日期入口回落到 09:00。
      const start = new Date(date);
      if (!range?.end && start.getHours() === 0 && start.getMinutes() === 0) start.setHours(9);
      const end = range?.end ?? new Date(start.getTime() + 60 * 60_000);
      const clock = (value: Date) => `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
      setTime(clock(start));
      setEndTime(clock(end));
      setEndNextDay(dateKey(start) !== dateKey(end));
      setRepeat("none");
      setRepeatAnnually(false);
    }
  }, [date, range]);

  if (!date) return null;

  const [hour, minute] = (allDay ? "00:00" : time).split(":").map(Number);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (endNextDay ? 1 : 0), endHour, endMinute);
  const timeError = tab === "task" && !allDay
    ? !time || !endTime ? "请填写开始和结束时间"
      : !(end.getTime() > start.getTime()) ? "结束时间需晚于开始时间" : null
    : null;

  const save = async () => {
    if (saving || timeError) return;
    const trimmed = title.trim();
    if (!trimmed) {
      toast({ title: "请填写标题", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");
      if (tab === "task") {
        const recurrence = repeat === "none" ? null : { frequency: repeat as TaskRecurrenceRule["frequency"], interval: 1 };
        const payload = {
          id: crypto.randomUUID(),
          user_id: user.id,
          title: trimmed,
          status: "todo",
          priority: "medium",
          category: "work",
          list_id: defaultListId,
          schedule_start_at: start.toISOString(),
          schedule_end_at: allDay ? null : end.toISOString(),
          due_date: start.toISOString(),
          all_day: allDay,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          recurrence_rule: recurrence,
        };
        const { error } = await supabase.from("tasks").insert(payload);
        if (error) throw error;
        window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
      } else {
        const payload = {
          user_id: user.id,
          title: trimmed,
          target_date: dateKey(date),
          repeat_annually: repeatAnnually,
        };
        const { error } = await supabase.from("countdown_days").insert(payload);
        if (error) throw error;
        window.dispatchEvent(new CustomEvent("organize:countdown-changed"));
      }
      toast({ title: tab === "task" ? "任务已添加" : "倒数日已添加" });
      onClose();
      await onCreated();
    } catch (error) {
      toast({ title: "添加失败", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{date.getMonth() + 1}月{date.getDate()}日 · 添加</DialogTitle>
          <DialogDescription>添加后会显示在日历对应日期上</DialogDescription>
        </DialogHeader>
        <div className="flex rounded-lg bg-muted p-1 text-sm">
          <Button type="button" variant="ghost" aria-pressed={tab === "task"} onClick={() => setTab("task")} className={`flex-1 ${tab === "task" ? "bg-background hover:bg-background" : "text-muted-foreground"}`}>任务</Button>
          <Button type="button" variant="ghost" aria-pressed={tab === "countdown"} onClick={() => setTab("countdown")} className={`flex-1 ${tab === "countdown" ? "bg-background hover:bg-background" : "text-muted-foreground"}`}>倒数日</Button>
        </div>
        <div className="space-y-4">
          <label className="block space-y-2 text-sm font-medium">
            标题
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={tab === "task" ? "例如：整理周报" : "例如：产品发布会"} autoFocus />
          </label>
          {tab === "task" ? (
            <>
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2"><Checkbox checked={allDay} onCheckedChange={(checked) => setAllDay(checked === true)} />全天</label>
              </div>
              {!allDay && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="min-w-0 space-y-2 text-sm">
                      <span>开始</span>
                      <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} aria-invalid={Boolean(timeError)} aria-describedby={timeError ? "calendar-time-error" : undefined} />
                    </label>
                    <label className="min-w-0 space-y-2 text-sm">
                      <span>结束{endNextDay ? "（次日）" : ""}</span>
                      <Input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} aria-invalid={Boolean(timeError)} aria-describedby={timeError ? "calendar-time-error" : undefined} />
                    </label>
                  </div>
                  {timeError && <p id="calendar-time-error" role="alert" className="text-sm text-destructive">{timeError}</p>}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <label htmlFor="calendar-repeat">重复</label>
                <Select value={repeat} onValueChange={setRepeat}>
                  <SelectTrigger id="calendar-repeat" className="ml-auto w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={repeatAnnually} onCheckedChange={(checked) => setRepeatAnnually(checked === true)} />每年重复</label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => void save()} disabled={saving || Boolean(timeError)}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}添加</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CalendarPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const clearTaskVersionsRef = useRef<() => void>(() => {});
  const { tasks, lists, dependencies, loading, refetch, setTasks, supabase } = useTaskWorkspaceData({
    onLoaded: () => clearTaskVersionsRef.current(),
  });
  const [countdowns, setCountdowns] = useState<CountdownDay[]>([]);
  const countdownsRef = useRef<CountdownDay[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addRange, setAddRange] = useState<{ start: Date; end?: Date } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const scope = (searchParams.get("scope") as SidebarSelection["scope"]) || "all";
  const selection = useMemo<SidebarSelection>(
    () => ({ scope, listId: scope === "list" ? searchParams.get("list") : null }),
    [scope, searchParams]
  );
  const visibleTasks = useMemo(
    () => filterTasksByScope(tasks, selection).filter((task) => !task.deleted_at),
    [selection, tasks]
  );
  const selectedTaskId = searchParams.get("task");
  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId && !task.deleted_at) ?? null
    : null;
  const selectedBlockingPrerequisites = useMemo(() => {
    if (!selectedTask) return [];
    return getTaskDependencyView(tasks, dependencies, selectedTask.id).blockingPrerequisites
      .map((task) => ({ id: task.id, title: task.title }));
  }, [dependencies, selectedTask, tasks]);

  const updateUrl = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => value === null ? params.delete(key) : params.set(key, value));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  const closeTask = useCallback(() => updateUrl({ task: null }), [updateUrl]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUserId(session.user.id);
    });
  }, [supabase]);

  const pushDeadLetter = useCallback((op: PendingTaskOp, error: unknown) => {
    if (!userId) return false;
    return addTaskDeadLetterEntry(localStorage, userId, { op, error }).persisted;
  }, [userId]);

  const { updateTask, deleteTask, clearTaskVersions } = useTaskMutations({
    supabase,
    userId,
    tasks,
    setTasks,
    refreshTasks: refetch,
    onDeleted: closeTask,
    pushDeadLetter,
  });
  clearTaskVersionsRef.current = clearTaskVersions;

  const loadCountdowns = useCallback(async () => {
    let data: readonly CountdownDay[] | null | undefined;
    let error: unknown = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const result = await supabase
        .from("countdown_days")
        .select("*")
        .eq("user_id", user.id)
        .is("deleted_at", null);
      data = result.data as CountdownDay[] | null;
      error = result.error;
    } catch (caughtError) {
      error = caughtError;
    }
    const plan = nextCountdownDaysAfterLoad({ previous: countdownsRef.current, data, error });
    countdownsRef.current = plan.days;
    setCountdowns(plan.days);
    setLoadError(plan.loadError);
    if (plan.loadError && isOnline()) {
      toast({ title: "倒数日加载失败", description: plan.loadError, variant: "destructive" });
    }
  }, [supabase]);

  useEffect(() => {
    void loadCountdowns();
    const reload = () => void loadCountdowns();
    window.addEventListener("organize:countdown-changed", reload);
    return () => window.removeEventListener("organize:countdown-changed", reload);
  }, [loadCountdowns]);

  const rescheduleTask = useCallback(
    async (taskId: string, date: Date) => {
      const task = tasks.find((item) => item.id === taskId);
      // 整段平移：保留时长，避免 end < start 违反 tasks_schedule_order_check
      const patch = computeDragReschedule({
        schedule_start_at: task?.schedule_start_at ?? task?.due_date ?? null,
        schedule_end_at: task?.schedule_end_at ?? null,
        target: date,
      });
      await updateTask(taskId, patch);
    },
    [tasks, updateTask]
  );

  const updateTaskSchedule = useCallback(
    async (taskId: string, schedule: TaskSchedule) => {
      await updateTask(taskId, {
        schedule_start_at: schedule.schedule_start_at,
        schedule_end_at: schedule.schedule_end_at,
        all_day: schedule.all_day,
        timezone: schedule.timezone,
        recurrence_rule: schedule.recurrence_rule,
      });
    },
    [updateTask]
  );

  useHotkey([
    {
      key: "escape",
      ctrlKey: false,
      metaKey: false,
      // 不默认 preventDefault：添加弹层、菜单和拖拽取消都要先收到 Esc。
      preventDefault: false,
      handler: (event) => {
        if (event.defaultPrevented || hasOpenDialog() || !selectedTaskId) return;
        event.preventDefault();
        closeTask();
      },
    },
  ]);

  return (
    <div className="organize-task-screen organize-calendar-screen relative flex min-h-0 w-full overflow-hidden bg-background text-foreground">
      <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", selectedTask && "hidden lg:flex")}>
        {/* 刷新时用遮罩而非卸载视图：保住周/月/日视图的内部状态（如当前模式与拖拽） */}
        {loading && (
          <div className="absolute inset-0 z-20 grid place-items-center rounded-lg bg-background/60">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
        {loadError && (
          <div className="mx-2 mt-2 flex shrink-0 items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2" role="alert">
            <p className="min-w-0 text-xs text-destructive">{COUNTDOWN_LOAD_ERROR_MESSAGE}</p>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => void loadCountdowns()}>
              重试
            </Button>
          </div>
        )}
        <TaskMonthView
          tasks={visibleTasks}
          countdowns={countdowns}
          onTaskClick={(task) => updateUrl({ task: task.id })}
          onRescheduleTask={rescheduleTask}
          onUpdateTaskSchedule={updateTaskSchedule}
          onDateClick={(start, end) => {
            // 详情打开时，点日历空白只关闭面板，与 ✕ / Esc 一样回到当前视图。
            if (selectedTaskId) {
              closeTask();
              return;
            }
            setAddRange({ start, end });
          }}
        />
        <CalendarAddDialog
          range={addRange}
          onClose={() => setAddRange(null)}
          onCreated={async () => {
            await Promise.all([refetch(), loadCountdowns()]);
          }}
          supabase={supabase}
          defaultListId={selection.scope === "list" ? selection.listId : null}
        />
      </div>
      {selectedTask && (
        <TaskInlineDetail
          task={selectedTask}
          lists={lists}
          onUpdate={updateTask}
          onDelete={deleteTask}
          onClose={closeTask}
          onOpenTask={(taskId) => updateUrl({ task: taskId })}
          onOpenFullPage={(taskId) => router.push(`/tasks/${taskId}`)}
          blockingPrerequisites={selectedBlockingPrerequisites}
        />
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="grid h-40 place-items-center text-muted-foreground"><CalendarDays className="mr-2 h-5 w-5 animate-pulse" />加载中…</div>}>
      <CalendarPageInner />
    </Suspense>
  );
}
