/**
 * 画布坐标换算（阶段 B2 收敛）：所有 viewport ↔ world 换算必须经本模块，
 * 禁止在各组件里手写 (client - rect.left - pan) / zoom 表达式
 *（UI 尺寸常量如加号 22px 不受此限，但坐标换算不得有魔数）。
 */

/** 视口变换：pan（屏幕 px）+ zoom。 */
export interface CanvasViewportTransform {
  x: number;
  y: number;
  zoom: number;
}

/** 屏幕（client 坐标）→ 世界坐标。rect = 视口元素 getBoundingClientRect()。 */
export function screenToWorld(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  vp: CanvasViewportTransform,
): { x: number; y: number } {
  return {
    x: (clientX - rect.left - vp.x) / vp.zoom,
    y: (clientY - rect.top - vp.y) / vp.zoom,
  };
}

/** 世界坐标 → 视口内屏幕坐标（相对视口左上角）。 */
export function worldToScreen(
  wx: number,
  wy: number,
  vp: CanvasViewportTransform,
): { x: number; y: number } {
  return { x: wx * vp.zoom + vp.x, y: wy * vp.zoom + vp.y };
}

/** 视口元素的世界矩形（新建页面自动落位用）。 */
export function worldViewportRect(
  rect: { width: number; height: number },
  vp: CanvasViewportTransform,
): { x: number; y: number; width: number; height: number } {
  return {
    x: -vp.x / vp.zoom,
    y: -vp.y / vp.zoom,
    width: rect.width / vp.zoom,
    height: rect.height / vp.zoom,
  };
}

/** 视口中心的世界坐标。 */
export function worldCenter(
  rect: { width: number; height: number },
  vp: CanvasViewportTransform,
): { x: number; y: number } {
  return {
    x: (rect.width / 2 - vp.x) / vp.zoom,
    y: (rect.height / 2 - vp.y) / vp.zoom,
  };
}
