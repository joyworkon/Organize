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

      const [{ data: tasksData }, { data: listsData }, { data: tagLinks }, { data: tagsData }] = await Promise.all([
        supabase.from("tasks").select("*").eq("user_id", user.id)
          .order("is_pinned", { ascending: false })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false }),
        supabase.from("task_lists").select("*").eq("user_id", user.id)
          .order("sort_order", { ascending: true })
          .is("deleted_at", null),
        supabase.from("task_tags").select("task_id, tag_id"),
        supabase.from("tags").select("id, name, color").eq("user_id", user.id),
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

      setTasks(tasksWithTags);
      snapshotRef.current = tasksWithTags;
      setLists((listsData || []) as TaskList[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

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
      const { error } = await supabase.from("tasks").update(updates).eq("id", taskId);
      if (error) throw error;
      // 重复任务：done 时触发幂等生成（RPC 内部幂等）
      if (status === "done") {
        await supabase.rpc("complete_recurring_task", { p_task_id: taskId });
      }
      // 成功后更新快照
      snapshotRef.current = snapshotRef.current.map((t) => t.id === taskId ? { ...t, status } : t);
    } catch {
      rollback();
      toast({ title: "更新失败，已回滚", variant: "destructive" });
    }
  }, [supabase]);

  /** 乐观切换置顶，失败回滚 */
  const togglePin = useCallback(async (taskId: string) => {
    const prev = snapshotRef.current;
    const task = prev.find((t) => t.id === taskId);
    if (!task) return;
    const newPinned = !task.is_pinned;
    setTasks((cur) => cur.map((t) => t.id === taskId ? { ...t, is_pinned: newPinned } : t));
    try {
      const { error } = await supabase.from("tasks").update({ is_pinned: newPinned }).eq("id", taskId);
      if (error) throw error;
      snapshotRef.current = snapshotRef.current.map((t) => t.id === taskId ? { ...t, is_pinned: newPinned } : t);
    } catch {
      setTasks(prev);
      toast({ title: "操作失败，已回滚", variant: "destructive" });
    }
  }, [supabase]);

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

  /** 更新任务字段（通用，乐观） */
  const updateTask = useCallback(async (taskId: string, patch: Partial<Task>) => {
    const prev = snapshotRef.current;
    setTasks((cur) => cur.map((t) => t.id === taskId ? { ...t, ...patch } : t));
    try {
      const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
      if (error) throw error;
      snapshotRef.current = snapshotRef.current.map((t) => t.id === taskId ? { ...t, ...patch } : t);
    } catch {
      setTasks(prev);
      toast({ title: "更新失败，已回滚", variant: "destructive" });
    }
  }, [supabase]);

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
