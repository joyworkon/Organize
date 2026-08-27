"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Filter,
  Flag,
  Group,
  ListChecks,
  Loader2,
  LockKeyhole,
  MoreHorizontal,
  Trash2,
  WifiOff,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isOnline, useOnlineStatus } from "@/lib/offline/network";
import { appEvents } from "@/lib/plugin/events";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import {
  enqueueTaskOp,
  makeTaskCreateOp,
  makeTaskUpdateOp,
  readTaskOps,
  replayTaskOps,
  taskOpsCount,
  writeTaskOps,
  type TaskQueueWriter,
} from "@/lib/offline/task-queue";
import { applyReorderedGroup, computeSortOrderUpdates, moveIdByOffset, reorderIds } from "@/lib/tasks/reorder";
import { generateNextRecurringTask } from "@/lib/tasks/recurring";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BatchActionsBar } from "@/components/batch-actions-bar";
import { useSelection } from "@/hooks/use-selection";
import { groupTasksByDate } from "@/lib/date-groups";
import { useHotkey, hasOpenDialog } from "@/lib/hooks/use-hotkey";
import { TagFilter } from "@/components/tags/tag-filter";
import type { SidebarSelection } from "@/components/tasks/task-sidebar";
import { TaskInlineDetail } from "@/components/tasks/task-inline-detail";
import { TaskTemplatesDialog } from "@/components/tasks/task-templates-dialog";
import { TaskAttachmentsDialog } from "@/components/tasks/task-attachments-dialog";
import { TaskDatePopover, formatTaskDate } from "@/components/tasks/task-date-popover";
import { toast } from "@/hooks/use-toast";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import type { TagWithCount, Task, TaskCategory, TaskDependency, TaskPriority, TaskStatus, TaskWithTags } from "@organize/shared";
import { TASK_CATEGORY_CONFIG, TASK_PRIORITY_CONFIG, TASK_STATUS_CONFIG } from "@organize/shared";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";
import {
  fetchTaskWorkspace,
  filterTasksByScope,
  isOverdue,
  quickAddDueDate,
  schedulableReminderTasks,
  taskDate,
} from "@/lib/tasks/workspace";
import { getBlockedTaskIds, getTaskDependencyView } from "@/lib/tasks/dependencies";

type StatusFilter = "all" | TaskStatus;
type CategoryFilter = "all" | TaskCategory;
type PriorityFilter = "all" | TaskPriority;
type TaskScope = SidebarSelection["scope"];

interface TaskRowProps {
  task: TaskWithTags;
  selected: boolean;
  listColor?: string | null;
  blocked?: boolean;
  onOpen: () => void;
  /** 垃圾箱等只读视图不传：隐藏完成勾选/日期入口 */
  onStatus?: () => void;
  onDateChange?: (value: TaskSchedule) => Promise<void>;
  /** 多选模式：显示勾选框 */
  selectionMode?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** 已关联便签时可一键打开笔记 */
  onOpenNote?: () => void;
  /** 拖拽排序（仅待办组启用） */
  draggableRow?: boolean;
  dropPosition?: "before" | "after" | null;
  onDragStartRow?: () => void;
  onDragOverRow?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDropRow?: () => void;
  onDragEndRow?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveRow?: (offset: -1 | 1) => void;
}

