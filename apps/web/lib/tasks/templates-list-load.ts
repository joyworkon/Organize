/**
 * 任务模板列表加载结果落到 UI 状态的纯逻辑（供 task-templates-dialog 接线并单测）。
 *
 * supabase 查询失败时 error 非空 / data 为 null——调用方若直接 `setTemplates(data ?? [])`
 * 会把加载失败伪装成「还没有任务模板」。这里统一裁决：
 * - 成功：整体替换并清错；
 * - 失败：保留上次成功快照——把加载失败伪装成空列表等于撒谎。
 * 与 lib/lessons/list-load.ts 的 nextLessonsAfterLoad（#388）同构。
 */

import type { TaskTemplate } from "@organize/shared";

export const TASK_TEMPLATES_LIST_LOAD_ERROR_MESSAGE = "任务模板加载失败";

/** nextTemplatesAfterLoad 的返回：UI 该落到什么快照、错误提示文案 */
export interface TaskTemplatesLoadPlan {
  templates: TaskTemplate[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

export function nextTemplatesAfterLoad({
  previous,
  data,
  error,
}: {
  /** 上次成功快照；失败时原样返回（同引用，React 跳过重渲染） */
  previous: TaskTemplate[];
  /** task_templates 查询结果；error 非空或 data 为 null 即失败事实，不吞成空数组 */
  data: TaskTemplate[] | null;
  error: { message?: string } | null;
}): TaskTemplatesLoadPlan {
  if (error || data === null) {
    const message = error?.message?.trim();
    return {
      templates: previous,
      loadError: message || TASK_TEMPLATES_LIST_LOAD_ERROR_MESSAGE,
    };
  }
  return { templates: data, loadError: null };
}
