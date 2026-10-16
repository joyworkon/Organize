import type { ReadingStatus } from "@organize/shared";

/**
 * 阅读进度 → 持久化补丁（纯函数）。只前进不后退：新进度不大于已保存进度时返回 null。
 * ≥95% 视为读完（read）；>5% 且原为 unread 时转为 reading；其余保持原状态。
 */
export function nextReadingProgress(
  progressPercent: number,
  savedProgress: number,
  currentStatus: ReadingStatus,
): { progress: number; status: ReadingStatus } | null {
  const progress = Math.round(Math.min(Math.max(progressPercent, 0), 100)) / 100;
  if (progress <= savedProgress) return null;
  let status = currentStatus;
  if (progressPercent >= 95) status = "read";
  else if (progressPercent > 5 && status === "unread") status = "reading";
  return { progress, status };
}

/**
 * ?hl= 深链只在正文容器已挂载（不在 loading）且高亮已加载时才消费；
 * 过早消费会导致正文挂载后永远不再定位。返回要定位的高亮 id，或 null（暂不消费）。
 */
export function readyHighlightDeepLink(
  pendingId: string | null,
  state: { loading: boolean; hasContainer: boolean; highlightCount: number },
): string | null {
  if (!pendingId) return null;
  if (state.loading || !state.hasContainer || state.highlightCount === 0) return null;
  return pendingId;
}
