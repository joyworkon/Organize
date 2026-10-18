/**
 * 稍后读状态分段计数（全部/未读/在读/已读）加载结果落到 UI 状态的纯逻辑（供 reading-view 接线并单测）。
 *
 * supabase 计数查询失败时 error 非空 / data 为 null——调用方若直接 `data || []` 再计数，
 * 会把加载失败伪装成「一篇都没有 / 没有未读」（四个计数全变 0）。这里统一裁决：
 * - 成功：按行重新计数并清错；
 * - 失败：保留上次成功计数（从未成功过则为 null，UI 显示「—」而不是假 0）。
 * 与 lib/reading/list-load.ts 的 nextReadingItemsAfterLoad 同构。
 */

export const READING_STATS_LOAD_ERROR_MESSAGE = "计数加载失败";

/** 状态分段计数的四格数字 */
export interface ReadingStats {
  total: number;
  unread: number;
  reading: number;
  read: number;
}

/** nextReadingStatsAfterLoad 的返回：UI 该落到什么计数、错误提示文案 */
export interface ReadingStatsLoadPlan {
  /** null 表示从未成功加载过（UI 显示「—」，不是假 0） */
  stats: ReadingStats | null;
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  statsError: string | null;
}

/** 成功行集合计数；未知/null 状态只计入 total（与旧 filter 语义一致） */
export function countReadingStats(
  rows: Array<{ reading_status?: string | null }>
): ReadingStats {
  const stats: ReadingStats = { total: rows.length, unread: 0, reading: 0, read: 0 };
  for (const status of rows) {
    if (status.reading_status === "unread") stats.unread += 1;
    else if (status.reading_status === "reading") stats.reading += 1;
    else if (status.reading_status === "read") stats.read += 1;
  }
  return stats;
}

export function nextReadingStatsAfterLoad({
  previous,
  data,
  error,
}: {
  /** 上次成功计数；失败时原样返回（同引用，React 跳过重渲染）；null 表示从未成功加载过 */
  previous: ReadingStats | null;
  /** reading_items 只取 reading_status 的查询结果；error 非空或 data 为 null 即失败事实，不吞成全 0 */
  data: Array<{ reading_status?: string | null }> | null;
  error: { message?: string } | null;
}): ReadingStatsLoadPlan {
  if (error || data === null) {
    const message = error?.message?.trim();
    return {
      stats: previous,
      statsError: message || READING_STATS_LOAD_ERROR_MESSAGE,
    };
  }
  return { stats: countReadingStats(data), statsError: null };
}
