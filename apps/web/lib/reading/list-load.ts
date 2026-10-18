/**
 * 稍后读列表加载结果落到 UI 状态的纯逻辑（供 reading-view 接线并单测）。
 *
 * supabase 查询失败时 error 非空 / data 为 null——调用方若直接 `setItems(data ?? [])`
 * 会把加载失败伪装成「还没有保存的内容」，标签筛选失败则伪装成「没有找到匹配的内容」。
 * 这里统一裁决：
 * - 成功：整体替换并清错；
 * - 失败：保留上次成功快照——把加载失败伪装成空列表等于撒谎。
 * 与 lib/canvas/list-load.ts 的 nextCanvasItemsAfterLoad（#386）同构。
 */

import type { ReadingItem } from "@organize/shared";

export const READING_LIST_LOAD_ERROR_MESSAGE = "稍后读列表加载失败";
export const READING_TAG_FILTER_ERROR_MESSAGE = "标签筛选加载失败";

/** nextReadingItemsAfterLoad 的返回：UI 该落到什么快照、错误提示文案 */
export interface ReadingItemsLoadPlan {
  items: ReadingItem[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

function loadErrorMessage(
  error: { message?: string } | null,
  fallback: string
): string {
  const message = error?.message?.trim();
  return message || fallback;
}

export function nextReadingItemsAfterLoad({
  previous,
  data,
  error,
}: {
  /** 上次成功快照；失败时原样返回（同引用，React 跳过重渲染） */
  previous: ReadingItem[];
  /** reading_items 查询结果；error 非空或 data 为 null 即失败事实，不吞成空数组 */
  data: ReadingItem[] | null;
  error: { message?: string } | null;
}): ReadingItemsLoadPlan {
  if (error || data === null) {
    return {
      items: previous,
      loadError: loadErrorMessage(error, READING_LIST_LOAD_ERROR_MESSAGE),
    };
  }
  return { items: data, loadError: null };
}

/** 标签筛选前置查询（item_tags）三种结局的判别 */
export type ReadingTagScopePlan =
  /** 查询失败：保留 previous，不把失败伪装成「没有找到匹配的内容」 */
  | { status: "error"; items: ReadingItem[]; loadError: string }
  /** 查询成功但该组标签下确实没有条目：真空列表 */
  | { status: "empty"; items: []; loadError: null }
  /** 查询成功且有命中：拿 scopedIds 继续 reading_items 主查询（items 由主查询决定） */
  | { status: "scoped"; scopedIds: string[]; loadError: null };

export function nextReadingItemsAfterTagScope({
  previous,
  tagRows,
  tagError,
}: {
  /** 上次成功快照；查询失败时原样返回 */
  previous: ReadingItem[];
  tagRows: Array<{ item_id: string | null }> | null;
  tagError: { message?: string } | null;
}): ReadingTagScopePlan {
  if (tagError || tagRows === null) {
    return {
      status: "error",
      items: previous,
      loadError: loadErrorMessage(tagError, READING_TAG_FILTER_ERROR_MESSAGE),
    };
  }
  const scopedIds = Array.from(
    new Set(
      tagRows
        .map((r) => r.item_id)
        .filter((id): id is string => id != null)
    )
  );
  if (scopedIds.length === 0) return { status: "empty", items: [], loadError: null };
  return { status: "scoped", scopedIds, loadError: null };
}
