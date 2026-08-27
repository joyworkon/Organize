import type { Task, TaskDependency } from "@organize/shared";

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
