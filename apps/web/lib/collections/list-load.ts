/**
 * 集合列表加载结果落到 UI 状态的纯逻辑（供 add-to-collection-dialog 接线并单测）。
 *
 * /api/collections 失败（!res.ok 或 fetch 抛错）时调用方若直接把 collections 留在
 * 初值 []，会把加载失败伪装成「还没有集合」。这里统一裁决：
 * - 成功：整体替换并清错；
 * - 失败：保留上次成功快照——把加载失败伪装成空列表等于撒谎。
 * 与 lib/tasks/templates-list-load.ts 的 nextTemplatesAfterLoad（#389）同构。
 */

import type { CollectionSummary } from "@/lib/collections/types";

export const COLLECTIONS_LIST_LOAD_ERROR_MESSAGE = "集合加载失败";

/** nextCollectionsAfterLoad 的返回：UI 该落到什么快照、错误提示文案 */
export interface CollectionsLoadPlan {
  collections: CollectionSummary[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

export function nextCollectionsAfterLoad({
  previous,
  data,
  error,
}: {
  /** 上次成功快照；失败时原样返回（同引用，React 跳过重渲染） */
  previous: CollectionSummary[];
  /** /api/collections 成功响应里的列表；error 非空或 data 为 null 即失败事实，不吞成空数组 */
  data: CollectionSummary[] | null;
  error: { message?: string } | null;
}): CollectionsLoadPlan {
  if (error || data === null) {
    const message = error?.message?.trim();
    return {
      collections: previous,
      loadError: message || COLLECTIONS_LIST_LOAD_ERROR_MESSAGE,
    };
  }
  return { collections: data, loadError: null };
}
