"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, CornerUpLeft, Plus } from "lucide-react";
import type { Task } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isOnline } from "@/lib/offline/network";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { enqueueTaskOp, makeTaskCreateOp, makeTaskUpdateOp } from "@/lib/offline/task-queue";
import { applyTaskUpdate } from "@/lib/tasks/atomic-update";
import { generateNextRecurringTask } from "@/lib/tasks/recurring";

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
    // X1：id 始终由客户端生成——离线创建可入队回放（主键唯一约束保证幂等），
    // 子任务即带 parent_task_id 的任务行，走任务队列同一套 create
    const insertPayload = {
      id: crypto.randomUUID(),
      user_id: task.user_id,
      parent_task_id: task.id,
      title: nextTitle,
      status: "todo" as const,
      priority: "medium" as const,
      category: task.category,
      list_id: task.list_id || null,
      sort_order: maxOrder + 1,
    };
    // X1：乐观插入子任务列表，服务端失败（非网络）时回滚
    const now = new Date().toISOString();
    const optimistic: Task = {
      ...insertPayload,
      description: null,
      due_date: null,
      estimated_minutes: null,
      actual_minutes: null,
      reading_item_id: null,
      note_id: null,
      is_pinned: false,
      completed_at: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    setChildren((current) => [...current, optimistic]);
    setTitle("");
    const rollback = () => {
      setChildren((current) => current.filter((item) => item.id !== insertPayload.id));
      setTitle(nextTitle);
    };
    const offlineCreate = () => {
      enqueueTaskOp(localStorage, task.user_id, makeTaskCreateOp(insertPayload));
      setSaving(false);
      toast({ title: "已离线创建，联网后自动同步" });
    };
    if (!isOnline()) {
      offlineCreate();
      return;
    }
    const { data, error } = await supabase
      .from("tasks")
      .insert(insertPayload)
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      // X1：网络错误按离线创建处理（客户端 id 保证回放不重复）
      if (isNetworkSaveError(error)) {
        offlineCreate();
        return;
      }
      rollback();
      toast({ title: "添加子任务失败", variant: "destructive" });
      return;
    }
    // 用服务端返回行替换乐观条目（补全生成列与默认值）
    setChildren((current) =>
      current.map((item) => item.id === insertPayload.id ? data as Task : item)
    );
    window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
  };

  const toggleSubtask = async (child: Task) => {
    const done = child.status === "done";
    const patch = {
      status: done ? "todo" : "done",
      completed_at: done ? null : new Date().toISOString(),
    } satisfies Partial<Task>;
    // X1：先乐观更新；离线（或网络异常）直接入队，联网后回放
    setChildren((current) =>
      current.map((item) => item.id === child.id ? { ...item, ...patch } : item)
    );
    const offlineUpdate = () => {
      enqueueTaskOp(localStorage, task.user_id, makeTaskUpdateOp(child.id, patch as Record<string, unknown>, child.sync_version ?? null));
      toast({ title: "已离线保存，联网后自动同步" });
    };
    if (!isOnline()) {
      offlineUpdate();
      return;
    }
    // 在线与离线更新共用原子协议（P1-03）
    const result = await applyTaskUpdate(supabase, child.id, patch as Record<string, unknown>, child.sync_version ?? null, crypto.randomUUID());
    if (result.status === "error" || result.status === "conflict" || result.status === "not_found") {
      // X1：网络错误按离线处理——入队待回放，不回滚乐观状态
      if (result.status === "error" && isNetworkSaveError(result.error)) {
        offlineUpdate();
        return;
      }
      setChildren((current) =>
        current.map((item) => item.id === child.id ? { ...item, status: child.status, completed_at: child.completed_at } : item)
      );
      toast({
        title: result.status === "conflict" ? "子任务已在其他设备被修改，已还原" : "更新子任务失败",
        variant: "destructive",
      });
      return;
    }
    if (patch.status === "done") {
      // 与工作台一致：完成触发重复任务下一实例生成（RPC 自检幂等）
      await generateNextRecurringTask(supabase, child.id);
    }
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
