"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";
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
import { TaskMonthView } from "@/components/tasks/task-month-view";
import type { SidebarSelection } from "@/components/tasks/task-sidebar";
import { useTaskWorkspaceData, filterTasksByScope } from "@/lib/tasks/workspace";
import { computeDragReschedule } from "@/lib/tasks/reschedule";
import { toast } from "@/hooks/use-toast";
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
  date: Date | null;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  supabase: ReturnType<typeof useTaskWorkspaceData>["supabase"];
  defaultListId: string | null;
}

/** 点击日历日期后弹出的快捷创建弹窗：任务 / 倒数日两个页签 */
function CalendarAddDialog({ date, onClose, onCreated, supabase, defaultListId }: CalendarAddDialogProps) {
  const [tab, setTab] = useState<"task" | "countdown">("task");
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState("09:00");
  const [repeat, setRepeat] = useState("none");
  const [repeatAnnually, setRepeatAnnually] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (date) {
      setTab("task");
      setTitle("");
      setAllDay(false);
      setTime("09:00");
      setRepeat("none");
      setRepeatAnnually(false);
    }
  }, [date]);

  if (!date) return null;

  const save = async () => {
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
        const [hour, minute] = (allDay ? "00:00" : time).split(":").map(Number);
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour || 0, minute || 0);
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
          schedule_end_at: null,
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
          <button type="button" onClick={() => setTab("task")} className={`flex-1 rounded-md px-3 py-1.5 ${tab === "task" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>任务</button>
          <button type="button" onClick={() => setTab("countdown")} className={`flex-1 rounded-md px-3 py-1.5 ${tab === "countdown" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>倒数日</button>
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
                {!allDay && (
                  <label className="flex items-center gap-2">
                    时间
                    <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="w-[120px]" />
                  </label>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                重复
                <select value={repeat} onChange={(event) => setRepeat(event.target.value)} className="ml-auto rounded-md border bg-transparent px-2 py-1.5">
                  {RECURRENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </>
          ) : (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={repeatAnnually} onCheckedChange={(checked) => setRepeatAnnually(checked === true)} />每年重复</label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}添加</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CalendarPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tasks, loading, refetch, supabase } = useTaskWorkspaceData();
  const [countdowns, setCountdowns] = useState<CountdownDay[]>([]);
  const [addDate, setAddDate] = useState<Date | null>(null);
  const scope = (searchParams.get("scope") as SidebarSelection["scope"]) || "all";
  const selection = useMemo<SidebarSelection>(
    () => ({ scope, listId: scope === "list" ? searchParams.get("list") : null }),
    [scope, searchParams]
  );
  const visibleTasks = useMemo(
    () => filterTasksByScope(tasks, selection).filter((task) => !task.deleted_at),
    [selection, tasks]
  );

  const loadCountdowns = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("countdown_days")
      .select("*")
      .eq("user_id", user.id)
      .is("deleted_at", null);
    if (!error) setCountdowns((data || []) as CountdownDay[]);
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
      const { error } = await supabase
        .from("tasks")
        .update(patch)
        .eq("id", taskId);
      if (error) {
        toast({ title: "改期失败", variant: "destructive" });
        return;
      }
      await refetch();
      window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
    },
    [refetch, supabase, tasks]
  );

  const updateTaskSchedule = useCallback(
    async (taskId: string, schedule: TaskSchedule) => {
      const { error } = await supabase
        .from("tasks")
        .update({
          schedule_start_at: schedule.schedule_start_at,
          schedule_end_at: schedule.schedule_end_at,
          due_date: schedule.schedule_end_at || schedule.schedule_start_at,
          all_day: schedule.all_day,
          timezone: schedule.timezone,
          recurrence_rule: schedule.recurrence_rule,
        })
        .eq("id", taskId);
      if (error) {
        toast({ title: "改期失败", variant: "destructive" });
        return;
      }
      await refetch();
      window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
    },
    [refetch, supabase]
  );

  if (loading) {
    return (
      <div className="grid h-[calc(100vh-11rem)] place-items-center rounded-lg border bg-background text-muted-foreground md:h-[calc(100vh-6rem)]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="organize-task-screen flex h-[calc(100vh-11rem)] min-h-0 w-full flex-col overflow-hidden rounded-lg border bg-background text-foreground md:h-[calc(100vh-6rem)]">
      <TaskMonthView
        tasks={visibleTasks}
        countdowns={countdowns}
        onTaskClick={(task) => router.push(`/tasks/${task.id}`)}
        onRescheduleTask={rescheduleTask}
        onUpdateTaskSchedule={updateTaskSchedule}
        onDateClick={(date) => setAddDate(date)}
      />
      <CalendarAddDialog
        date={addDate}
        onClose={() => setAddDate(null)}
        onCreated={async () => {
          await Promise.all([refetch(), loadCountdowns()]);
        }}
        supabase={supabase}
        defaultListId={selection.scope === "list" ? selection.listId : null}
      />
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
