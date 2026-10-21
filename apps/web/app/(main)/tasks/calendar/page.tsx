"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { mutateTrash } from "@/lib/trash/client";
import { CalendarQuickCreate, type CalendarCreateRange, type CalendarCreatePreview } from "@/components/tasks/calendar-quick-create";
import { TaskMonthView } from "@/components/tasks/task-month-view";
import { TaskInlineDetail } from "@/components/tasks/task-inline-detail";
import type { SidebarSelection } from "@/components/tasks/task-sidebar";
import { useTaskWorkspaceData, filterTasksByScope } from "@/lib/tasks/workspace";
import { computeDragReschedule } from "@/lib/tasks/reschedule";
import { useTaskMutations } from "@/lib/tasks/use-task-mutations";
import { getTaskDependencyView } from "@/lib/tasks/dependencies";
import { COUNTDOWN_LOAD_ERROR_MESSAGE, nextCountdownDaysAfterLoad, type CountdownFormValue } from "@/lib/tasks/countdown";
import { isOnline } from "@/lib/offline/network";
import { addTaskDeadLetterEntry } from "@/lib/offline/task-dead-letter";
import type { PendingTaskOp } from "@/lib/offline/task-queue";
import { hasOpenDialog, useHotkey } from "@/lib/hooks/use-hotkey";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { CountdownDay, TaskWithTags } from "@organize/shared";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";

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
  const countdownLoadVersion = useRef(0);
  const pendingCountdowns = useRef(new Set<string>());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addRange, setAddRange] = useState<CalendarCreateRange | null>(null);
  const [createPreview, setCreatePreview] = useState<CalendarCreatePreview | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (!createdId) return;
    const timer = setTimeout(() => setCreatedId(null), 2000);
    return () => clearTimeout(timer);
  }, [createdId]);
  const closeCreate = useCallback(() => { setAddRange(null); setCreatePreview(null); }, []);
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
    const version = ++countdownLoadVersion.current;
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
    if (version !== countdownLoadVersion.current || pendingCountdowns.current.size) return;
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

  const mutateCountdown = useCallback(async (id: string, patch?: CountdownFormValue, optimistic = false): Promise<boolean> => {
    if (pendingCountdowns.current.has(id)) return false;
    const previous = countdownsRef.current.find((item) => item.id === id);
    if (!previous) return false;
    pendingCountdowns.current.add(id);
    ++countdownLoadVersion.current;
    const apply = (next: CountdownDay[]) => { countdownsRef.current = next; setCountdowns(next); };
    // 拖拽即刻反映；表单编辑/删除等服务端确认后再卸载，失败仍保住锚点与输入。
    if (patch && optimistic) apply(countdownsRef.current.map((item) => item.id === id ? { ...item, ...patch } : item));
    try {
      if (patch || process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
        const result = await supabase.from("countdown_days")
          .update(patch ?? { deleted_at: new Date().toISOString() }).eq("id", id);
        if (result.error) throw result.error;
      } else {
        const affected = await mutateTrash("countdown", [id], "soft_delete");
        if (!affected) throw new Error("倒数日未删除，请重试");
      }
      if (patch && !optimistic) apply(countdownsRef.current.map((item) => item.id === id ? { ...item, ...patch } : item));
      if (!patch) apply(countdownsRef.current.filter((item) => item.id !== id));
      toast({ title: patch ? "倒数日已更新" : "倒数日已移入垃圾箱" });
      return true;
    } catch (error) {
      if (patch && optimistic) apply(countdownsRef.current.map((item) => item.id === id ? previous : item));
      toast({ title: patch ? "保存失败" : "删除失败", description: (error as { message?: string })?.message, variant: "destructive" });
      return false;
    } finally {
      pendingCountdowns.current.delete(id);
      ++countdownLoadVersion.current;
      // 成功/回滚后统一重载；最后一个并发写入完成时查询包含全部最终结果。
      window.dispatchEvent(new CustomEvent("organize:countdown-changed"));
    }
  }, [supabase]);

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
          onUpdateCountdown={mutateCountdown}
          onDeleteCountdown={(id) => mutateCountdown(id)}
          onTaskClick={(task) => updateUrl({ task: task.id })}
          onRescheduleTask={rescheduleTask}
          onUpdateTaskSchedule={updateTaskSchedule}
          createPreview={createPreview}
          createdId={createdId}
          onDateClick={(start, end, anchor) => {
            if (addRange) return; // An in-flight create keeps its original range and anchor.
            // 详情打开时，点日历空白只关闭面板，与 ✕ / Esc 一样回到当前视图。
            if (selectedTaskId) {
              closeTask();
              return;
            }
            setAddRange({ start, end, anchor });
          }}
        />
        {addRange && <CalendarQuickCreate
          range={addRange}
          onClose={closeCreate}
          onPreviewChange={setCreatePreview}
          onTaskCreated={(task: TaskWithTags, more) => {
            setTasks((current) => [...current.filter((item) => item.id !== task.id), task]);
            setCreatedId(task.id);
            // A chosen list/date may fall outside the current sidebar scope.
            // Reveal the saved event in its destination instead of silently hiding it.
            const patch: Record<string, string | null> = more ? { task: task.id } : {};
            if (!filterTasksByScope([task], selection).length) {
              patch.scope = task.list_id ? "list" : "all";
              patch.list = task.list_id ?? null;
            }
            if (Object.keys(patch).length) updateUrl(patch);
          }}
          onCountdownCreated={(day) => {
            const next = [...countdownsRef.current.filter((item) => item.id !== day.id), day];
            ++countdownLoadVersion.current;
            countdownsRef.current = next;
            setCountdowns(next);
            setCreatedId(day.id);
          }}
          supabase={supabase}
          lists={lists}
          defaultListId={selection.scope === "list" ? selection.listId : null}
        />}
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
