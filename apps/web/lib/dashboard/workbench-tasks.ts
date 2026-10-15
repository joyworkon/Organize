import type { TaskWithTags } from "@organize/shared";

export function mergeActionableTasks(...groups: TaskWithTags[][]): TaskWithTags[] {
  return [...new Map(groups.flat().map((task) => [task.id, task])).values()];
}
