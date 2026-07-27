"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Card, CardContent } from "@/components/ui/card";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { CompleteTaskDialog } from "@/components/tasks/complete-task-dialog";
import { TagFilter } from "@/components/tags/tag-filter";
import {
  ListChecks,
  Plus,
  Search,
  Loader2,
  List,
  LayoutGrid,
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

type StatusFilter = "all" | TaskStatus;
type CategoryFilter = "all" | TaskCategory;
type ViewMode = "list" | "kanban";

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskWithTags[]>([]);
  const [allTags, setAllTags] = useState<TagWithCount[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [completeTask, setCompleteTask] = useState<Task | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let query = supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id);

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
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">待办任务</h1>
          <p className="text-muted-foreground mt-1">
            {stats.todo} 个待办，{stats.inProgress} 个进行中，{stats.done} 个已完成
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          新建任务
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索任务..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v: StatusFilter) => setStatusFilter(v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {Object.entries(TASK_STATUS_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={categoryFilter} onValueChange={(v: CategoryFilter) => setCategoryFilter(v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {Object.entries(TASK_CATEGORY_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <TagFilter
          options={allTags}
          selectedIds={selectedTagIds}
          onChange={setSelectedTagIds}
        />

        <div className="flex items-center gap-0.5 rounded-md border p-0.5 ml-auto">
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
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <ListChecks className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
            <p className="text-muted-foreground mb-4">
              {search || statusFilter !== "all" || categoryFilter !== "all" || selectedTagIds.length > 0
                ? "没有匹配的任务"
                : "还没有任务"}
            </p>
            {!search && statusFilter === "all" && categoryFilter === "all" && selectedTagIds.length === 0 && (
              <Button onClick={openCreate}>创建第一个任务</Button>
            )}
          </CardContent>
        </Card>
      ) : viewMode === "list" ? (
        <div className="space-y-2">
          {filtered.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggleStatus={handleToggleStatus}
              onTogglePin={handleTogglePin}
              onComplete={handleCompleteClick}
            />
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
                    <TaskCard
                      key={task.id}
                      task={task}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                      onToggleStatus={handleToggleStatus}
                      onTogglePin={handleTogglePin}
                      onComplete={handleCompleteClick}
                    />
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
