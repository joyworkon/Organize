"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, CornerUpLeft, Plus } from "lucide-react";
import type { Task } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface TaskHierarchyProps {
  task: Task;
  onOpenTask?: (taskId: string) => void;
}

export function TaskHierarchy({ task, onOpenTask }: TaskHierarchyProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [parent, setParent] = useState<Task | null>(null);
  const [children, setChildren] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const openTask = (taskId: string) => {
    if (onOpenTask) onOpenTask(taskId);
    else router.push(`/tasks/${taskId}`);
  };

  const loadHierarchy = async () => {
    const [childrenResult, parentResult] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("parent_task_id", task.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true }),
      task.parent_task_id
        ? supabase.from("tasks").select("*").eq("id", task.parent_task_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setChildren((childrenResult.data || []) as Task[]);
    setParent((parentResult.data as Task | null) || null);
  };

  useEffect(() => {
    setTitle("");
    void loadHierarchy();
    // task.id 是层级查询键，客户端实例保持稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.parent_task_id]);

  const addSubtask = async () => {
    const nextTitle = title.trim();
    if (!nextTitle || saving) return;
    setSaving(true);
    const maxOrder = children.reduce(
      (max, child) => Math.max(max, child.sort_order || 0),
      -1
    );
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: task.user_id,
        parent_task_id: task.id,
        title: nextTitle,
        status: "todo",
        priority: "medium",
        category: task.category,
        list_id: task.list_id || null,
        sort_order: maxOrder + 1,
      })
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "添加子任务失败", variant: "destructive" });
      return;
    }
    setChildren((current) => [...current, data as Task]);
    setTitle("");
    window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
  };

  const toggleSubtask = async (child: Task) => {
    const done = child.status === "done";
    const patch = {
      status: done ? "todo" : "done",
      completed_at: done ? null : new Date().toISOString(),
    } satisfies Partial<Task>;
    const { error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", child.id);
    if (error) {
      toast({ title: "更新子任务失败", variant: "destructive" });
      return;
    }
    setChildren((current) =>
      current.map((item) => item.id === child.id ? { ...item, ...patch } : item)
    );
    window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
  };

  const completed = children.filter((child) => child.status === "done").length;

  return (
    <div className="space-y-3">
      {parent && (
        <button
          type="button"
          onClick={() => openTask(parent.id)}
          className="flex w-full items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <CornerUpLeft className="h-4 w-4 shrink-0" />
          <span className="truncate">上级任务：{parent.title}</span>
        </button>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">子任务</h3>
        {children.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {completed}/{children.length}
          </span>
        )}
      </div>

      {children.length === 0 && (
        <p className="py-2 text-center text-sm text-muted-foreground">暂无子任务</p>
      )}
      <div className="space-y-1">
        {children.map((child) => (
          <div
            key={child.id}
            className="group flex items-center gap-3 rounded-md px-1 py-2 hover:bg-muted/50"
          >
            <button
              type="button"
              aria-label={child.status === "done" ? "标记未完成" : "标记完成"}
              onClick={() => void toggleSubtask(child)}
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                child.status === "done"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30"
              )}
            >
              {child.status === "done" && <Check className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => openTask(child.id)}
              className={cn(
                "min-w-0 flex-1 truncate text-left text-sm",
                child.status === "done" && "text-muted-foreground line-through"
              )}
            >
              {child.title}
            </button>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t pt-3">
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          id={`subtask-input-${task.id}`}
          aria-label="添加子任务"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addSubtask();
          }}
          placeholder="添加子任务，回车创建"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
