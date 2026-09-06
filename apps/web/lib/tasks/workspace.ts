"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Tag,
  TagWithCount,
  Task,
  TaskDependency,
  TaskList,
  TaskWithTags,
} from "@organize/shared";
import type { SidebarSelection } from "@/components/tasks/task-sidebar";

type SupabaseClient = ReturnType<typeof createClient>;

export interface TaskWorkspaceData {
  tasks: TaskWithTags[];
  lists: TaskList[];
  tags: TagWithCount[];
  dependencies: TaskDependency[];
  /** 辅助查询（清单/标签/依赖/垃圾桶）失败说明；主查询失败直接抛错（F03） */
  warnings: string[];
}

export function taskDate(task: Task): string | null {
  return task.schedule_start_at || task.due_date || null;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/**
 * 任务级逾期（T03）：只看「截止」语义的 due_date，进行中跨天任务不因开始日已过而判逾期。
 * - 未完成/未取消才有逾期
 * - 带时刻的截止：时刻已过即逾期（含今天稍早已截止）
 * - 全天截止：当天 23:59:59.999 前不算逾期
 */
export function isTaskOverdue(task: Task, now = new Date()): boolean {
  if (!task.due_date || task.status === "done" || task.status === "cancelled") return false;
  const due = new Date(task.due_date);
  if (isNaN(due.getTime())) return false;
  const limit = task.all_day
    ? new Date(due.getFullYear(), due.getMonth(), due.getDate(), 23, 59, 59, 999)
    : due;
  return limit.getTime() < now.getTime();
}

export function isOverdue(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return date < now && !isSameDay(date, now);
}

/**
 * 「最近7天」按自然日窗口：今天 00:00 起、第 7 天当天结束止。
 * 此前以"此刻 +7×24h"为界——今天早些时候截止的任务下午查看时 diff<0
 * 被排除，既不算逾期也不在今天 scope 里，从视图中凭空消失。
 */
export function isWithinNextSevenDays(
  value: string | null | undefined,
  now = new Date()
): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (isNaN(date.getTime())) return false;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999).getTime();
  return date.getTime() >= start && date.getTime() <= end;
}

/** 快速添加任务时，日期范围页需要给新任务一个可见的默认日期。 */
export function quickAddDueDate(
  scope: SidebarSelection["scope"],
  now = new Date()
): string | null {
  // 存当天 23:59 而非"现在"：用创建瞬间当截止会让任务一落库就过期，
  // fetchTasks 后的提醒调度立刻弹「任务已过期」——用户刚添加就收到过期通知
  if (scope === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
  }
  if (scope === "upcoming") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow.toISOString();
  }
  return null;
}

/**
 * 提醒/逾期汇总只吃可见集：
 * 已软删的不提醒；父任务被软删后子任务在任何 scope 都不可见（幽灵），
 * 但仍会留在全量 workspace.tasks 里——不过滤的话到期照样弹通知，用户找不到来源。
 */
