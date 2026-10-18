import type { TaskList, TaskWithTags } from "@organize/shared";

export const TASK_REPOSITORY_LOAD_ERROR_MESSAGE = "任务列表加载失败";

export type TaskRepositoryLoadPlan = {
  tasks: TaskWithTags[];
  lists: TaskList[];
  loadError: string | null;
};

export function nextTaskRepositoryAfterLoad({
  previousTasks,
  previousLists,
  tasks,
  lists,
}: {
  previousTasks: TaskWithTags[];
  previousLists: TaskList[];
  tasks: { data: TaskWithTags[] | null; error: { message?: string } | null };
  lists: { data: TaskList[] | null; error: { message?: string } | null };
}): TaskRepositoryLoadPlan {
  if (tasks.error || tasks.data === null || lists.error || lists.data === null) {
    return {
      tasks: previousTasks,
      lists: previousLists,
      loadError:
        tasks.error?.message?.trim() ||
        lists.error?.message?.trim() ||
        TASK_REPOSITORY_LOAD_ERROR_MESSAGE,
    };
  }

  return { tasks: tasks.data, lists: lists.data, loadError: null };
}
