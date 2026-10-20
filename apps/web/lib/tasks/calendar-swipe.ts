/**
 * 手机日历左右滑动翻页的判定（纯函数）。组件只负责收集 pointer 位移。
 * 约定：手指向左滑（dx < 0）= 下一页（+1），向右滑 = 上一页（−1）。
 */

/** 水平位移至少多少像素才算一次翻页滑动 */
export const SWIPE_STEP_PX = 60;
/** 水平分量至少是垂直分量的多少倍（「水平分量明显大于垂直」） */
export const SWIPE_AXIS_RATIO = 2;
/** 位移超过这个值后锁定手势轴向：先走出纵向的手势不再被当作滑动 */
export const SWIPE_AXIS_LOCK_PX = 12;

export type SwipeAxis = "pending" | "horizontal" | "vertical";

export interface SwipePointerLike {
  pointerType?: string;
  isPrimary?: boolean;
  button?: number;
}

/** 只跟踪触控 / 触笔的主指针左键：鼠标在桌面拖拽，不该翻页。 */
export function acceptSwipePointer(pointer: SwipePointerLike): boolean {
  if (pointer.pointerType === "mouse") return false;
  if (pointer.isPrimary === false) return false;
  return (pointer.button ?? 0) === 0;
}

/** 位移未超过锁定距离时仍是 pending；之后按主导方向一次性锁定。 */
export function classifySwipeAxis(dx: number, dy: number): SwipeAxis {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_AXIS_LOCK_PX) return "pending";
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}

/** 达到翻页阈值时返回方向；否则 null。 */
export function swipeStepDirection(dx: number, dy: number): -1 | 1 | null {
  if (Math.abs(dx) < SWIPE_STEP_PX) return null;
  if (Math.abs(dx) < SWIPE_AXIS_RATIO * Math.abs(dy)) return null;
  return dx < 0 ? 1 : -1;
}

export interface SwipeGesture {
  pointerId: number;
  startX: number;
  startY: number;
  axis: SwipeAxis;
  fired: boolean;
}

export function beginSwipe(pointerId: number, x: number, y: number): SwipeGesture {
  return { pointerId, startX: x, startY: y, axis: "pending", fired: false };
}

/**
 * 推进一次手势：返回新状态与本次是否应触发翻页（整个手势最多一次）。
 * 轴向一旦锁定为纵向就不再翻页，避免对角拖动误触。
 */
export function advanceSwipe(gesture: SwipeGesture, x: number, y: number): { gesture: SwipeGesture; step: -1 | 1 | null } {
  const dx = x - gesture.startX;
  const dy = y - gesture.startY;
  const axis = gesture.axis === "pending" ? classifySwipeAxis(dx, dy) : gesture.axis;
  if (axis !== "horizontal" || gesture.fired) return { gesture: { ...gesture, axis }, step: null };
  const step = swipeStepDirection(dx, dy);
  return { gesture: { ...gesture, axis, fired: step !== null }, step };
}
