import type { Task, TaskDependency } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";

type SupabaseClient = ReturnType<typeof createClient>;

export interface TaskDependencyView {
  prerequisites: Task[];
  dependents: Task[];
  blockingPrerequisites: Task[];
}

export function getTaskDependencyView(
  tasks: Task[],
  dependencies: TaskDependency[],
  taskId: string
): TaskDependencyView {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const prerequisites = dependencies
    .filter((edge) => edge.task_id === taskId)
    .map((edge) => taskMap.get(edge.depends_on_task_id))
    .filter((task): task is Task => Boolean(task));
  const dependents = dependencies
    .filter((edge) => edge.depends_on_task_id === taskId)
    .map((edge) => taskMap.get(edge.task_id))
    .filter((task): task is Task => Boolean(task));

  return {
    prerequisites,
    dependents,
    // 已删/已放弃的前置不算阻塞：它们对用户不可见或永不发生，
    // 继续阻塞会让「全部任务」里挂着看不见的前置、确认框点名幽灵任务
    blockingPrerequisites: prerequisites.filter(
      (task) => task.status !== "done" && !task.deleted_at && task.status !== "cancelled"
    ),
  };
}

export function getBlockedTaskIds(
  tasks: Task[],
  dependencies: TaskDependency[]
): Set<string> {
  const clearedIds = new Set(
    tasks
      .filter((task) => task.status === "done" || task.status === "cancelled" || Boolean(task.deleted_at))
      .map((task) => task.id)
  );
  return new Set(
    dependencies
      .filter((edge) => !clearedIds.has(edge.depends_on_task_id))
      .map((edge) => edge.task_id)
  );
}

export function wouldCreateTaskDependencyCycle(
  dependencies: TaskDependency[],
  taskId: string,
  prerequisiteId: string
): boolean {
  if (taskId === prerequisiteId) return true;
  const graph = new Map<string, string[]>();
  for (const edge of dependencies) {
    graph.set(edge.task_id, [
      ...(graph.get(edge.task_id) || []),
      edge.depends_on_task_id,
    ]);
  }
  const pending = [prerequisiteId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const currentId = pending.pop()!;
    if (currentId === taskId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    pending.push(...(graph.get(currentId) || []));
  }
  return false;
}

/**
 * 依赖面板两路并行查询（tasks / task_dependencies）加载结果落到 UI 状态的纯逻辑（供组件接线并单测）：
 * 任一查询失败都不得伪装成「没有数据」——失败部分保留上次成功数据并给出错误条 + 重试，成功部分照常整体替换。
 * 与 lib/tasks/task-detail-load.ts（#367/#368）同构。
 */

/** 依赖面板会展示失败提示的查询名（顺序即提示文案顺序） */
export type TaskDependencyLoadSection = "任务列表" | "依赖关系";

/** supabase-js 查询结果的最小形状：只看 error 的真值，data 由调用方按成功分支自行取用 */
interface QueryLike {
  error: unknown;
}

export function failedTaskDependencyLoadSections({
  tasks,
  dependencies,
}: {
  tasks: QueryLike;
  dependencies: QueryLike;
}): TaskDependencyLoadSection[] {
  const sections: TaskDependencyLoadSection[] = [];
  if (tasks.error) sections.push("任务列表");
  if (dependencies.error) sections.push("依赖关系");
  return sections;
}

/**
 * 失败区块列表 → 错误条文案。列表为空（全部成功）返回 null，调用方据此不渲染错误条。
 * 两项都失败时合并成一句，避免「任务列表加载失败…依赖关系加载失败…」的重复后缀。
 */
export function taskDependencyLoadErrorMessage(
  sections: readonly TaskDependencyLoadSection[]
): string | null {
  if (sections.length === 0) return null;
  if (sections.length === 2) {
    return "任务列表与依赖关系加载失败，显示的内容可能不完整";
  }
  return sections[0] === "任务列表"
    ? "任务列表加载失败，依赖关系可能不完整"
    : "依赖关系加载失败，显示的内容可能不完整";
}

/**
 * 「标记完成」前的前置依赖检查（供任务详情页接线并单测）：
 * 任一查询失败都返回 `{ status: "error" }`，由页面弹确认而不是当作「没有阻塞」静默放行。
 */
export interface TaskCompletionBlocker {
  id: string;
  title: string;
}

export type TaskCompletionBlockersResult =
  | { status: "ok"; blocking: TaskCompletionBlocker[] }
  | { status: "error" };

export async function checkTaskCompletionBlockers(
  supabase: SupabaseClient,
  taskId: string
): Promise<TaskCompletionBlockersResult> {
  const { data: edges, error: edgesError } = await supabase
    .from("task_dependencies")
    .select("depends_on_task_id")
    .eq("task_id", taskId);
  if (edgesError) return { status: "error" };
  const depIds = (edges || []).map((edge) => edge.depends_on_task_id);
  if (depIds.length === 0) return { status: "ok", blocking: [] };
  const { data: prereqs, error: prereqsError } = await supabase
    .from("tasks")
    .select("id, title, status")
    .in("id", depIds);
  if (prereqsError) return { status: "error" };
  const blocking = (prereqs || [])
    .filter((prereq) => prereq.status !== "done")
    .map((prereq) => ({ id: prereq.id, title: prereq.title }));
  return { status: "ok", blocking };
}
