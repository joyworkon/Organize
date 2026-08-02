"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  LayoutGrid,
  List,
  ListChecks,
  Loader2,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { TagFilter } from "@/components/tags/tag-filter";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskSidebar, type SidebarSelection } from "@/components/tasks/task-sidebar";
import { TaskMonthView } from "@/components/tasks/task-month-view";
import { TaskInlineDetail } from "@/components/tasks/task-inline-detail";
import { TaskDatePopover, formatTaskDate } from "@/components/tasks/task-date-popover";
import { toast } from "@/hooks/use-toast";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import type { Tag, TagWithCount, Task, TaskCategory, TaskStatus, TaskWithTags } from "@organize/shared";
import { TASK_CATEGORY_CONFIG, TASK_STATUS_CONFIG } from "@organize/shared";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";

type ViewMode = "list" | "kanban" | "month";
type StatusFilter = "all" | TaskStatus;
type CategoryFilter = "all" | TaskCategory;
type TaskScope = SidebarSelection["scope"];

function taskDate(task: Task) {
  return task.schedule_start_at || task.due_date;
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function isOverdue(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value);
  return date < new Date() && !isSameDay(date, new Date());
}

function isWithinNextSevenDays(value: string | null | undefined) {
  if (!value) return false;
  const diff = (new Date(value).getTime() - Date.now()) / 86400000;
  return diff >= 0 && diff < 7;
}

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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [taskNavCollapsed, setTaskNavCollapsed] = useState(false);

  const viewMode = (searchParams.get("view") as ViewMode) || "list";
  const selectedTaskId = searchParams.get("task");
  const sidebarScope = (searchParams.get("scope") as TaskScope) || "all";
  const sidebarListId = searchParams.get("list");
  const sidebarSelection = useMemo<SidebarSelection>(() => ({ scope: sidebarScope, listId: sidebarScope === "list" ? sidebarListId : null }), [sidebarListId, sidebarScope]);
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) || null : null;

  const updateUrl = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => value === null ? params.delete(key) : params.set(key, value));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: taskData }, { data: listData }, { data: tagLinks }, { data: tagData }] = await Promise.all([
        supabase.from("tasks").select("*").eq("user_id", user.id).order("is_pinned", { ascending: false }).order("sort_order", { ascending: true }).order("created_at", { ascending: false }),
        supabase.from("task_lists").select("*").eq("user_id", user.id).order("sort_order", { ascending: true }).is("deleted_at", null),
        supabase.from("task_tags").select("task_id, tag_id"),
        supabase.from("tags").select("id, name, color").eq("user_id", user.id),
      ]);
      const loadedLists = (listData || []) as import("@organize/shared").TaskList[];
      const listByCategory = new Map<string, string>();
      loadedLists.forEach((list) => {
        if (list.name === "工作") listByCategory.set("work", list.id);
        if (list.name === "学习") listByCategory.set("study", list.id);
        if (list.name === "生活") listByCategory.set("life", list.id);
      });
      const tagMap = new Map((tagData || []).map((tag) => [tag.id, tag as Tag]));
      const links = new Map<string, Tag[]>();
      (tagLinks || []).forEach((link) => { const tag = tagMap.get(link.tag_id); if (tag) links.set(link.task_id, [...(links.get(link.task_id) || []), tag]); });
      const loadedTasks = (taskData || []).map((task) => {
        const row = task as Task;
        return { ...row, list_id: row.list_id || listByCategory.get(row.category) || null, schedule_start_at: row.schedule_start_at || row.due_date, tags: links.get(row.id) || [] } as TaskWithTags;
      });
      const tagCounts = new Map<string, number>();
      (tagLinks || []).forEach((link) => tagCounts.set(link.tag_id, (tagCounts.get(link.tag_id) || 0) + 1));
      setTags((tagData || []).map((tag) => ({ ...(tag as Tag), task_count: tagCounts.get(tag.id) || 0 })));
      setLists(loadedLists);
      setTasks(loadedTasks);
      scheduleDueDateReminders(loadedTasks);
    } finally {
      setLoading(false);
    }
  }, [scheduleDueDateReminders, supabase]);

  useEffect(() => { void fetchTasks(); }, [fetchTasks]);

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

  const saveTask = async (data: Partial<Task>, tagIds: string[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const patch = { ...data };
    if (!editingTask && sidebarSelection.scope === "list" && sidebarSelection.listId) patch.list_id = sidebarSelection.listId;
    if (patch.due_date && !patch.schedule_start_at) patch.schedule_start_at = patch.due_date;
    let taskId = editingTask?.id;
    if (editingTask) {
      await supabase.from("tasks").update(patch).eq("id", editingTask.id);
      await supabase.from("task_tags").delete().eq("task_id", editingTask.id);
    } else {
      const { data: inserted, error } = await supabase.from("tasks").insert({ ...patch, user_id: user.id }).select("id").single();
      if (error || !inserted) { toast({ title: "创建任务失败", variant: "destructive" }); return; }
      taskId = inserted.id as string;
    }
    if (taskId && tagIds.length > 0) await supabase.from("task_tags").insert(tagIds.map((tagId) => ({ task_id: taskId, tag_id: tagId })));
    await fetchTasks();
  };

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    if (sidebarSelection.scope === "trash") { if (!task.deleted_at) return false; }
    else {
      if (task.deleted_at) return false;
      if (sidebarSelection.scope === "completed" && task.status !== "done") return false;
      if (sidebarSelection.scope === "list" && task.list_id !== sidebarSelection.listId) return false;
      if (sidebarSelection.scope === "today") {
        if (task.status === "done" || task.status === "cancelled") return false;
        const value = taskDate(task); if (!value) return false;
        const date = new Date(value); if (!isSameDay(date, new Date()) && !isOverdue(value)) return false;
      }
      if (sidebarSelection.scope === "upcoming") {
        if (task.status === "done" || task.status === "cancelled") return false;
        if (!isWithinNextSevenDays(taskDate(task))) return false;
      }
    }
    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    if (categoryFilter !== "all" && task.category !== categoryFilter) return false;
    if (selectedTagIds.length && !(task.tags || []).some((tag) => selectedTagIds.includes(tag.id))) return false;
    if (search.trim()) { const query = search.trim().toLowerCase(); if (!task.title.toLowerCase().includes(query) && !(task.description || "").toLowerCase().includes(query)) return false; }
    return true;
  }), [categoryFilter, search, selectedTagIds, sidebarSelection, statusFilter, tasks]);

  const activeTasks = filteredTasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const completedTasks = filteredTasks.filter((task) => task.status === "done");
  const listTitle = sidebarSelection.scope === "list" ? lists.find((list) => list.id === sidebarSelection.listId)?.name || "工作任务" : sidebarSelection.scope === "today" ? "今天" : sidebarSelection.scope === "upcoming" ? "最近7天" : sidebarSelection.scope === "completed" ? "已完成" : sidebarSelection.scope === "trash" ? "垃圾桶" : "全部任务";
  const currentList = lists.find((list) => list.id === sidebarSelection.listId);

  const setView = (view: ViewMode) => updateUrl({ view, task: null });
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
  };

  if (viewMode === "month") {
    return (
      <div className="organize-task-screen fixed inset-0 z-[45] flex min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <TaskMonthView
          tasks={filteredTasks}
          onTaskClick={(task) => updateUrl({ view: "list", task: task.id })}
          onDateClick={() => { setEditingTask(null); setDialogOpen(true); }}
          onRescheduleTask={async (taskId, date) => { await updateTask(taskId, { schedule_start_at: date.toISOString(), due_date: date.toISOString() }); }}
        />
        <TaskDialog open={dialogOpen} task={editingTask} onClose={() => { setDialogOpen(false); setEditingTask(null); }} onSave={saveTask} />
      </div>
    );
  }

  return (
    <div className="organize-task-screen fixed inset-0 z-[45] flex overflow-hidden bg-background text-foreground">
      <aside className={cn("organize-task-nav shrink-0 border-r bg-background md:relative md:block md:w-[260px] lg:w-[22vw] lg:min-w-[300px] lg:max-w-[420px]", taskNavCollapsed && "lg:hidden", mobileSidebarOpen ? "fixed inset-y-0 left-0 z-[60] block w-[280px]" : "hidden md:block")}>
        <div className="flex h-14 items-center gap-3 border-b px-5">
          <a href="/inbox" className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">O</a>
          <span className="font-semibold">待办</span>
          <button type="button" aria-label="关闭任务侧栏" onClick={() => setMobileSidebarOpen(false)} className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-muted md:hidden"><ChevronLeft className="h-4 w-4" /></button>
        </div>
        <TaskSidebar
          lists={lists}
          tasks={tasks}
          hideHeading
          selection={sidebarSelection}
          onSelect={(selection) => { updateUrl({ scope: selection.scope, list: selection.scope === "list" ? selection.listId : null, task: null }); setMobileSidebarOpen(false); }}
          onCreateList={async () => {
            const name = window.prompt("清单名称：")?.trim();
            if (!name) return;
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { error } = await supabase.from("task_lists").insert({ user_id: user.id, name, sort_order: lists.length });
            if (error) toast({ title: "创建清单失败", variant: "destructive" }); else await fetchTasks();
          }}
          onRenameList={async (list) => {
            const name = window.prompt("清单名称：", list.name)?.trim();
            if (name && name !== list.name) { await supabase.from("task_lists").update({ name }).eq("id", list.id); await fetchTasks(); }
          }}
          onDeleteList={async (list) => { await supabase.from("tasks").update({ list_id: null }).eq("list_id", list.id); await supabase.from("task_lists").update({ deleted_at: new Date().toISOString() }).eq("id", list.id); await fetchTasks(); }}
        />
      </aside>

      {mobileSidebarOpen && <button type="button" aria-label="关闭任务导航" onClick={() => setMobileSidebarOpen(false)} className="fixed inset-0 z-[55] bg-black/30 md:hidden" />}

      <section className={cn("organize-task-list-pane flex min-w-0 flex-1 flex-col", selectedTask && "hidden md:flex")}>
        <header className="flex h-16 shrink-0 items-center gap-4 border-b px-5 md:px-8">
          <button type="button" aria-label={taskNavCollapsed || !mobileSidebarOpen ? "展开任务导航" : "收起任务导航"} onClick={() => { if (typeof window !== "undefined" && window.innerWidth >= 1024) setTaskNavCollapsed((current) => !current); else setMobileSidebarOpen(true); }} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Menu className="h-5 w-5" /></button>
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
              <div className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索任务" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务" className="h-9 pl-9" /></div>
              <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}><SelectTrigger className="h-9 w-auto min-w-[112px]"><Filter className="mr-1 h-3.5 w-3.5" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(TASK_STATUS_CONFIG).map(([key, config]) => <SelectItem key={key} value={key}>{config.label}</SelectItem>)}</SelectContent></Select>
              <Select value={categoryFilter} onValueChange={(value: CategoryFilter) => setCategoryFilter(value)}><SelectTrigger className="h-9 w-auto min-w-[112px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部分类</SelectItem>{Object.entries(TASK_CATEGORY_CONFIG).map(([key, config]) => <SelectItem key={key} value={key}>{config.label}</SelectItem>)}</SelectContent></Select>
              <TagFilter options={tags} selectedIds={selectedTagIds} onChange={setSelectedTagIds} />
              <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5"><button type="button" aria-label="列表视图" onClick={() => setView("list")} className={cn("rounded p-1.5", viewMode === "list" && "bg-muted")}><List className="h-4 w-4" /></button><button type="button" aria-label="看板视图" onClick={() => setView("kanban")} className={cn("rounded p-1.5", viewMode === "kanban" && "bg-muted")}><LayoutGrid className="h-4 w-4" /></button><button type="button" aria-label="月历视图" onClick={() => setView("month")} className="rounded p-1.5"><CalendarDays className="h-4 w-4" /></button></div>
            </div>

            {loading ? <div className="grid place-items-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div> : viewMode === "kanban" ? (
              <div className="grid gap-5 md:grid-cols-3">{(["todo", "in_progress", "done"] as TaskStatus[]).map((status) => <div key={status} className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold"><span className={cn("h-2 w-2 rounded-full", status === "todo" ? "bg-muted-foreground" : status === "in_progress" ? "bg-primary" : "bg-green-500")} />{TASK_STATUS_CONFIG[status].label}<span className="text-xs text-muted-foreground">{filteredTasks.filter((task) => task.status === status).length}</span></div>{filteredTasks.filter((task) => task.status === status).map((task) => <TaskCard key={task.id} task={task} onOpen={openTask} onToggleStatus={(id, next) => void updateTask(id, { status: next })} onComplete={(item) => void updateTask(item.id, { status: "done", completed_at: new Date().toISOString() })} onTogglePin={(id, pinned) => void updateTask(id, { is_pinned: pinned })} onDelete={deleteTask} />)}</div>)}</div>
            ) : filteredTasks.length === 0 ? <EmptyState icon={ListChecks} title="还没有任务" description="添加你的第一个任务开始规划" action={<Button onClick={() => { setEditingTask(null); setDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />创建任务</Button>} /> : (
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

      <TaskDialog open={dialogOpen} task={editingTask} onClose={() => { setDialogOpen(false); setEditingTask(null); }} onSave={saveTask} />
    </div>
  );
}
