/** 日/周时间网格「拖边缘改时长 + 键盘微调」的纯函数，独立于组件便于单测。 */

/** resize 吸附粒度（分钟）；整块 move 改期仍用 30 分钟，两套规则互不影响。 */
export const RESIZE_SNAP_MIN = 15;
/** 定时任务的最短时长（分钟）。 */
export const RESIZE_MIN_DURATION_MIN = 15;
const DAY_MINUTES = 1440;

export interface ResizeRangeInput {
  /** 拖动的是上沿（改开始）还是下沿（改结束）。 */
  edge: "start" | "end";
  startMin: number;
  endMin: number;
  /** 指针位置换算成的当天分钟数（未吸附）。 */
  pointerMin: number;
}

/**
 * 按指针位置计算 resize 后的范围：15 分钟吸附、最短 15 分钟、夹在 0..1440，
 * 拖过对边时夹住而非翻转（与 Google 日历一致）。
 */
export function resizeRangeFromPointer({
  edge,
  startMin,
  endMin,
  pointerMin,
}: ResizeRangeInput): { startMin: number; endMin: number } {
  const snapped = Math.min(
    DAY_MINUTES,
    Math.max(0, Math.round(pointerMin / RESIZE_SNAP_MIN) * RESIZE_SNAP_MIN)
  );
  if (edge === "start") {
    return { startMin: Math.min(snapped, endMin - RESIZE_MIN_DURATION_MIN), endMin };
  }
  return { startMin, endMin: Math.max(snapped, startMin + RESIZE_MIN_DURATION_MIN) };
}

export interface NudgeRangeInput {
  startMin: number;
  endMin: number;
  /** 有符号分钟增量。 */
  deltaMin: number;
  /** move 整体平移保持时长；resize-end 只改结束时间。 */
  mode: "move" | "resize-end";
}

/** 键盘微调：move 夹在当天（时长不变），resize-end 最短 15 分钟且不越过午夜。 */
export function nudgeRange({
  startMin,
  endMin,
  deltaMin,
  mode,
}: NudgeRangeInput): { startMin: number; endMin: number } {
  if (mode === "move") {
    const duration = endMin - startMin;
    const start = Math.max(0, Math.min(DAY_MINUTES - duration, startMin + deltaMin));
    return { startMin: start, endMin: start + duration };
  }
  const end = Math.min(
    DAY_MINUTES,
    Math.max(startMin + RESIZE_MIN_DURATION_MIN, endMin + deltaMin)
  );
  return { startMin, endMin: end };
}
