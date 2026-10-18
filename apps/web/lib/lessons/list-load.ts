/**
 * 复盘列表加载结果落到 UI 状态的纯逻辑（供 lessons-list 接线并单测）。
 *
 * supabase 查询失败时 error 非空 / data 为 null——调用方若直接 `setLessons(data ?? [])`
 * 会把加载失败伪装成「还没有复盘」。这里统一裁决：
 * - 成功：整体替换并清错；
 * - 失败：保留上次成功快照——把加载失败伪装成空列表等于撒谎。
 * 与 lib/reading/list-load.ts 的 nextReadingItemsAfterLoad（#387）同构。
 */

import type { LessonWithTags } from "@organize/shared";

export const LESSONS_LIST_LOAD_ERROR_MESSAGE = "复盘列表加载失败";

/** nextLessonsAfterLoad 的返回：UI 该落到什么快照、错误提示文案 */
export interface LessonsLoadPlan {
  lessons: LessonWithTags[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

export function nextLessonsAfterLoad({
  previous,
  data,
  error,
}: {
  /** 上次成功快照；失败时原样返回（同引用，React 跳过重渲染） */
  previous: LessonWithTags[];
  /** lessons 查询结果；error 非空或 data 为 null 即失败事实，不吞成空数组 */
  data: LessonWithTags[] | null;
  error: { message?: string } | null;
}): LessonsLoadPlan {
  if (error || data === null) {
    const message = error?.message?.trim();
    return {
      lessons: previous,
      loadError: message || LESSONS_LIST_LOAD_ERROR_MESSAGE,
    };
  }
  return { lessons: data, loadError: null };
}