function TaskRow({ task, selected, listColor, blocked, onOpen, onStatus, onDateChange, selectionMode, checked, onCheckedChange, onOpenNote, draggableRow, dropPosition, onDragStartRow, onDragOverRow, onDropRow, onDragEndRow, canMoveUp, canMoveDown, onMoveRow }: TaskRowProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressOpen = useRef(false);
  const clearLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    longPressOrigin.current = null;
  };
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
      onClick={(event) => {
        if (suppressOpen.current) {
          event.preventDefault();
          suppressOpen.current = false;
          return;
        }
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); return; }
        // 行聚焦时按 x 切换完成状态（x 未占用全局 g 序列，避免与导航冲突）
        if (onStatus && (event.key === "x" || event.key === "X")) { event.preventDefault(); event.stopPropagation(); onStatus(); }
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch" || !onMoveRow || (event.target as HTMLElement).closest("button,input")) return;
        clearLongPress();
        longPressOrigin.current = { x: event.clientX, y: event.clientY };
        longPressTimer.current = setTimeout(() => {
          suppressOpen.current = true;
          setMobileMenuOpen(true);
          clearLongPress();
        }, 500);
      }}
      onPointerMove={(event) => {
        const origin = longPressOrigin.current;
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) clearLongPress();
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      draggable={draggableRow}
      onDragStart={draggableRow ? (event) => { event.dataTransfer.effectAllowed = "move"; onDragStartRow?.(); } : undefined}
      onDragOver={draggableRow ? (event) => { event.preventDefault(); onDragOverRow?.(event); } : undefined}
      onDrop={draggableRow ? (event) => { event.preventDefault(); event.stopPropagation(); onDropRow?.(); } : undefined}
      onDragEnd={draggableRow ? () => onDragEndRow?.() : undefined}
      className={cn("group flex min-h-[74px] items-start gap-3 border-b px-5 py-3 text-left transition-colors hover:bg-muted/50", selected && "bg-muted", task.status === "done" && "text-muted-foreground", dropPosition === "before" && "border-t-2 border-t-primary", dropPosition === "after" && "border-b-2 border-b-primary", draggableRow && "cursor-grab active:cursor-grabbing")}
      style={{ borderLeft: `3px solid ${listColor || "transparent"}` }}
    >
      {selectionMode && (
        <span onClick={(event) => event.stopPropagation()} className="mt-0.5 shrink-0">
          <Checkbox
            aria-label={`选择任务 ${task.title}`}
            checked={checked}
            onCheckedChange={(value) => onCheckedChange?.(value === true)}
          />
        </span>
      )}
      {onStatus && (
        <button type="button" aria-label={task.status === "done" ? "标记未完成" : "标记完成"} onClick={(event) => { event.stopPropagation(); onStatus(); }} className={cn("mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-md border", task.status === "done" ? "border-muted bg-muted" : "border-muted-foreground/30 hover:border-primary")}>
          {task.status === "done" && <Check className="h-3.5 w-3.5" />}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/* 优先级旗标（medium 为默认不显示，减少视觉噪声） */}
          {task.priority && task.priority !== "medium" && (
            <Flag
              aria-label={`优先级：${TASK_PRIORITY_CONFIG[task.priority].label}`}
              className={cn("h-3.5 w-3.5 shrink-0", task.priority === "high" ? "fill-red-500 text-red-500" : "text-muted-foreground")}
            />
          )}
          <div className={cn("truncate text-[15px] font-medium", task.status === "done" && "line-through")}>{task.title}</div>
          {blocked && (
            <span
              aria-label="任务被未完成的前置任务阻塞"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
            >
              <LockKeyhole className="h-3 w-3" />
              阻塞
            </span>
          )}
        </div>
        {task.description && <div className="mt-1 truncate text-sm text-muted-foreground">- {task.description}</div>}
        {task.tags && task.tags.length > 0 && <div className="mt-1 flex gap-1 text-[11px] text-muted-foreground">{task.tags.slice(0, 3).map((tag) => <span key={tag.id}>#{tag.name}</span>)}</div>}
      </div>
      {onOpenNote && (
        <button
          type="button"
          aria-label="打开关联便签"
          title="打开关联便签"
          onClick={(event) => { event.stopPropagation(); onOpenNote(); }}
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-primary"
        >
          <FileText className="h-3.5 w-3.5" />
        </button>
      )}
      {onDateChange ? (
        <TaskDatePopover
          value={schedule}
          onChange={onDateChange}
          align="end"
          trigger={<button type="button" onClick={(event) => event.stopPropagation()} className={cn("shrink-0 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground", isOverdue(taskDate(task)) && "text-red-500")}>{formatTaskDate(taskDate(task))}</button>}
        />
      ) : (
        <span className={cn("shrink-0 px-1.5 py-1 text-xs text-muted-foreground", isOverdue(taskDate(task)) && "text-red-500")}>{formatTaskDate(taskDate(task))}</span>
      )}
      {onMoveRow && (
        <DropdownMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="移动任务" onClick={(event) => event.stopPropagation()} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted md:hidden">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem disabled={!canMoveUp} onSelect={() => onMoveRow(-1)}>
              <ArrowUp className="mr-2 h-4 w-4" />
              上移一项
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onSelect={() => onMoveRow(1)}>
              <ArrowDown className="mr-2 h-4 w-4" />
              下移一项
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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
  const { permission, requestPermission, scheduleDueDateReminders, notifyOverdueSummary } = useNotifications();
  const [tasks, setTasks] = useState<TaskWithTags[]>([]);
  const [lists, setLists] = useState<import("@organize/shared").TaskList[]>([]);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  // 拖拽排序（仅待办组）：dragTaskId 为被拖任务，dropTarget 为落点行+位置
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const activeTasksRef = useRef<TaskWithTags[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  // 待办组按日期分组展示（分组模式下禁用手动排序，避免与 sort_order 语义冲突）
  const [groupByDate, setGroupByDate] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const selection = useSelection<TaskWithTags>();
  const { selectedIds, isSelectMode } = selection;
  const showCheckbox = selectionMode || isSelectMode;
  const quickAddInputRef = useRef<HTMLInputElement>(null);

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
      setDependencies(workspace.dependencies);
      // 提醒/逾期汇总只吃可见集：已软删、或父链上有软删（幽灵子任务）的不提醒，
      // 否则任务在任何视图里都看不到却到期弹通知，用户找不到来源
      const schedulable = schedulableReminderTasks(workspace.tasks);
      scheduleDueDateReminders(schedulable);
      notifyOverdueSummary(schedulable);
    } finally {
      setLoading(false);
    }
  }, [notifyOverdueSummary, scheduleDueDateReminders, supabase]);

  useEffect(() => { void fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    const reloadTasks = () => void fetchTasks();
    window.addEventListener("organize:tasks-changed", reloadTasks);
    return () => window.removeEventListener("organize:tasks-changed", reloadTasks);
  }, [fetchTasks]);

  // X1 离线同步：网络状态 + 待回放操作数
  const online = useOnlineStatus();
  const [pendingOps, setPendingOps] = useState(0);
  useEffect(() => {
    setPendingOps(taskOpsCount(localStorage));
  }, []);

  /** 回放离线队列：联网后按序推送，应用成功的触发一次列表刷新 */
  const replayPendingOps = useCallback(async () => {
    const ops = readTaskOps(localStorage);
    if (ops.length === 0) {
      setPendingOps(0);
      return;
    }
    const writer: TaskQueueWriter = {
      insertTask: async (task) => {
        const { error } = await supabase.from("tasks").insert(task);
        return { error };
      },
      updateTask: async (id, patch) => {
        // 「update 后 delete」合并成的补丁：先落其余字段再软删，直接软删会把
        // 这些修改静默丢弃（离线先改标题/日期、再删除同一任务的真实路径）
        if (patch.deleted_at !== undefined) {
          const { deleted_at: _deletedAt, ...rest } = patch;
          if (Object.keys(rest).length > 0) {
            const { error } = await supabase.from("tasks").update(rest).eq("id", id);
            if (error) return { error };
          }
          // 软删除走 mutate_trash RPC：直写 deleted_at 被 RLS 拒绝；
          // RPC 幂等（目标已删/不存在时更新 0 行，不报错）
          const { error } = await supabase.rpc("mutate_trash", {
            p_action: "soft_delete",
            p_resource_type: "task",
            p_ids: [id],
          });
          return { error };
        }
        const { error } = await supabase.from("tasks").update(patch).eq("id", id);
        if (error) return { error };
        // 重复任务在离线期间被勾完成：回放后必须补生成下一次实例
        // （RPC 自检幂等，非重复任务返回 null），否则该重复链就此断链
        if (patch.status === "done") {
          await generateNextRecurringTask(supabase, id);
        }
        return { error: null };
      },
    };
    const result = await replayTaskOps(writer, ops);
    writeTaskOps(localStorage, result.remaining);
    setPendingOps(result.remaining.length);
    if (result.applied > 0) {
      await fetchTasks();
      window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
      toast({ title: `已同步 ${result.applied} 项离线更改` });
    }
  }, [fetchTasks, supabase]);

  // 联网即回放（含首次挂载时队列有积压的场景）
  useEffect(() => {
    if (online) void replayPendingOps();
  }, [online, replayPendingOps]);

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
    // X1：离线时直接入队（避免必然失败的请求），乐观状态保留
    if (!isOnline()) {
      enqueueTaskOp(localStorage, makeTaskUpdateOp(taskId, normalized as Record<string, unknown>));
      setPendingOps(taskOpsCount(localStorage));
      toast({ title: "已离线保存，联网后自动同步" });
      return;
    }
    const { error } = await supabase.from("tasks").update(normalized).eq("id", taskId);
    if (error) {
      // X1：网络错误按离线处理——入队待回放，不回滚乐观状态
      if (isNetworkSaveError(error)) {
        enqueueTaskOp(localStorage, makeTaskUpdateOp(taskId, normalized as Record<string, unknown>));
        setPendingOps(taskOpsCount(localStorage));
        toast({ title: "网络异常，已离线保存，联网后自动同步" });
        return;
      }
      setTasks(previous);
      toast({ title: "保存失败，已回滚", variant: "destructive" });
      return;
    }
    // 重复任务：标记完成后幂等生成下一次实例（RPC 自检，非重复任务返回 null）
    if (normalized.status === "done") {
      appEvents.emit("task:completed", {
        taskId,
        title: tasks.find((task) => task.id === taskId)?.title ?? "",
      });
      const newId = await generateNextRecurringTask(supabase, taskId);
      if (newId) {
        toast({ title: "已生成下一次重复任务" });
        window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
      }
    }
  }, [supabase, tasks]);

  const deleteTask = useCallback(async (taskId: string) => {
    if (!window.confirm("将这个任务移入垃圾箱？")) return;
    const now = new Date().toISOString();
    // X1：离线时软删除走离线队列（本质是 update），乐观从列表移除
    const offlineDelete = () => {
      setTasks((current) => current.map((task) => task.id === taskId ? { ...task, deleted_at: now } : task));
      enqueueTaskOp(localStorage, makeTaskUpdateOp(taskId, { deleted_at: now }));
      setPendingOps(taskOpsCount(localStorage));
      updateUrl({ task: null });
    };
    if (!isOnline()) {
      offlineDelete();
      toast({ title: "已离线删除，联网后自动同步" });
      return;
    }
    // 软删除必须走 mutate_trash RPC：直写 deleted_at 会被 RLS 拒绝（更新后的行
    // 必须仍满足 SELECT 可见性），RPC 是 security definer 且自带子树级联
    const { error } = await supabase.rpc("mutate_trash", {
      p_action: "soft_delete",
      p_resource_type: "task",
      p_ids: [taskId],
    });
    if (error) {
      if (isNetworkSaveError(error)) {
        offlineDelete();
        toast({ title: "网络异常，已离线删除，联网后自动同步" });
        return;
      }
      toast({ title: "删除失败", variant: "destructive" });
      return;
    }
    updateUrl({ task: null });
    await fetchTasks();
    toast({ title: "任务已移入垃圾箱" });
  }, [fetchTasks, supabase, updateUrl]);

  /** 拖拽落点：把被拖任务插到目标行前/后，组内 sort_order 归一后持久化最小更新集 */
  const handleDropRow = useCallback(async (targetId: string, position: "before" | "after") => {
    setDropTarget(null);
    const dragId = dragTaskId;
    setDragTaskId(null);
    if (!dragId || dragId === targetId) return;
    const groupIds = activeTasksRef.current.map((task) => task.id);
    const newOrder = reorderIds(groupIds, dragId, targetId, position === "after");
    if (newOrder === groupIds) return;
    const previous = tasks;
    setTasks((current) => applyReorderedGroup(current, newOrder));
    const updates = computeSortOrderUpdates(activeTasksRef.current, newOrder);
    try {
      const results = await Promise.all(
        updates.map((update) => supabase.from("tasks").update({ sort_order: update.sort_order }).eq("id", update.id))
      );
      const failed = results.find((result) => result.error);
      if (failed) throw failed.error;
    } catch {
      setTasks(previous);
      toast({ title: "排序保存失败，已回滚", variant: "destructive" });
    }
  }, [dragTaskId, supabase, tasks]);

  /** 触屏菜单与桌面拖拽共用相同的乐观更新及 sort_order 持久化协议 */
  const handleMoveRow = useCallback(async (taskId: string, offset: -1 | 1) => {
    const currentRows = activeTasksRef.current;
    const groupIds = currentRows.map((task) => task.id);
    const newOrder = moveIdByOffset(groupIds, taskId, offset);
    if (newOrder === groupIds) return;
    const previous = tasks;
    setTasks((current) => applyReorderedGroup(current, newOrder));
    const updates = computeSortOrderUpdates(currentRows, newOrder);
    const results = await Promise.all(
      updates.map((update) => supabase.from("tasks").update({ sort_order: update.sort_order }).eq("id", update.id))
    );
    if (results.some((result) => result.error)) {
      setTasks(previous);
      toast({ title: "排序保存失败，已回滚", variant: "destructive" });
    }
  }, [supabase, tasks]);

  const filteredTasks = useMemo(() => {
    const scoped = filterTasksByScope(tasks, sidebarSelection);
    return scoped.filter((task) => {
    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    if (categoryFilter !== "all" && task.category !== categoryFilter) return false;
    if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
    if (selectedTagIds.length && !(task.tags || []).some((tag) => selectedTagIds.includes(tag.id))) return false;
    return true;
    });
  }, [categoryFilter, priorityFilter, selectedTagIds, sidebarSelection, statusFilter, tasks]);

  // 筛选/scope 变化后裁掉不可见的选择项：防止批量操作作用到当前视野外的任务
  useEffect(() => {
    selection.retainOnly(filteredTasks.map((task) => task.id));
    // selection 的方法均为稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTasks]);

  // 垃圾箱视图平铺展示全部已删任务（含 done/cancelled），不分待办/完成两组
  const isTrashScope = sidebarSelection.scope === "trash";
  // 手动排序只在「单个清单 + 无筛选」视图开放：跨清单/筛选后的拖拽会把
  // 可见子集的 sort_order 归一成 0..n-1，与不可见任务（其他清单、被筛掉的
  // 行）的既有顺序交错，切回清单视图后顺序错乱
  const canReorderRows =
    sidebarSelection.scope === "list" &&
    statusFilter === "all" &&
    categoryFilter === "all" &&
    priorityFilter === "all" &&
    selectedTagIds.length === 0;
  const activeTasks = isTrashScope ? filteredTasks : filteredTasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  activeTasksRef.current = activeTasks;
  const completedTasks = isTrashScope ? [] : filteredTasks.filter((task) => task.status === "done");
  // 日期分组只在分组开关打开时计算；组内保持手动排序的先后顺序
  const activeSections = useMemo(
    () => (groupByDate ? groupTasksByDate(activeTasks, taskDate) : null),
    [groupByDate, activeTasks]
  );
  const blockedTaskIds = useMemo(
    () => getBlockedTaskIds(tasks, dependencies),
    [dependencies, tasks]
  );
  /** 当前详情任务的未完成前置：完成按钮二次确认用 */
  const selectedBlockingPrerequisites = useMemo(() => {
    if (!selectedTask) return [];
    return getTaskDependencyView(tasks, dependencies, selectedTask.id).blockingPrerequisites
      .map((task) => ({ id: task.id, title: task.title }));
  }, [dependencies, selectedTask, tasks]);
  const listTitle = sidebarSelection.scope === "list" ? lists.find((list) => list.id === sidebarSelection.listId)?.name || "工作任务" : sidebarSelection.scope === "today" ? "今天" : sidebarSelection.scope === "upcoming" ? "最近7天" : sidebarSelection.scope === "completed" ? "已完成" : sidebarSelection.scope === "trash" ? "垃圾桶" : "全部任务";
  const currentList = lists.find((list) => list.id === sidebarSelection.listId);

  const openTask = (task: TaskWithTags) => updateUrl({ task: task.id });
  const closeTask = () => updateUrl({ task: null });
  const toggleStatus = (task: Task) => void updateTask(task.id, { status: task.status === "done" ? "todo" : "done", completed_at: task.status === "done" ? null : new Date().toISOString() });

  const exitSelection = useCallback(() => {
    selection.clear();
    setSelectionMode(false);
  }, [selection]);

  /** 批量完成：一次性落库；重复任务不逐个生成下一次实例（批量场景下代价高且易刷屏） */
  const batchComplete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const previous = tasks;
    setTasks((current) => current.map((task) => selectedIds.has(task.id) ? { ...task, status: "done", completed_at: now } : task));
    const results = await Promise.all(
      ids.map(async (id) => ({ id, error: (await supabase.from("tasks").update({ status: "done", completed_at: now }).eq("id", id)).error }))
    );
    // 部分失败时只回滚失败项：成功项已真实落库，整体回滚会让界面与库长期相反
    const failedIds = results.filter((result) => result.error).map((result) => result.id);
    if (failedIds.length > 0) {
      const failedSet = new Set(failedIds);
      setTasks((current) => current.map((task) => {
        if (!failedSet.has(task.id)) return task;
        return previous.find((prevTask) => prevTask.id === task.id) ?? task;
      }));
      toast({ title: `${ids.length - failedIds.length} 个完成成功，${failedIds.length} 个失败已还原`, variant: "destructive" });
      exitSelection();
      return;
    }
    exitSelection();
    toast({ title: `已完成 ${ids.length} 个任务` });
  }, [exitSelection, selectedIds, supabase, tasks]);

  const batchDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`将选中的 ${ids.length} 个任务移入垃圾箱？`)) return;
    const now = new Date().toISOString();
    const previous = tasks;
    setTasks((current) => current.map((task) => selectedIds.has(task.id) ? { ...task, deleted_at: now } : task));
    // X1：离线时批量软删除逐项入队（本质是 update 补丁），乐观移除已就绪
    if (!isOnline()) {
      ids.forEach((id) => enqueueTaskOp(localStorage, makeTaskUpdateOp(id, { deleted_at: now })));
      setPendingOps(taskOpsCount(localStorage));
      updateUrl({ task: null });
      exitSelection();
      toast({ title: "已离线删除，联网后自动同步" });
      return;
    }
    // 软删除走 mutate_trash RPC（单次批量调用，子树级联由 RPC 处理）
    const { error } = await supabase.rpc("mutate_trash", {
      p_action: "soft_delete",
      p_resource_type: "task",
      p_ids: ids,
    });
    if (error) {
      // 单次 RPC 全成或全败：失败整体还原
      setTasks(previous);
      toast({ title: "删除失败，已还原", variant: "destructive" });
      exitSelection();
      return;
    }
    updateUrl({ task: null });
    exitSelection();
    toast({ title: `${ids.length} 个任务已移入垃圾箱` });
  }, [exitSelection, selectedIds, supabase, tasks, updateUrl]);

  // 页面快捷键：n 聚焦快速添加、v 日期分组、m 多选、Esc 关闭详情/退出多选（弹层打开时让位）
  useHotkey([
    {
      key: "n",
      ctrlKey: false,
      metaKey: false,
      handler: () => { if (!hasOpenDialog()) quickAddInputRef.current?.focus(); },
    },
    {
      key: "v",
      ctrlKey: false,
      metaKey: false,
      handler: () => { if (!hasOpenDialog()) setGroupByDate((value) => !value); },
    },
    {
      key: "m",
      ctrlKey: false,
      metaKey: false,
      handler: () => { if (hasOpenDialog() || sidebarSelection.scope === "trash") return; if (showCheckbox) exitSelection(); else setSelectionMode(true); },
    },
    {
      key: "escape",
      ctrlKey: false,
      metaKey: false,
      handler: () => {
        if (hasOpenDialog()) return;
        if (selectedTaskId) closeTask();
        else if (showCheckbox) exitSelection();
      },
    },
  ]);

  const quickAdd = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const input = event.currentTarget;
    const title = input.value.trim();
    if (!title) return;
    // X1：getSession 读本地会话（无网络请求），离线创建可用；getUser 离线返回 null 会静默吞掉创建
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;
    const now = new Date().toISOString();
    // X1：id 始终由客户端生成——离线创建可乐观入列，服务端主键唯一约束保证回放幂等
    const insertPayload: Record<string, unknown> = {
      id: crypto.randomUUID(),
      user_id: user.id,
      title,
      status: "todo",
      priority: "medium",
      category: "work",
      list_id: sidebarSelection.scope === "list" ? sidebarSelection.listId : null,
      due_date: quickAddDueDate(sidebarSelection.scope),
    };
    /** 离线创建：乐观入列 + 入队待回放 */
    const applyOfflineCreate = () => {
      const optimistic: TaskWithTags = {
        id: insertPayload.id as string,
        user_id: user.id,
        title,
        status: "todo",
        priority: "medium",
        category: "work",
        list_id: (insertPayload.list_id as string | null) ?? null,
        due_date: (insertPayload.due_date as string | null) ?? null,
        description: null,
        estimated_minutes: null,
        actual_minutes: null,
        reading_item_id: null,
        note_id: null,
        is_pinned: false,
        sort_order: 0,
        completed_at: null,
        created_at: now,
        updated_at: now,
        tags: [],
      };
      setTasks((current) => [optimistic, ...current]);
      enqueueTaskOp(localStorage, makeTaskCreateOp(insertPayload));
      setPendingOps(taskOpsCount(localStorage));
      input.value = "";
      toast({ title: "已离线创建，联网后自动同步" });
    };
    if (!isOnline()) {
      applyOfflineCreate();
      return;
    }
    const { error } = await supabase.from("tasks").insert(insertPayload);
    if (error) {
      // X1：网络错误按离线创建处理（客户端 id 保证回放不重复）
      if (isNetworkSaveError(error)) {
        applyOfflineCreate();
        return;
      }
      toast({ title: "创建任务失败", description: error.message, variant: "destructive" });
      return;
    }
    input.value = "";
    await fetchTasks();
    window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
  };

  /** 行公共 props：平铺（拖拽）与分组两种渲染分支共用；已完成任务不展示阻塞标识（保持旧行为）。
   * 垃圾箱行为只读（软删行被 RLS 拒绝写入）：不传 onStatus/onDateChange，行内入口直接隐藏。 */
  const commonRowProps = (task: TaskWithTags) => ({
    task,
    selected: task.id === selectedTaskId,
    listColor: lists.find((list) => list.id === task.list_id)?.color,
    blocked: task.status === "done" ? false : blockedTaskIds.has(task.id),
    onOpen: () => openTask(task),
    onStatus: isTrashScope ? undefined : () => toggleStatus(task),
    onDateChange: isTrashScope
      ? undefined
      : (value: TaskSchedule) => updateTask(task.id, { schedule_start_at: value.schedule_start_at, schedule_end_at: value.schedule_end_at, due_date: value.schedule_end_at || value.schedule_start_at, all_day: value.all_day, timezone: value.timezone, recurrence_rule: value.recurrence_rule }),
    selectionMode: showCheckbox,
    checked: selectedIds.has(task.id),
    onCheckedChange: (checked: boolean) => { if (checked) selection.select(task.id); else selection.deselect(task.id); },
    onOpenNote: task.note_id ? () => router.push(`/notes/${task.note_id}`) : undefined,
  });

  const sectionHeader = (label: string, count: number) => (
    <div className="flex items-center gap-2 border-b bg-muted/20 px-5 py-3 text-sm font-semibold">
      <ChevronDown className="h-4 w-4" />{label}
      <span className="text-xs font-normal text-muted-foreground">{count}</span>
    </div>
  );

  // 无 scope 参数时会重定向到第一个清单（见上方 effect）；
  // 清单已就绪但还没跳转时先渲染加载态，避免"全部"列表闪一下再跳走
  if (!searchParams.get("scope") && lists.length > 0) {
    return (
      <div className="grid h-[calc(100vh-11rem)] place-items-center rounded-lg border bg-background text-muted-foreground md:h-[calc(100vh-6rem)]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="organize-task-screen flex h-[calc(100vh-11rem)] min-h-0 w-full overflow-hidden rounded-lg border bg-background text-foreground md:h-[calc(100vh-6rem)]">
      <section className={cn("organize-task-list-pane flex min-w-0 flex-1 flex-col", selectedTask && "hidden md:flex")}>
        <header className="flex h-16 shrink-0 items-center gap-4 border-b px-5 md:px-8">
          <span className="text-2xl">{currentList?.icon || "📋"}</span>
          <h1 className="truncate text-xl font-semibold">{listTitle}</h1>
          {!online && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <WifiOff className="h-3.5 w-3.5" />
              离线中{pendingOps > 0 ? ` · ${pendingOps} 项待同步` : ""}
            </span>
          )}
          <TaskTemplatesDialog
            lists={lists}
            defaultListId={sidebarSelection.scope === "list" ? sidebarSelection.listId : null}
            defaultDueDate={quickAddDueDate(sidebarSelection.scope)}
            onCreated={async (taskId) => {
              await fetchTasks();
              window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
              updateUrl({ task: taskId });
            }}
          />
          <TaskAttachmentsDialog
            tasks={tasks.filter((task) => !task.deleted_at)}
            onOpenTask={(taskId) => updateUrl({ task: taskId })}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[820px] px-4 pb-12 pt-5 md:px-8">
            {sidebarSelection.scope !== "trash" && (
              <input ref={quickAddInputRef} aria-label="快速添加任务" title="按 n 快速聚焦" onKeyDown={(event) => void quickAdd(event)} placeholder={`添加任务至“${listTitle}”，回车即可创建`} className="mb-6 h-14 w-full rounded-xl border-0 bg-muted/60 px-5 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20" />
            )}
            {sidebarSelection.scope === "trash" && (
              <p className="mb-6 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                垃圾箱中的任务为只读；恢复或永久删除请前往侧栏「垃圾箱」页面。
              </p>
            )}

            {permission === "default" && <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><span>开启浏览器通知以接收任务到期提醒</span><button type="button" onClick={() => requestPermission()} className="font-medium text-primary">开启</button></div>}
            {permission === "denied" && (
              <div className="mb-4 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                通知权限已被浏览器禁止：提醒将无法送达。可在浏览器地址栏的站点设置里把「通知」改为「允许」，然后刷新页面。
              </div>
            )}

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}><SelectTrigger className="h-9 w-auto min-w-[112px]"><Filter className="mr-1 h-3.5 w-3.5" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(TASK_STATUS_CONFIG).map(([key, config]) => <SelectItem key={key} value={key}>{config.label}</SelectItem>)}</SelectContent></Select>
              <Select value={categoryFilter} onValueChange={(value: CategoryFilter) => setCategoryFilter(value)}><SelectTrigger className="h-9 w-auto min-w-[112px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部分类</SelectItem>{Object.entries(TASK_CATEGORY_CONFIG).map(([key, config]) => <SelectItem key={key} value={key}>{config.label}</SelectItem>)}</SelectContent></Select>
              <Select value={priorityFilter} onValueChange={(value: PriorityFilter) => setPriorityFilter(value)}><SelectTrigger className="h-9 w-auto min-w-[112px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部优先级</SelectItem>{Object.entries(TASK_PRIORITY_CONFIG).map(([key, config]) => <SelectItem key={key} value={key}>{config.label}</SelectItem>)}</SelectContent></Select>
              <TagFilter options={tags} selectedIds={selectedTagIds} onChange={setSelectedTagIds} />
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant={groupByDate ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  title="按日期分组待办任务（按 v）"
                  onClick={() => setGroupByDate((value) => !value)}
                >
                  <Group className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">日期分组</span>
                </Button>
                {sidebarSelection.scope !== "trash" && (
                  <Button
                    variant={showCheckbox ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    title="多选批量操作（按 m）"
                    onClick={() => { if (showCheckbox) exitSelection(); else setSelectionMode(true); }}
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">多选</span>
                  </Button>
                )}
              </div>
            </div>

            {showCheckbox && filteredTasks.length > 0 && (
              <BatchActionsBar
                selectedCount={selectedIds.size}
                totalCount={filteredTasks.length}
                onClear={exitSelection}
                onSelectAll={() => selection.selectAll(filteredTasks.map((task) => task.id))}
                typeLabel="个任务"
                actions={
                  <>
                    <Button size="sm" variant="ghost" className="gap-1" onClick={() => void batchComplete()} title="标记完成">
                      <Check className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">完成</span>
                    </Button>
                    <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => void batchDelete()} title="删除">
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">删除</span>
                    </Button>
                  </>
                }
              />
            )}

            {loading ? <div className="grid place-items-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div> : filteredTasks.length === 0 ? <EmptyState icon={ListChecks} title={sidebarSelection.scope === "trash" ? "垃圾箱是空的" : "还没有任务"} description={sidebarSelection.scope === "trash" ? "删除的任务会在这里出现，可恢复或永久删除" : "使用上方输入框，回车即可添加任务"} /> : (
              <div className="overflow-hidden rounded-xl border bg-background">
                {activeSections ? (
                  activeSections.map((section) => (
                    <div key={section.key}>
                      {sectionHeader(section.label, section.items.length)}
                      {section.items.map((task) => <TaskRow key={task.id} {...commonRowProps(task)} />)}
                    </div>
                  ))
                ) : (
                  <>
                    {activeTasks.length > 0 && sectionHeader("待办", activeTasks.length)}
                    {activeTasks.map((task, index) => (
                      <TaskRow
                        key={task.id}
                        {...commonRowProps(task)}
                        draggableRow={canReorderRows}
                        dropPosition={dropTarget?.id === task.id ? dropTarget.position : null}
                        onDragStartRow={canReorderRows ? () => setDragTaskId(task.id) : undefined}
                        onDragOverRow={canReorderRows ? (event) => {
                          if (!dragTaskId || dragTaskId === task.id) return;
                          const rect = event.currentTarget.getBoundingClientRect();
                          const position = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
                          setDropTarget((current) => (current?.id === task.id && current.position === position ? current : { id: task.id, position }));
                        } : undefined}
                        onDropRow={canReorderRows ? () => { if (dropTarget && dropTarget.id === task.id) void handleDropRow(task.id, dropTarget.position); } : undefined}
                        onDragEndRow={canReorderRows ? () => { setDragTaskId(null); setDropTarget(null); } : undefined}
                        canMoveUp={canReorderRows && index > 0}
                        canMoveDown={canReorderRows && index < activeTasks.length - 1}
                        onMoveRow={canReorderRows ? (offset) => void handleMoveRow(task.id, offset) : undefined}
                      />
                    ))}
                  </>
                )}
                {completedTasks.length > 0 && sectionHeader("已完成", completedTasks.length)}
                {completedTasks.map((task) => <TaskRow key={task.id} {...commonRowProps(task)} />)}
              </div>
            )}
          </div>
        </div>
      </section>

      {selectedTask && <TaskInlineDetail task={selectedTask} lists={lists} onUpdate={updateTask} onDelete={deleteTask} onClose={closeTask} onOpenTask={(taskId) => updateUrl({ task: taskId })} blockingPrerequisites={selectedBlockingPrerequisites} />}
    </div>
  );
}
