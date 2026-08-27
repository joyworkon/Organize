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
}

export function taskDate(task: Task): string | null {
  return task.schedule_start_at || task.due_date || null;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
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

export async function fetchTaskWorkspace(
  supabase: SupabaseClient
): Promise<TaskWorkspaceData> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { tasks: [], lists: [], tags: [], dependencies: [] };

  const [{ data: taskData }, { data: listData }, { data: tagLinks }, { data: tagData }, { data: dependencyData }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .order("is_pinned", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
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
    ]);

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
  return {
    tasks,
    lists,
    tags,
    dependencies: (dependencyData || []) as TaskDependency[],
  };
}

export function useTaskWorkspaceData() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<TaskWorkspaceData>({
    tasks: [],
    lists: [],
    tags: [],
    dependencies: [],
  });
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchTaskWorkspace(supabase));
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

  return { ...data, loading, refetch, supabase };
}
