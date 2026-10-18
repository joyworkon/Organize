// 速记标签计数的本地兜底：/api/memos/tags 聚合失败（非 2xx / 网络异常）时，
// 基于当前已加载的速记在前端统计，避免标签筛选条整条消失。
// 排序与 /api/memos/tags 路由一致：数量降序、同数按名称 localeCompare 升序。

/** 降级提示文案：标签条按已加载速记本地计数时展示 */
export const MEMO_TAG_COUNTS_FALLBACK_HINT = "标签统计暂不可用，以下按已加载速记计数";

export function countMemoTagsLocally(memos: Array<{ tags?: string[] | null }>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const memo of memos) {
    for (const tag of memo.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
