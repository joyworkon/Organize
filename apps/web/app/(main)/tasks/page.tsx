"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { CompleteTaskDialog } from "@/components/tasks/complete-task-dialog";
import { TagFilter } from "@/components/tags/tag-filter";
import { useNotifications } from "@/hooks/use-notifications";
import { BatchActionsBar } from "@/components/batch-actions-bar";
import { useSelection } from "@/hooks/use-selection";
import { toast } from "@/hooks/use-toast";
import {
  ListChecks,
  Plus,
  Search,
  Loader2,
  List,
  LayoutGrid,
  Bell,
  CheckCircle2,
  Trash2,
  Filter,
  Tag as TagIcon,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  Task,
  TaskWithTags,
  TaskStatus,
  TaskCategory,
  Tag,
  TagWithCount,
} from "@organize/shared";
import { TASK_STATUS_CONFIG, TASK_CATEGORY_CONFIG } from "@organize/shared";
import { EmptyState } from "@/components/ui/empty-state";

type StatusFilter = "all" | TaskStatus;
type CategoryFilter = "all" | TaskCategory;
type ViewMode = "list" | "kanban";
type SortOrder = "default" | "manual";

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskWithTags[]>([]);
  const [allTags, setAllTags] = useState<TagWithCount[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const { permission, requestPermission, scheduleDueDateReminders } = useNotifications();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [completeTask, setCompleteTask] = useState<Task | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortOrder, setSortOrder] = useState<SortOrder>("default");
  const [draggedTask, setDraggedTask] = useState<TaskWithTags | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  const selection = useSelection<TaskWithTags>();
  const { selectedIds, isSelectMode, selectAll, clear, isSelected } = selection;
  const showCheckbox = (selectionMode || isSelectMode) && viewMode === "list";

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let query = supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .order("is_pinned", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });

      const { data: tasksData } = await query;
      const tasksList = (tasksData || []) as unknown as Task[];

      const [{ data: tagLinks }, { data: tagsData }, { data: taskTagLinks }] = await Promise.all([
        supabase.from("task_tags").select("task_id, tag_id"),
        supabase.from("tags").select("id, name").eq("user_id", user.id),
        supabase.from("task_tags").select("tag_id"),
      ]);

      const tagMap = new Map((tagsData || []).map((t) => [t.id, t as Tag]));

      const tagCountMap = new Map<string, number>();
      for (const row of taskTagLinks || []) {
        tagCountMap.set(row.tag_id, (tagCountMap.get(row.tag_id) || 0) + 1);
      }

      const tagsWithCount: TagWithCount[] = (tagsData || []).map((t) => ({
        ...(t as Tag),
        task_count: tagCountMap.get(t.id) || 0,
      }));
      setAllTags(tagsWithCount);

      const linksByTask = new Map<string, Tag[]>();
      for (const link of tagLinks || []) {
        const tag = tagMap.get(link.tag_id);
        if (tag) {
          const existing = linksByTask.get(link.task_id) || [];
          existing.push(tag);
          linksByTask.set(link.task_id, existing);
        }
      }

      const tasksWithTags: TaskWithTags[] = tasksList.map((t) => ({
        ...t,
        tags: linksByTask.get(t.id) || [],
      }));

      setTasks(tasksWithTags);
      scheduleDueDateReminders(tasksWithTags);
    } finally {
      setLoading(false);
    }
  }, [supabase, scheduleDueDateReminders]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const exitSelection = useCallback(() => {
    clear();
    setSelectionMode(false);
  }, [clear]);

  const handleSaveTask = async (data: Partial<Task>, tagIds: string[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let taskId: string;
    if (editingTask) {
      taskId = editingTask.id;
      await supabase
        .from("tasks")
        .update(data)
        .eq("id", editingTask.id);
      await supabase.from("task_tags").delete().eq("task_id", editingTask.id);
    } else {
      const { data: inserted } = await supabase
        .from("tasks")
        .insert({ ...data, user_id: user.id })
        .select("id")
        .single();
      taskId = inserted!.id;
    }

    if (tagIds.length > 0) {
      const links = tagIds.map(tagId => ({ task_id: taskId, tag_id: tagId }));
      await supabase.from("task_tags").insert(links);
    }

    await fetchTasks();
    setEditingTask(null);
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm("确定删除这个任务吗？")) return;
    await supabase.from("task_tags").delete().eq("task_id", taskId);
    await supabase.from("tasks").delete().eq("id", taskId);
    await fetchTasks();
  };

  const handleToggleStatus = async (taskId: string, status: TaskStatus) => {
    const updates: Partial<Task> = { status };
    if (status === "done") {
      updates.completed_at = new Date().toISOString();
    } else {
      updates.completed_at = null;
    }
    await supabase.from("tasks").update(updates).eq("id", taskId);
    await fetchTasks();
  };

  const handleTogglePin = async (taskId: string, isPinned: boolean) => {
    await supabase.from("tasks").update({ is_pinned: isPinned }).eq("id", taskId);
    await fetchTasks();
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, task: TaskWithTags) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, task: TaskWithTags) => {
    e.preventDefault();
    if (draggedTask && draggedTask.id !== task.id) {
      setDragOverTaskId(task.id);
    }
  };

  const handleDragLeave = () => {
    setDragOverTaskId(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverTaskId(null);
  };

  const calculateNewSortOrder = (
    items: TaskWithTags[],
    fromIndex: number,
    toIndex: number
  ): number => {
    const isPinned = items[fromIndex].is_pinned;
    const sameGroup = items.filter((t) => t.is_pinned === isPinned);
    const groupWithoutMoved = sameGroup.filter((t) => t.id !== items[fromIndex].id);

    let insertPos = 0;
    for (let i = 0; i < toIndex; i++) {
      if (items[i].is_pinned === isPinned && items[i].id !== items[fromIndex].id) {
        insertPos++;
      }
    }

    if (insertPos === 0) {
      const firstItem = groupWithoutMoved[0];
      return firstItem ? firstItem.sort_order - 1000 : 0;
    } else if (insertPos >= groupWithoutMoved.length) {
      const lastItem = groupWithoutMoved[groupWithoutMoved.length - 1];
      return lastItem ? lastItem.sort_order + 1000 : groupWithoutMoved.length * 1000;
    } else {
      const prev = groupWithoutMoved[insertPos - 1];
      const next = groupWithoutMoved[insertPos];
      return Math.floor((prev.sort_order + next.sort_order) / 2);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, targetTask: TaskWithTags) => {
    e.preventDefault();
    if (!draggedTask || draggedTask.id === targetTask.id) {
      setDraggedTask(null);
      setDragOverTaskId(null);
      return;
    }

    if (draggedTask.is_pinned !== targetTask.is_pinned) {
      setDraggedTask(null);
      setDragOverTaskId(null);
      return;
    }

    const filteredForDrag = filtered;
    const fromIndex = filteredForDrag.findIndex((t) => t.id === draggedTask.id);
    const toIndex = filteredForDrag.findIndex((t) => t.id === targetTask.id);

    if (fromIndex === -1 || toIndex === -1) {
      setDraggedTask(null);
      setDragOverTaskId(null);
      return;
    }

    const newSortOrder = calculateNewSortOrder(filteredForDrag, fromIndex, toIndex);

    await supabase
      .from("tasks")
      .update({ sort_order: newSortOrder })
      .eq("id", draggedTask.id);

    setDraggedTask(null);
    setDragOverTaskId(null);
    await fetchTasks();
  };

  const handleCompleteClick = (task: Task) => {
    setCompleteTask(task);
  };

  const handleConfirmComplete = async (reflectionData?: { title?: string; content?: string; lessonType?: string }) => {
    if (!completeTask) return;
    await handleToggleStatus(completeTask.id, "done");

    if (reflectionData && reflectionData.content?.trim()) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("lessons").insert({
          user_id: user.id,
          title: reflectionData.title?.trim() || `${completeTask.title} - 复盘`,
          content: reflectionData.content.trim() ? {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: reflectionData.content.trim() }] },
            ],
          } : null,
          lesson_type: reflectionData.lessonType || "reflection",
          task_id: completeTask.id,
        });
      }
    }

    setCompleteTask(null);
    await fetchTasks();
  };

  const openCreate = () => {
    setEditingTask(null);
    setDialogOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setDialogOpen(true);
  };

  const handleToggleSelect = useCallback(
    (id: string, checked: boolean) => {
      if (checked) {
        selection.select(id);
      } else {
        selection.deselect(id);
      }
    },
    [selection]
  );

  const batchMarkComplete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("tasks")
      .update({ status: "done", completed_at: now })
      .in("id", ids);
    if (!error) {
      await fetchTasks();
      exitSelection();
      toast({ title: `已标记 ${count} 个任务为完成` });
    }
  };

  const batchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`确定删除选中的 ${ids.length} 个任务？此操作不可撤销。`)) return;
    const count = ids.length;
    await supabase.from("task_tags").delete().in("task_id", ids);
    const { error } = await supabase.from("tasks").delete().in("id", ids);
    if (!error) {
      await fetchTasks();
      exitSelection();
      toast({ title: `已删除 ${count} 个任务`, variant: "destructive" });
    }
  };

  const handleSelectAllVisible = () => {
    selectAll(filtered.map((t) => t.id));
  };

  const canManualSort = statusFilter === "todo" || statusFilter === "in_progress";
  const effectiveSortOrder: SortOrder = canManualSort ? sortOrder : "default";

  const filtered = tasks
    .filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (selectedTagIds.length > 0) {
        const taskTagIds = (t.tags || []).map(tag => tag.id);
        if (!selectedTagIds.some(id => taskTagIds.includes(id))) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q))
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;

      if (effectiveSortOrder === "manual") {
        if (a.sort_order !== b.sort_order) {
          return a.sort_order - b.sort_order;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }

      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const stats = {
    total: tasks.length,
    todo: tasks.filter((t) => t.status === "todo").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    done: tasks.filter((t) => t.status === "done").length,
    pinned: tasks.filter((t) => t.is_pinned).length,
  };

  const isManualSortMode = effectiveSortOrder === "manual" && viewMode === "list" && !showCheckbox;

  const taskCardProps = (task: TaskWithTags) => ({
    task,
    onEdit: openEdit,
    onDelete: handleDelete,
    onToggleStatus: handleToggleStatus,
    onTogglePin: handleTogglePin,
    onComplete: handleCompleteClick,
    selected: isSelected(task.id),
    onSelectChange: showCheckbox ? handleToggleSelect : undefined,
    selectionMode: selectionMode || isSelectMode,
    draggable: isManualSortMode,
    isDragging: draggedTask?.id === task.id,
    isDragOver: dragOverTaskId === task.id,
    onDragStart: isManualSortMode ? handleDragStart : undefined,
    onDragOver: isManualSortMode ? handleDragOver : undefined,
    onDragEnd: isManualSortMode ? handleDragEnd : undefined,
    onDrop: isManualSortMode ? handleDrop : undefined,
    onDragLeave: isManualSortMode ? handleDragLeave : undefined,
    onDragEnter: isManualSortMode ? (e: React.DragEvent<HTMLDivElement>) => handleDragEnter(e, task) : undefined,
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      {permission === "default" && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-accent/50 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Bell className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">开启浏览器通知以接收任务到期提醒</span>
            <span className="sm:hidden">开启任务提醒</span>
          </div>
          <button
            onClick={() => requestPermission()}
            className="shrink-0 text-muted-foreground hover:text-primary transition-colors font-medium"
          >
            开启
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">待办任务</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            {stats.todo} 个待办，{stats.inProgress} 个进行中，{stats.done} 个已完成
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline ml-2">新建任务</span>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[150px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v: StatusFilter) => setStatusFilter(v)}>
          <SelectTrigger className="w-auto sm:w-32 h-9 gap-1">
            <Filter className="h-3.5 w-3.5" />
            <SelectValue placeholder="状态" className="hidden sm:inline-flex" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {Object.entries(TASK_STATUS_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={categoryFilter} onValueChange={(v: CategoryFilter) => setCategoryFilter(v)}>
          <SelectTrigger className="w-auto sm:w-32 h-9 gap-1">
            <TagIcon className="h-3.5 w-3.5" />
            <SelectValue placeholder="分类" className="hidden sm:inline-flex" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {Object.entries(TASK_CATEGORY_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canManualSort && (
          <Select value={sortOrder} onValueChange={(v: SortOrder) => setSortOrder(v)}>
            <SelectTrigger className="w-auto sm:w-32 h-9 gap-1">
              <ArrowUpDown className="h-3.5 w-3.5" />
              <SelectValue placeholder="排序" className="hidden sm:inline-flex" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">默认排序</SelectItem>
              <SelectItem value="manual">手动排序</SelectItem>
            </SelectContent>
          </Select>
        )}

        <TagFilter
          options={allTags}
          selectedIds={selectedTagIds}
          onChange={setSelectedTagIds}
        />

        <div className="hidden sm:flex items-center gap-0.5 rounded-md border p-0.5 ml-auto">
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "p-1.5 rounded text-sm transition-colors",
              viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            title="列表视图"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("kanban")}
            className={cn(
              "p-1.5 rounded text-sm transition-colors",
              viewMode === "kanban" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            title="看板视图"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>

        <Button
          variant={showCheckbox ? "default" : "ghost"}
          size="sm"
          className="gap-1.5 ml-auto sm:ml-0"
          onClick={() => {
            if (selectionMode) {
              exitSelection();
            } else {
              setSelectionMode(true);
            }
          }}
          disabled={viewMode !== "list"}
          title={viewMode !== "list" ? "请切换到列表视图使用多选" : "多选"}
        >
          <ListChecks className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">多选</span>
        </Button>
      </div>

      {isSelectMode && viewMode === "list" && (
        <BatchActionsBar
          selectedCount={selectedIds.size}
          totalCount={filtered.length}
          onClear={exitSelection}
          onSelectAll={handleSelectAllVisible}
          typeLabel="个任务"
          actions={
            <>
              <Button size="sm" variant="ghost" className="gap-1" onClick={batchMarkComplete} title="标记完成">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                <span className="hidden sm:inline">标记完成</span>
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={batchDelete} title="删除">
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">删除</span>
              </Button>
            </>
          }
        />
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        (() => {
          const hasFilter = search.trim() !== "" || statusFilter !== "all" || categoryFilter !== "all" || selectedTagIds.length > 0;
          return (
            <EmptyState
              icon={ListChecks}
              title={hasFilter ? "没有匹配的任务" : "还没有任务"}
              description="添加你的第一个任务开始规划"
              action={!hasFilter ? (
                <Button onClick={openCreate}>创建任务</Button>
              ) : undefined}
            />
          );
        })()
      ) : viewMode === "list" ? (
        <div className="space-y-2 sm:space-y-3">
          {filtered.map((task) => (
            <TaskCard key={task.id} {...taskCardProps(task)} />
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-4">
          {(["todo", "in_progress", "done"] as TaskStatus[]).map((col) => {
            const colTasks = filtered.filter((t) => t.status === col);
            const cfg = TASK_STATUS_CONFIG[col];
            return (
              <div key={col} className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className={cn("h-2 w-2 rounded-full", col === "todo" ? "bg-muted-foreground" : col === "in_progress" ? "bg-primary" : "bg-green-500")} />
                  <h3 className="font-medium">{cfg.label}</h3>
                  <span className="text-xs text-muted-foreground">{colTasks.length}</span>
                </div>
                <div className="space-y-2">
                  {colTasks.map((task) => (
                    <TaskCard key={task.id} {...taskCardProps(task)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskDialog
        open={dialogOpen}
        task={editingTask}
        onClose={() => {
          setDialogOpen(false);
          setEditingTask(null);
        }}
        onSave={handleSaveTask}
      />

      <CompleteTaskDialog
        open={!!completeTask}
        task={completeTask}
        onClose={() => setCompleteTask(null)}
        onComplete={handleConfirmComplete}
      />
    </div>
  );
}
