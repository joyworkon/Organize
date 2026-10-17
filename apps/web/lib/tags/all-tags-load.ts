import type { TagWithCount } from "@organize/shared";

export const TAGS_EMPTY_MESSAGE = "还没有标签";
export const TAGS_LOAD_ERROR_MESSAGE = "标签加载失败";

/** 一次标签列表加载的结果：成功携带新列表，失败携带错误文案。 */
export type AllTagsLoadOutcome =
  | { ok: true; tags: TagWithCount[] }
  | { ok: false; error: string };

/**
 * 标签列表加载后的下一份状态：
 * - 成功：整体替换并清除错误；
 * - 失败：保留上一次成功的数据（从未成功过则为空数组）并记录错误，
 *   不把「加载失败」伪装成「没有标签」，也不清空还能用的旧列表。
 */
export function nextAllTagsAfterLoad(
  previous: TagWithCount[],
  outcome: AllTagsLoadOutcome
): { tags: TagWithCount[]; loadError: string | null } {
  if (outcome.ok) {
    return { tags: outcome.tags, loadError: null };
  }
  return { tags: previous, loadError: outcome.error };
}

/** 只有「非加载中、无错误、列表为空」才是真的没有标签。 */
export function shouldShowTagsEmpty(
  tags: TagWithCount[],
  loadError: string | null,
  loading: boolean
): boolean {
  return !loading && loadError === null && tags.length === 0;
}

/** 空态单行文案：加载失败与真的没有标签分开说。 */
export function tagsEmptyMessage(loadError: string | null): string {
  return loadError === null ? TAGS_EMPTY_MESSAGE : TAGS_LOAD_ERROR_MESSAGE;
}
