"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Tag,
  TagWithCount,
  Task,
  TaskList,
  TaskWithTags,
} from "@organize/shared";
import type { SidebarSelection } from "@/components/tasks/task-sidebar";

type SupabaseClient = ReturnType<typeof createClient>;

export interface TaskWorkspaceData {
  tasks: TaskWithTags[];
  lists: TaskList[];
  tags: TagWithCount[];
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

export function isWithinNextSevenDays(value: string | null | undefined): boolean {
  if (!value) return false;
  const diff = (new Date(value).getTime() - Date.now()) / 86400000;
  return diff >= 0 && diff < 7;
}

/** 快速添加任务时，日期范围页需要给新任务一个可见的默认日期。 */
export function quickAddDueDate(
  scope: SidebarSelection["scope"],
  now = new Date()
): string | null {
  if (scope === "today") return now.toISOString();
  if (scope === "upcoming") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow.toISOString();
  }
  return null;
}

/** 将任务列表范围应用到一份已经加载的任务数组。 */
export function filterTasksByScope(
  tasks: TaskWithTags[],
  selection: SidebarSelection
): TaskWithTags[] {
  return tasks.filter((task) => {
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
  if (!user) return { tasks: [], lists: [], tags: [] };

  const [{ data: taskData }, { data: listData }, { data: tagLinks }, { data: tagData }] =
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
  return { tasks, lists, tags };
}

export function useTaskWorkspaceData() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<TaskWorkspaceData>({
    tasks: [],
    lists: [],
    tags: [],
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
