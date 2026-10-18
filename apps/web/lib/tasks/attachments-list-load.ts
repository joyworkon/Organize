/**
 * 任务附件列表加载结果落到 UI 状态的纯逻辑（供 task-attachments-dialog 接线并单测）。
 *
 * supabase 查询失败时 error 非空 / data 为 null——调用方若直接 `setAttachments(data ?? [])`
 * 会把加载失败伪装成「暂无任务附件」。这里统一裁决：
 * - 成功：整体替换并清错；
 * - 失败：保留上次成功快照——把加载失败伪装成空列表等于撒谎。
 * 与 lib/tasks/templates-list-load.ts 的 nextTemplatesAfterLoad（#389）同构。
 */

import type { TaskAttachment } from "@organize/shared";

export const TASK_ATTACHMENTS_LIST_LOAD_ERROR_MESSAGE = "任务附件加载失败";

/** nextAttachmentsAfterLoad 的返回：UI 该落到什么快照、错误提示文案 */
export interface TaskAttachmentsLoadPlan {
  attachments: TaskAttachment[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

export function nextAttachmentsAfterLoad({
  previous,
  data,
  error,
}: {
  /** 上次成功快照；失败时原样返回（同引用，React 跳过重渲染） */
  previous: TaskAttachment[];
  /** task_attachments 查询结果；error 非空或 data 为 null 即失败事实，不吞成空数组 */
  data: TaskAttachment[] | null;
  error: { message?: string } | null;
}): TaskAttachmentsLoadPlan {
  if (error || data === null) {
    const message = error?.message?.trim();
    return {
      attachments: previous,
      loadError: message || TASK_ATTACHMENTS_LIST_LOAD_ERROR_MESSAGE,
    };
  }
  return { attachments: data, loadError: null };
}
