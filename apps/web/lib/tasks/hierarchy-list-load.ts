/**
 * 任务层级（父/子任务）加载结果落到 UI 状态的纯逻辑（供 task-hierarchy 接线并单测）。
 *
 * supabase 查询失败时 error 非空 / data 为 null——调用方若直接 `setChildren(data || [])`
 * 会把加载失败伪装成「当前没有子任务 / 没有上级」。这里统一裁决两侧结果：
 * - 成功：该侧整体替换；两侧都成功时清错；
 * - 失败：该侧保留上次成功快照——把加载失败伪装成空列表等于撒谎；
 * - parent 入参为 null 表示本任务无 parent_task_id、父查询被跳过，视为成功且无上级，
 *   不计入失败；父查询（非跳过）data === null 且无 error 是 maybeSingle 未命中，视为成功。
 * 与 lib/tasks/reminders-list-load.ts（#391）/ attachments-list-load.ts（#390）同构；
 * 不动添加/完成子任务与重复任务生成等业务逻辑。
 */

import type { Task } from "@organize/shared";

export const TASK_HIERARCHY_LIST_LOAD_ERROR_MESSAGE = "任务层级加载失败";

/** nextHierarchyAfterLoad 的返回：UI 该落到什么快照、错误提示文案 */
export interface TaskHierarchyLoadPlan {
  children: Task[];
  parent: Task | null;
  /** 非空表示至少一侧加载失败；null 表示两侧都成功 */
  loadError: string | null;
}

export function nextHierarchyAfterLoad({
  previousChildren,
  previousParent,
  children,
  parent,
}: {
  previousChildren: Task[];
  previousParent: Task | null;
  /** 子任务查询结果；error 非空或 data 为 null 即失败事实，不吞成空数组 */
  children: { data: Task[] | null; error: { message?: string } | null };
  /** 父任务查询结果；null 表示无 parent_task_id、跳过父查询（合法无上级，非失败） */
  parent: { data: Task | null; error: { message?: string } | null } | null;
}): TaskHierarchyLoadPlan {
  const childrenFailed = Boolean(children.error) || children.data === null;
  // 父侧 data === null 且无 error 是 maybeSingle 未命中（无上级记录），视为成功
  const parentFailed = parent !== null && Boolean(parent.error);
  const failureMessage = children.error?.message?.trim() || parent?.error?.message?.trim();
  if (childrenFailed || parentFailed) {
    return {
      children: childrenFailed ? previousChildren : (children.data as Task[]),
      parent: parentFailed
        ? previousParent
        : parent === null
          ? null
          : (parent.data as Task | null),
      loadError: failureMessage || TASK_HIERARCHY_LIST_LOAD_ERROR_MESSAGE,
    };
  }
  return {
    children: children.data as Task[],
    parent: parent === null ? null : (parent.data as Task | null),
    loadError: null,
  };
}
