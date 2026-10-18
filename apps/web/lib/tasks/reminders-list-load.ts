/**
 * 任务提醒列表加载结果落到 UI 状态的纯逻辑（供 task-reminders-editor 接线并单测）。
 *
 * supabase 查询失败时 error 非空 / data 为 null——调用方若直接 `setReminders(data ?? [])`
 * 会把加载失败伪装成「当前没有提醒」。这里统一裁决：
 * - 成功：整体替换并清错；
 * - 失败：保留上次成功快照——把加载失败伪装成空列表等于撒谎。
 * 与 lib/tasks/attachments-list-load.ts 的 nextAttachmentsAfterLoad（#390）同构；
 * 不动 lib/tasks/reminders.ts（预设 / label / fireAt 等业务规则）。
 */

import type { TaskReminder } from "@organize/shared";

export const TASK_REMINDERS_LIST_LOAD_ERROR_MESSAGE = "任务提醒加载失败";

/** nextRemindersAfterLoad 的返回：UI 该落到什么快照、错误提示文案 */
export interface TaskRemindersLoadPlan {
  reminders: TaskReminder[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

export function nextRemindersAfterLoad({
  previous,
  data,
  error,
}: {
  /** 上次成功快照；失败时原样返回（同引用，React 跳过重渲染） */
  previous: TaskReminder[];
  /** task_reminders 查询结果；error 非空或 data 为 null 即失败事实，不吞成空数组 */
  data: TaskReminder[] | null;
  error: { message?: string } | null;
}): TaskRemindersLoadPlan {
  if (error || data === null) {
    const message = error?.message?.trim();
    return {
      reminders: previous,
      loadError: message || TASK_REMINDERS_LIST_LOAD_ERROR_MESSAGE,
    };
  }
  return { reminders: data, loadError: null };
}
