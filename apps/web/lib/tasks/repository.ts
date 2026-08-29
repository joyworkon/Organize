"use client";
/**
 * 任务仓库 —— 单一数据源/状态源（任务2）。
 * 集中管理 tasks/task_lists 的 fetch + CRUD，供工作台各组件订阅。
 * 乐观更新失败必须回滚 + toast（任务书红线）；副作用不进 setState updater（AGENTS.md）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Task, TaskWithTags, TaskList, Tag } from "@organize/shared";
import { mutateTrash } from "@/lib/trash/client";
import { generateNextRecurringTask } from "@/lib/tasks/recurring";
import { applyTaskUpdate } from "@/lib/tasks/atomic-update";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { enqueueTaskOp, makeTaskUpdateOp, type PendingTaskOp } from "@/lib/offline/task-queue";
import { addTaskDeadLetterEntry } from "@/lib/offline/task-dead-letter";

/** 把被拒更改写入 per-user dead-letter（UI 在任务工作台呈现） */
function stashRejectedChange(userId: string, op: PendingTaskOp, error: unknown): void {
  addTaskDeadLetterEntry(localStorage, userId, { op, error });
}

export type TaskScope =
  | "all"
  | "today"
  | "upcoming"
  | "list"
  | "completed"
  | "trash";

export interface TaskFilters {
  scope: TaskScope;
  listId: string | null;
  search: string;
}

