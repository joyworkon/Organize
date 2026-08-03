"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  Filter,
  ListChecks,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { TagFilter } from "@/components/tags/tag-filter";
import type { SidebarSelection } from "@/components/tasks/task-sidebar";
import { TaskInlineDetail } from "@/components/tasks/task-inline-detail";
import { TaskDatePopover, formatTaskDate } from "@/components/tasks/task-date-popover";
import { toast } from "@/hooks/use-toast";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import type { TagWithCount, Task, TaskCategory, TaskStatus, TaskWithTags } from "@organize/shared";
import { TASK_CATEGORY_CONFIG, TASK_STATUS_CONFIG } from "@organize/shared";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";
import {
  fetchTaskWorkspace,
  filterTasksByScope,
  isOverdue,
  taskDate,
} from "@/lib/tasks/workspace";

type StatusFilter = "all" | TaskStatus;
type CategoryFilter = "all" | TaskCategory;
type TaskScope = SidebarSelection["scope"];

interface TaskRowProps {
  task: TaskWithTags;
  selected: boolean;
  listColor?: string | null;
  onOpen: () => void;
  onStatus: () => void;
  onDateChange: (value: TaskSchedule) => Promise<void>;
}

function TaskRow({ task, selected, listColor, onOpen, onStatus, onDateChange }: TaskRowProps) {
  const schedule: TaskSchedule = {
    schedule_start_at: task.schedule_start_at || task.due_date,
    schedule_end_at: task.schedule_end_at || null,
    all_day: Boolean(task.all_day),
    timezone: task.timezone || null,
    recurrence_rule: task.recurrence_rule || null,
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
      className={cn("group flex min-h-[74px] items-start gap-3 border-b px-5 py-3 text-left transition-colors hover:bg-muted/50", selected && "bg-muted", task.status === "done" && "text-muted-foreground")}
      style={{ borderLeft: `3px solid ${listColor || "transparent"}` }}
    >
      <button type="button" aria-label={task.status === "done" ? "标记未完成" : "标记完成"} onClick={(event) => { event.stopPropagation(); onStatus(); }} className={cn("mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-md border", task.status === "done" ? "border-muted bg-muted" : "border-muted-foreground/30 hover:border-primary")}>
        {task.status === "done" && <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[15px] font-medium", task.status === "done" && "line-through")}>{task.title}</div>
        {task.description && <div className="mt-1 truncate text-sm text-muted-foreground">- {task.description}</div>}
        {task.tags && task.tags.length > 0 && <div className="mt-1 flex gap-1 text-[11px] text-muted-foreground">{task.tags.slice(0, 3).map((tag) => <span key={tag.id}>#{tag.name}</span>)}</div>}
      </div>
      <TaskDatePopover
        value={schedule}
        onChange={onDateChange}
        align="end"
        trigger={<button type="button" onClick={(event) => event.stopPropagation()} className={cn("shrink-0 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground", isOverdue(taskDate(task)) && "text-red-500")}>{formatTaskDate(taskDate(task))}</button>}
      />
    </div>
  );
}

export default function TasksPage() {
  return <Suspense fallback={<div className="grid h-screen place-items-center text-muted-foreground">加载中…</div>}><TasksPageInner /></Suspense>;
}

function TasksPageInner() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { permission, requestPermission, scheduleDueDateReminders } = useNotifications();
  const [tasks, setTasks] = useState<TaskWithTags[]>([]);
  const [lists, setLists] = useState<import("@organize/shared").TaskList[]>([]);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const selectedTaskId = searchParams.get("task");
  const sidebarScope = (searchParams.get("scope") as TaskScope) || "all";
  const sidebarListId = searchParams.get("list");
  const sidebarSelection = useMemo<SidebarSelection>(() => ({ scope: sidebarScope, listId: sidebarScope === "list" ? sidebarListId : null }), [sidebarListId, sidebarScope]);
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) || null : null;

  const updateUrl = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => value === null ? params.delete(key) : params.set(key, value));
    params.delete("view");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const workspace = await fetchTaskWorkspace(supabase);
      setTags(workspace.tags);
      setLists(workspace.lists);
      setTasks(workspace.tasks);
      scheduleDueDateReminders(workspace.tasks);
    } finally {
      setLoading(false);
    }
  }, [scheduleDueDateReminders, supabase]);

  useEffect(() => { void fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    const reloadTasks = () => void fetchTasks();
    window.addEventListener("organize:tasks-changed", reloadTasks);
    return () => window.removeEventListener("organize:tasks-changed", reloadTasks);
  }, [fetchTasks]);

  useEffect(() => {
    if (searchParams.has("view")) updateUrl({ view: null });
  }, [searchParams, updateUrl]);

  useEffect(() => {
    if (!searchParams.get("scope") && lists[0]) updateUrl({ scope: "list", list: lists[0].id });
  }, [lists, searchParams, updateUrl]);

  const updateTask = useCallback(async (taskId: string, patch: Partial<Task>) => {
    const previous = tasks;
    const normalized = { ...patch } as Partial<Task>;
    if ("schedule_start_at" in normalized || "schedule_end_at" in normalized) normalized.due_date = normalized.schedule_end_at || normalized.schedule_start_at || null;
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, ...normalized } : task));
    const { error } = await supabase.from("tasks").update(normalized).eq("id", taskId);
    if (error) {
      setTasks(previous);
      toast({ title: "保存失败，已回滚", variant: "destructive" });
    }
  }, [supabase, tasks]);

  const deleteTask = useCallback(async (taskId: string) => {
    if (!window.confirm("将这个任务移入垃圾箱？")) return;
    const { error } = await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", taskId);
    if (error) { toast({ title: "删除失败", variant: "destructive" }); return; }
    updateUrl({ task: null });
    await fetchTasks();
    toast({ title: "任务已移入垃圾箱" });
  }, [fetchTasks, supabase, updateUrl]);

  const filteredTasks = useMemo(() => {
    const scoped = filterTasksByScope(tasks, sidebarSelection);
    return scoped.filter((task) => {
    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    if (categoryFilter !== "all" && task.category !== categoryFilter) return false;
    if (selectedTagIds.length && !(task.tags || []).some((tag) => selectedTagIds.includes(tag.id))) return false;
    return true;
    });
  }, [categoryFilter, selectedTagIds, sidebarSelection, statusFilter, tasks]);

  const activeTasks = filteredTasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const completedTasks = filteredTasks.filter((task) => task.status === "done");
  const listTitle = sidebarSelection.scope === "list" ? lists.find((list) => list.id === sidebarSelection.listId)?.name || "工作任务" : sidebarSelection.scope === "today" ? "今天" : sidebarSelection.scope === "upcoming" ? "最近7天" : sidebarSelection.scope === "completed" ? "已完成" : sidebarSelection.scope === "trash" ? "垃圾桶" : "全部任务";
  const currentList = lists.find((list) => list.id === sidebarSelection.listId);

  const openTask = (task: TaskWithTags) => updateUrl({ task: task.id });
  const closeTask = () => updateUrl({ task: null });
  const toggleStatus = (task: Task) => void updateTask(task.id, { status: task.status === "done" ? "todo" : "done", completed_at: task.status === "done" ? null : new Date().toISOString() });

  const quickAdd = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const title = event.currentTarget.value.trim();
    if (!title) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("tasks").insert({ user_id: user.id, title, status: "todo", priority: "medium", category: "work", list_id: sidebarSelection.scope === "list" ? sidebarSelection.listId : null });
    event.currentTarget.value = "";
    await fetchTasks();
    window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
  };

  return (
    <div className="organize-task-screen flex h-[calc(100vh-11rem)] min-h-0 w-full overflow-hidden rounded-lg border bg-background text-foreground md:h-[calc(100vh-6rem)]">
      <section className={cn("organize-task-list-pane flex min-w-0 flex-1 flex-col", selectedTask && "hidden md:flex")}>
        <header className="flex h-16 shrink-0 items-center gap-4 border-b px-5 md:px-8">
          <span className="text-2xl">{currentList?.icon || "📋"}</span>
          <h1 className="truncate text-xl font-semibold">{listTitle}</h1>
          <span className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="排序任务" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><ArrowDownUp className="h-5 w-5" /></button>
            <button type="button" aria-label="任务列表更多操作" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><MoreHorizontal className="h-5 w-5" /></button>
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[820px] px-4 pb-12 pt-5 md:px-8">
            <input aria-label="快速添加任务" onKeyDown={(event) => void quickAdd(event)} placeholder={`添加任务至“${listTitle}”，回车即可创建`} className="mb-6 h-14 w-full rounded-xl border-0 bg-muted/60 px-5 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20" />

            {permission === "default" && <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><span>开启浏览器通知以接收任务到期提醒</span><button type="button" onClick={() => requestPermission()} className="font-medium text-primary">开启</button></div>}

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}><SelectTrigger className="h-9 w-auto min-w-[112px]"><Filter className="mr-1 h-3.5 w-3.5" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(TASK_STATUS_CONFIG).map(([key, config]) => <SelectItem key={key} value={key}>{config.label}</SelectItem>)}</SelectContent></Select>
              <Select value={categoryFilter} onValueChange={(value: CategoryFilter) => setCategoryFilter(value)}><SelectTrigger className="h-9 w-auto min-w-[112px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部分类</SelectItem>{Object.entries(TASK_CATEGORY_CONFIG).map(([key, config]) => <SelectItem key={key} value={key}>{config.label}</SelectItem>)}</SelectContent></Select>
              <TagFilter options={tags} selectedIds={selectedTagIds} onChange={setSelectedTagIds} />
            </div>

            {loading ? <div className="grid place-items-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div> : filteredTasks.length === 0 ? <EmptyState icon={ListChecks} title="还没有任务" description="使用上方输入框，回车即可添加任务" /> : (
              <div className="overflow-hidden rounded-xl border bg-background">
                {activeTasks.length > 0 && <div className="flex items-center gap-2 border-b bg-muted/20 px-5 py-3 text-sm font-semibold"><ChevronDown className="h-4 w-4" />待办 <span className="text-xs font-normal text-muted-foreground">{activeTasks.length}</span></div>}
                {activeTasks.map((task) => <TaskRow key={task.id} task={task} selected={task.id === selectedTaskId} listColor={lists.find((list) => list.id === task.list_id)?.color} onOpen={() => openTask(task)} onStatus={() => toggleStatus(task)} onDateChange={(value) => updateTask(task.id, { schedule_start_at: value.schedule_start_at, schedule_end_at: value.schedule_end_at, due_date: value.schedule_end_at || value.schedule_start_at, all_day: value.all_day, timezone: value.timezone, recurrence_rule: value.recurrence_rule })} />)}
                {completedTasks.length > 0 && <div className="mt-4 flex items-center gap-2 border-y bg-muted/20 px-5 py-3 text-sm font-semibold"><ChevronDown className="h-4 w-4" />已完成 <span className="text-xs font-normal text-muted-foreground">{completedTasks.length}</span></div>}
                {completedTasks.map((task) => <TaskRow key={task.id} task={task} selected={task.id === selectedTaskId} listColor={lists.find((list) => list.id === task.list_id)?.color} onOpen={() => openTask(task)} onStatus={() => toggleStatus(task)} onDateChange={(value) => updateTask(task.id, { schedule_start_at: value.schedule_start_at, schedule_end_at: value.schedule_end_at, due_date: value.schedule_end_at || value.schedule_start_at, all_day: value.all_day, timezone: value.timezone, recurrence_rule: value.recurrence_rule })} />)}
              </div>
            )}
          </div>
        </div>
      </section>

      {selectedTask && <TaskInlineDetail task={selectedTask} lists={lists} onUpdate={updateTask} onDelete={deleteTask} onClose={closeTask} />}
    </div>
  );
}
