/**
 * 构思画布列表加载结果落到 UI 状态的纯逻辑（供 canvas/page.tsx 接线并单测）。
 *
 * `listCanvases()` 失败时返回 null 而不抛错——调用方若直接 `setItems(list ?? [])`
 * 会把加载失败伪装成「还没有画布」。这里统一裁决：
 * - 成功：整体替换并清错；
 * - 失败：保留上次成功快照——把加载失败伪装成空列表等于撒谎。
 * 与 lib/tasks/countdown.ts 的 nextCountdownDaysAfterLoad（#385）同构。
 */

import type { CanvasListItem } from "./repository";

export const CANVAS_LIST_LOAD_ERROR_MESSAGE = "画布列表加载失败";

/** nextCanvasItemsAfterLoad 的返回：UI 该落到什么快照、错误提示文案 */
export interface CanvasItemsLoadPlan {
  items: CanvasListItem[] | null;
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

export function nextCanvasItemsAfterLoad({
  previous,
  list,
}: {
  /** 上次成功快照；失败时原样返回（同引用，React 跳过重渲染） */
  previous: CanvasListItem[] | null;
  /** listCanvases() 的结果；null 即失败事实，不吞成空数组 */
  list: CanvasListItem[] | null;
}): CanvasItemsLoadPlan {
  if (list === null) {
    return { items: previous, loadError: CANVAS_LIST_LOAD_ERROR_MESSAGE };
  }
  return { items: list, loadError: null };
}
