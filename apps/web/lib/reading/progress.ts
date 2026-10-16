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
