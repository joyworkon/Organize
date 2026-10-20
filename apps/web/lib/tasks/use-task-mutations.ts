"use client";

/**
 * 列表页与日历页共用的任务字段更新 / 软删除。
 * 乐观更新、sync_version、离线队列、冲突 dead-letter、重复任务续期都在这里，
 * 调用方只提供任务数组和刷新入口。
 */

import { createElement, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "@/hooks/use-toast";
import { isOnline } from "@/lib/offline/network";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { enqueueTaskOp, makeTaskUpdateOp, taskOpsCount, type PendingTaskOp } from "@/lib/offline/task-queue";
import { appEvents } from "@/lib/plugin/events";
import { applyTaskUpdate } from "@/lib/tasks/atomic-update";
import { requestNextRecurringTask } from "@/lib/tasks/recurring";
import type { Task, TaskWithTags } from "@organize/shared";

type TaskMutationClient = Parameters<typeof applyTaskUpdate>[0];

export interface UseTaskMutationsOptions {
  supabase: TaskMutationClient;
  userId: string | null;
  tasks: TaskWithTags[];
  setTasks: Dispatch<SetStateAction<TaskWithTags[]>>;
  /** 冲突、丢失或删除成功后拉权威数据。成功后调用方应清空版本表。 */
  refreshTasks: (opts?: { silent?: boolean }) => Promise<unknown>;
  /** 删除成功或离线删除后清掉 ?task= */
  onDeleted: () => void;
  /** 离线入队后的待同步条数。日历可以不展示。 */
  setPendingOps?: (count: number) => void;
  /** 冲突写入 dead-letter。返回 false 表示没写进去。 */
  pushDeadLetter: (op: PendingTaskOp, error: unknown) => boolean;
}

export function useTaskMutations({
  supabase,
  userId,
  tasks,
  setTasks,
  refreshTasks,
  onDeleted,
  setPendingOps,
  pushDeadLetter,
}: UseTaskMutationsOptions) {
  const tasksRef = useRef<TaskWithTags[]>([]);
  tasksRef.current = tasks;
  // 同一任务的更新按序执行；快速连续更新读这里的版本，不再拿着旧版本自冲突
  const taskVersionRef = useRef(new Map<string, number | null>());
  const taskMutationQueueRef = useRef(new Map<string, Promise<void>>());

  const clearTaskVersions = useCallback(() => {
    taskVersionRef.current.clear();
  }, []);

  const updateTaskInner = useCallback(async (taskId: string, patch: Partial<Task>) => {
    const previousTask = tasksRef.current.find((task) => task.id === taskId);
    const rollbackTask = () => {
      if (!previousTask) return;
      setTasks((current) => current.map((task) => (task.id === taskId ? previousTask : task)));
    };
    const normalized = { ...patch } as Partial<Task>;
    if ("schedule_start_at" in normalized || "schedule_end_at" in normalized) {
      normalized.due_date = normalized.schedule_end_at || normalized.schedule_start_at || null;
    }
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, ...normalized } : task)));
    const expectedVersion = taskVersionRef.current.has(taskId)
      ? taskVersionRef.current.get(taskId) ?? null
      : previousTask?.sync_version ?? null;
    if (!isOnline()) {
      if (!userId) {
        rollbackTask();
        toast({ title: "登录状态未知，离线更改暂未保存", variant: "destructive" });
        return;
      }
      const op = makeTaskUpdateOp(taskId, normalized as Record<string, unknown>, expectedVersion);
      const { persisted } = enqueueTaskOp(localStorage, userId, op);
      setPendingOps?.(taskOpsCount(localStorage, userId));
      if (!persisted) toast({ title: "本地存储不可用，离线更改可能丢失", variant: "destructive" });
      else toast({ title: "已离线保存，联网后自动同步" });
      window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
      return;
    }
    const result = await applyTaskUpdate(supabase, taskId, normalized as Record<string, unknown>, expectedVersion, crypto.randomUUID());
    if (result.status === "applied") {
      taskVersionRef.current.set(taskId, result.syncVersion);
      setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, sync_version: result.syncVersion } : task)));
      window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
    } else if (result.status === "already_applied") {
      // 幂等命中，界面保持乐观结果
    } else if (result.status === "conflict") {
      rollbackTask();
      taskVersionRef.current.delete(taskId);
      await refreshTasks({ silent: true });
      const op = makeTaskUpdateOp(taskId, normalized as Record<string, unknown>, expectedVersion);
      pushDeadLetter(op, { code: "TASK_SYNC_CONFLICT", message: `任务已在其他设备被修改（当前版本 ${result.currentSyncVersion ?? "未知"}）` });
      toast({ title: "任务已在其他设备被修改，本次更改已存入待处理列表", variant: "destructive" });
      return;
    } else if (result.status === "not_found") {
      rollbackTask();
      taskVersionRef.current.delete(taskId);
      await refreshTasks({ silent: true });
      toast({ title: "任务不存在或已被删除", variant: "destructive" });
      return;
    } else if (isNetworkSaveError(result.error)) {
      if (!userId) {
        rollbackTask();
        toast({ title: "网络异常且登录状态未知，请稍后重试", variant: "destructive" });
        return;
      }
      const op = makeTaskUpdateOp(taskId, normalized as Record<string, unknown>, expectedVersion);
      const { persisted } = enqueueTaskOp(localStorage, userId, op);
      setPendingOps?.(taskOpsCount(localStorage, userId));
      if (!persisted) toast({ title: "网络异常且本地存储不可用，本次更改可能丢失", variant: "destructive" });
      else toast({ title: "网络异常，已离线保存，联网后自动同步" });
      window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
      return;
    } else {
      rollbackTask();
      toast({ title: "保存失败，已回滚", variant: "destructive" });
      return;
    }
    if (normalized.status === "done") {
      appEvents.emit("task:completed", {
        taskId,
        title: tasksRef.current.find((task) => task.id === taskId)?.title ?? "",
      });
      const next = await requestNextRecurringTask(supabase, taskId);
      if (next.status === "created") {
        toast({ title: "已生成下一次重复任务" });
        window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
      } else if (next.status === "error") {
        toast({ title: "任务已完成，但下一次重复任务生成失败", description: next.message, variant: "destructive" });
      }
    }
  }, [pushDeadLetter, refreshTasks, setPendingOps, setTasks, supabase, userId]);

  const updateTask = useCallback((taskId: string, patch: Partial<Task>) => {
    const previous = taskMutationQueueRef.current.get(taskId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => updateTaskInner(taskId, patch))
      .then(() => {});
    taskMutationQueueRef.current.set(taskId, next);
    return next;
  }, [updateTaskInner]);

  const deleteTask = useCallback(async (taskId: string) => {
    const now = new Date().toISOString();
    const expectedVersion = tasks.find((task) => task.id === taskId)?.sync_version ?? null;
    const offlineDelete = () => {
      if (!userId) {
        toast({ title: "登录状态未知，离线更改暂未保存", variant: "destructive" });
        return;
      }
      setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, deleted_at: now } : task)));
      const op = makeTaskUpdateOp(taskId, { deleted_at: now }, expectedVersion);
      const { persisted } = enqueueTaskOp(localStorage, userId, op);
      setPendingOps?.(taskOpsCount(localStorage, userId));
      if (!persisted) toast({ title: "本地存储不可用，离线删除可能丢失", variant: "destructive" });
      onDeleted();
    };
    if (!isOnline()) {
      offlineDelete();
      toast({ title: "已离线删除，联网后自动同步" });
      return;
    }
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
    onDeleted();
    await refreshTasks({ silent: true });
    window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
    const createdToast = toast({
      title: "任务已移入垃圾箱",
      action: createElement(
        "button",
        {
          type: "button",
          className: "rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent",
          onClick: async () => {
            createdToast.dismiss();
            const { error: restoreError } = await supabase.rpc("mutate_trash", {
              p_action: "restore",
              p_resource_type: "task",
              p_ids: [taskId],
            });
            if (restoreError) {
              toast({ title: "恢复失败，请在垃圾箱中重试", variant: "destructive" });
              return;
            }
            await refreshTasks({ silent: true });
            window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
            toast({ title: "已恢复任务" });
          },
        },
        "撤销",
      ),
    });
  }, [onDeleted, refreshTasks, setPendingOps, setTasks, supabase, tasks, userId]);

  return { updateTask, deleteTask, clearTaskVersions };
}