export function schedulableReminderTasks(tasks: TaskWithTags[]): TaskWithTags[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const childrenOf = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.parent_task_id) {
      childrenOf.set(task.parent_task_id, [...(childrenOf.get(task.parent_task_id) || []), task.id]);
    }
  }
  const blocked = new Set<string>();
  for (const root of tasks) {
    if (!root.deleted_at || blocked.has(root.id)) continue;
    blocked.add(root.id);
    const stack = [...(childrenOf.get(root.id) || [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (blocked.has(id)) continue;
      blocked.add(id);
      stack.push(...(childrenOf.get(id) || []));
    }
  }
  return tasks.filter((task) => !blocked.has(task.id));
}

/** 将任务列表范围应用到一份已经加载的任务数组。 */
export function filterTasksByScope(
  tasks: TaskWithTags[],
  selection: SidebarSelection
): TaskWithTags[] {
  return tasks.filter((task) => {
    if (task.parent_task_id != null) return false;
    if (selection.scope === "trash") return Boolean(task.deleted_at);
    if (task.deleted_at) return false;
    if (selection.scope === "completed" && task.status !== "done") return false;
    if (selection.scope === "list" && task.list_id !== selection.listId) return false;
    if (selection.scope === "today") {
      if (task.status === "done" || task.status === "cancelled") return false;
      const value = taskDate(task);
      if (!value) return false;
      if (!isSameDay(new Date(value), new Date()) && !isOverdue(value)) return false;
    }
    if (selection.scope === "upcoming") {
      if (task.status === "done" || task.status === "cancelled") return false;
      if (!isWithinNextSevenDays(taskDate(task))) return false;
    }
    return true;
  });
}

export function searchTasks(
  tasks: TaskWithTags[],
  query: string,
  lists: TaskList[]
): TaskWithTags[] {
  const normalized = query.trim().toLocaleLowerCase();
  // 空查询返回空结果：搜索页语义是"输入关键词开始搜索"，不应列出全部任务
  if (!normalized) return [];
  const listNames = new Map(lists.map((list) => [list.id, list.name]));
  return tasks.filter((task) => {
    if (task.deleted_at) return false;
    const fields = [
      task.title,
      task.description || "",
      listNames.get(task.list_id || "") || "",
      ...(task.tags || []).map((tag) => tag.name),
    ];
    return fields.some((field) => field.toLocaleLowerCase().includes(normalized));
  });
}

function describeReason(reason: unknown): string {
  if (reason && typeof reason === "object" && "message" in reason) return String(reason.message);
  return String(reason);
}

export async function fetchTaskWorkspace(
  supabase: SupabaseClient
): Promise<TaskWorkspaceData> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { tasks: [], lists: [], tags: [], dependencies: [], warnings: [] };

  // F03：主查询（tasks）失败抛错，由调用方保留旧数据并提供重试；
  // 辅助查询失败收集为 warnings 单独说明，不吞掉也不阻塞主数据
  const results = await Promise.allSettled([
    (async () => {
      // F04：数据库单请求默认 1000 行上限——分块循环拉全量，
      // 保证侧栏计数/提醒汇总/搜索不吃静默截断
      const PAGE = 1000;
      const SAFETY_MAX = 10000;
      const rows: Task[] = [];
      for (let from = 0; from < SAFETY_MAX; from += PAGE) {
        const { data, error } = await supabase
          .from("tasks")
          .select("*")
          .eq("user_id", user.id)
          .order("is_pinned", { ascending: false })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...((data || []) as Task[]));
        if (!data || data.length < PAGE) break;
      }
      return { data: rows, error: null };
    })(),
    supabase
      .from("task_lists")
      .select("*")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true })
      .is("deleted_at", null),
    supabase.from("task_tags").select("task_id, tag_id"),
    supabase.from("tags").select("id, name, color").eq("user_id", user.id),
    supabase
      .from("task_dependencies")
      .select("*")
      .eq("user_id", user.id),
    // 已删任务走 security definer RPC（RLS 下普通查询不可见，migration 050），
    // 供垃圾桶 scope 列表与侧栏计数使用
    supabase.rpc("list_trashed_tasks"),
  ]);

  const [taskResult, listResult, tagLinkResult, tagResult, dependencyResult, trashedResult] = results;
  if (taskResult.status === "rejected") {
    throw new Error(`任务数据加载失败：${describeReason(taskResult.reason)}`);
  }
  const warnings: string[] = [];
  const auxLabels = ["清单列表", "标签关联", "标签", "任务依赖", "垃圾桶"];
  results.slice(1).forEach((result, index) => {
    if (result.status === "rejected") {
      warnings.push(`${auxLabels[index]}加载失败：${describeReason(result.reason)}`);
    }
  });

  const taskData = taskResult.status === "fulfilled" ? taskResult.value.data : null;
  const listData = listResult.status === "fulfilled" ? listResult.value.data : null;
  const tagLinks = tagLinkResult.status === "fulfilled" ? tagLinkResult.value.data : null;
  const tagData = tagResult.status === "fulfilled" ? tagResult.value.data : null;
  const dependencyData = dependencyResult.status === "fulfilled" ? dependencyResult.value.data : null;

  const lists = (listData || []) as TaskList[];
  const listByCategory = new Map<string, string>();
  for (const list of lists) {
    if (list.name === "工作") listByCategory.set("work", list.id);
    if (list.name === "学习") listByCategory.set("study", list.id);
    if (list.name === "生活") listByCategory.set("life", list.id);
  }
  const tagMap = new Map((tagData || []).map((tag) => [tag.id, tag as Tag]));
  const tagsByTask = new Map<string, Tag[]>();
  const tagCounts = new Map<string, number>();
  for (const link of tagLinks || []) {
    const tag = tagMap.get(link.tag_id);
    if (!tag) continue;
    tagsByTask.set(link.task_id, [
      ...(tagsByTask.get(link.task_id) || []),
      tag,
    ]);
    tagCounts.set(link.tag_id, (tagCounts.get(link.tag_id) || 0) + 1);
  }
  const tasks = (taskData || []).map((value) => {
    const task = value as Task;
    return {
      ...task,
      list_id: task.list_id || listByCategory.get(task.category) || null,
      schedule_start_at: task.schedule_start_at || task.due_date,
      tags: tagsByTask.get(task.id) || [],
    } as TaskWithTags;
  });
  const tags = (tagData || []).map((tag) => ({
    ...(tag as Tag),
    task_count: tagCounts.get(tag.id) || 0,
  }));
  // 垃圾桶 RPC 失败不阻塞工作台主数据，仅垃圾桶视图拿不到已删项（记入 warnings）
  const trashedTasks = trashedResult.status === "fulfilled" && Array.isArray(trashedResult.value)
    ? (trashedResult.value as unknown as TaskWithTags[])
    : [];
  return {
    tasks: [...tasks, ...trashedTasks],
    lists,
    tags,
    dependencies: (dependencyData || []) as TaskDependency[],
    warnings,
  };
}

export function useTaskWorkspaceData() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<TaskWorkspaceData>({
    tasks: [],
    lists: [],
    tags: [],
    dependencies: [],
    warnings: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchTaskWorkspace(supabase));
    } catch (e) {
      // F03：主查询失败保留旧数据，暴露错误给调用方展示重试
      setError(e instanceof Error ? e.message : "任务数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void refetch();
    const reload = () => void refetch();
    window.addEventListener("organize:tasks-changed", reload);
    return () => window.removeEventListener("organize:tasks-changed", reload);
  }, [refetch]);

  return { ...data, loading, error, refetch, supabase };
}