export function useTaskRepository() {
  const supabase = useMemo(() => createClient(), []);
  const [tasks, setTasks] = useState<TaskWithTags[]>([]);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [loading, setLoading] = useState(true);
  // 快照缓存（乐观回滚用）
  const snapshotRef = useRef<TaskWithTags[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: tasksData }, { data: listsData }, { data: tagLinks }, { data: tagsData }, { data: trashedData }] = await Promise.all([
        supabase.from("tasks").select("*").eq("user_id", user.id)
          .order("is_pinned", { ascending: false })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false }),
        supabase.from("task_lists").select("*").eq("user_id", user.id)
          .order("sort_order", { ascending: true })
          .is("deleted_at", null),
        supabase.from("task_tags").select("task_id, tag_id"),
        supabase.from("tags").select("id, name, color").eq("user_id", user.id),
        // 已删任务走 security definer RPC（RLS 下普通查询不可见，migration 050），
        // 供侧栏垃圾桶计数使用
        supabase.rpc("list_trashed_tasks"),
      ]);

      const tagMap = new Map((tagsData || []).map((t) => [t.id, t as Tag]));
      const linksByTask = new Map<string, Tag[]>();
      for (const link of tagLinks || []) {
        const tag = tagMap.get(link.tag_id);
        if (tag) {
          const arr = linksByTask.get(link.task_id) || [];
          arr.push(tag);
          linksByTask.set(link.task_id, arr);
        }
      }

      const tasksWithTags: TaskWithTags[] = (tasksData || []).map((t) => ({
        ...(t as Task),
        tags: linksByTask.get((t as Task).id) || [],
      }));
      // RPC 失败（如库未跑 migration 050）不阻塞主数据；合并已删任务只为侧栏计数，
      // 各视图均按 deleted_at 过滤
      const trashedTasks = Array.isArray(trashedData)
        ? (trashedData as unknown as TaskWithTags[])
        : [];

      setTasks([...tasksWithTags, ...trashedTasks]);
      snapshotRef.current = tasksWithTags;
      setLists((listsData || []) as TaskList[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  /** 共用原子协议的字段更新；冲突/网络失败均有可见处理，返回是否真实落库（false = 乐观态已回滚） */
  const applyAtomicUpdate = useCallback(
    async (taskId: string, patch: Record<string, unknown>): Promise<boolean> => {
      const prev = snapshotRef.current;
      const currentTask = prev.find((t) => t.id === taskId);
      const expectedVersion = currentTask?.sync_version ?? null;
      const result = await applyTaskUpdate(supabase, taskId, patch, expectedVersion, crypto.randomUUID());
      if (result.status === "applied") {
        snapshotRef.current = snapshotRef.current.map((t) => t.id === taskId ? { ...t, ...patch, sync_version: result.syncVersion } as TaskWithTags : t);
        setTasks(snapshotRef.current);
        return true;
      }
      if (result.status === "already_applied") return true;
      if (result.status === "conflict" || result.status === "not_found") {
        if (result.status === "conflict") {
          // 双设备冲突：绝不静默覆盖。更改存入 per-user dead-letter（任务工作台有重试/丢弃入口）
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            stashRejectedChange(
              session.user.id,
              makeTaskUpdateOp(taskId, patch, expectedVersion),
              { code: "TASK_SYNC_CONFLICT", message: `任务已在其他设备被修改（当前版本 ${result.currentSyncVersion ?? "未知"}）` }
            );
            toast({ title: "任务已在其他设备被修改，本次更改已存入待处理列表", variant: "destructive" });
          } else {
            toast({ title: "任务已在其他设备被修改，请刷新后重试", variant: "destructive" });
          }
        } else {
          toast({ title: "任务不存在或已被删除", variant: "destructive" });
        }
        setTasks(prev);
        await fetchAll();
        return false;
      }
      // 网络错误：入队待回放（离线保存），乐观状态保留
      if (isNetworkSaveError(result.error)) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { persisted } = enqueueTaskOp(localStorage, session.user.id, makeTaskUpdateOp(taskId, patch, expectedVersion));
          if (!persisted) toast({ title: "本地存储不可用，离线更改可能丢失", variant: "destructive" });
          else toast({ title: "网络异常，已离线保存，联网后自动同步" });
          return true;
        }
        toast({ title: "网络异常，请稍后重试", variant: "destructive" });
        setTasks(prev);
        return false;
      }
      setTasks(prev);
      toast({ title: "更新失败，已回滚", variant: "destructive" });
      return false;
    },
    [supabase, fetchAll]
  );

  /** 乐观更新任务状态，失败回滚 */
  const updateTaskStatus = useCallback(async (taskId: string, status: Task["status"]) => {
    const prev = snapshotRef.current;
    const rollback = () => { snapshotRef.current = prev; setTasks(prev); };
    // 乐观：先更新 UI
    setTasks((cur) => cur.map((t) => t.id === taskId ? { ...t, status } : t));
    try {
      const updates: Record<string, unknown> = {
        status,
        completed_at: status === "done" ? new Date().toISOString() : null,
      };
      // 在线与离线共用原子协议（P1-03）；离线（含网络异常）入队由 applyAtomicUpdate 处理
      const applied = await applyAtomicUpdate(taskId, updates);
      if (!applied) return;
      // 重复任务：done 时触发幂等生成（RPC 内部自检，非重复任务返回 null）
      if (status === "done") {
        const newId = await generateNextRecurringTask(supabase, taskId);
        if (newId) {
          toast({ title: "已生成下一次重复任务" });
          await fetchAll();
        }
      }
      // 成功后更新快照
      snapshotRef.current = snapshotRef.current.map((t) => t.id === taskId ? { ...t, status } : t);
    } catch {
      rollback();
      toast({ title: "更新失败，已回滚", variant: "destructive" });
    }
  }, [supabase, fetchAll, applyAtomicUpdate]);

  /** 乐观切换置顶，失败回滚 */
  const togglePin = useCallback(async (taskId: string) => {
    const prev = snapshotRef.current;
    const task = prev.find((t) => t.id === taskId);
    if (!task) return;
    const newPinned = !task.is_pinned;
    setTasks((cur) => cur.map((t) => t.id === taskId ? { ...t, is_pinned: newPinned } : t));
    try {
      const applied = await applyAtomicUpdate(taskId, { is_pinned: newPinned });
      if (!applied) return;
      snapshotRef.current = snapshotRef.current.map((t) => t.id === taskId ? { ...t, is_pinned: newPinned } : t);
    } catch {
      setTasks(prev);
      toast({ title: "操作失败，已回滚", variant: "destructive" });
    }
  }, [supabase, applyAtomicUpdate]);

  /** 软删除任务（进回收站） */
  const softDeleteTask = useCallback(async (taskId: string) => {
    const prev = snapshotRef.current;
    setTasks((cur) => cur.filter((t) => t.id !== taskId));
    try {
      await mutateTrash("task", [taskId], "soft_delete");
      snapshotRef.current = prev.filter((t) => t.id !== taskId);
      await fetchAll(); // 重新拉取（含 deleted_at 状态）
    } catch {
      setTasks(prev);
      toast({ title: "删除失败，已回滚", variant: "destructive" });
    }
  }, [fetchAll]);

  /** 更新任务字段（通用，乐观；在线与离线共用原子协议） */
  const updateTask = useCallback(async (taskId: string, patch: Partial<Task>) => {
    const prev = snapshotRef.current;
    setTasks((cur) => cur.map((t) => t.id === taskId ? { ...t, ...patch } : t));
    const applied = await applyAtomicUpdate(taskId, patch as Record<string, unknown>);
    if (!applied) return;
    snapshotRef.current = snapshotRef.current.map((t) => t.id === taskId ? { ...t, ...patch } : t);
  }, [applyAtomicUpdate]);

  /** 新建清单 */
  const createList = useCallback(async (name: string, icon?: string, color?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from("task_lists")
      .insert({ user_id: user.id, name, icon: icon || null, color: color || null, sort_order: lists.length })
      .select().single();
    if (error) { toast({ title: "创建清单失败", variant: "destructive" }); return; }
    setLists((cur) => [...cur, data as TaskList]);
    return data as TaskList;
  }, [supabase, lists]);

  /** 改名/图标/颜色清单 */
  const updateList = useCallback(async (listId: string, patch: Partial<TaskList>) => {
    const prev = lists;
    setLists((cur) => cur.map((l) => l.id === listId ? { ...l, ...patch } : l));
    try {
      const { error } = await supabase.from("task_lists").update(patch).eq("id", listId);
      if (error) throw error;
    } catch {
      setLists(prev);
      toast({ title: "更新清单失败，已回滚", variant: "destructive" });
    }
  }, [supabase, lists]);

  /** 删除清单（任务移到未分类=list_id null） */
  const deleteList = useCallback(async (listId: string) => {
    const prev = lists;
    setLists((cur) => cur.filter((l) => l.id !== listId));
    try {
      // 任务 list_id 置空
      await supabase.from("tasks").update({ list_id: null }).eq("list_id", listId);
      await supabase.from("task_lists").update({ deleted_at: new Date().toISOString() }).eq("id", listId);
      await fetchAll();
    } catch {
      setLists(prev);
      toast({ title: "删除清单失败，已回滚", variant: "destructive" });
    }
  }, [supabase, fetchAll, lists]);

  return {
    tasks, lists, loading,
    refetch: fetchAll,
    updateTaskStatus, togglePin, softDeleteTask, updateTask,
    createList, updateList, deleteList,
  };
}
