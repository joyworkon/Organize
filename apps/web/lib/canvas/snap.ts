/**
 * 自由元素对齐吸附（构思画布）：拖动/调整宽度时靠近其他自由元素或
 * 页面（board）的边缘/中线自动吸附，并给出参考线。纯函数，世界坐标。
 */

import type { Scene } from "./layout";

export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一条参考线：axis "x" 为竖线（pos 为 x 坐标），"y" 为横线；from/to 为线段跨度。 */
export interface SnapGuide {
  axis: "x" | "y";
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  width: number;
  guides: SnapGuide[];
}

/** 自由元素最小宽度（与 canvas-free-item 的拖动手柄一致）。 */
export const MIN_FREE_ITEM_WIDTH = 80;

/** 一维上的三个吸附点：起点 / 中点 / 终点。 */
function points(start: number, size: number): [number, number, number] {
  return [start, start + size / 2, start + size];
}

interface AxisSnap {
  delta: number;
  /** 命中的目标参考线（吸附修正后生成）。 */
  target: SnapRect;
  /** 目标上的吸附点坐标。 */
  pos: number;
}

/** 在单轴上找 |delta| 最小且 ≤ threshold 的吸附；没有则 null。 */
function bestAxisSnap(
  movingPoints: [number, number, number],
  targets: SnapRect[],
  targetPoints: (t: SnapRect) => [number, number, number],
  threshold: number,
): AxisSnap | null {
  let best: (AxisSnap & { distance: number }) | null = null;
  for (const target of targets) {
    const tp = targetPoints(target);
    for (const mp of movingPoints) {
      for (const p of tp) {
        const delta = p - mp;
        const distance = Math.abs(delta);
        if (distance <= threshold && (best === null || distance < best.distance)) {
          best = { delta, target, pos: p, distance };
        }
      }
    }
  }
  return best;
}

function spanGuide(axis: "x" | "y", pos: number, moving: SnapRect, target: SnapRect): SnapGuide {
  if (axis === "x") {
    return {
      axis,
      pos,
      from: Math.min(moving.y, target.y),
      to: Math.max(moving.y + moving.height, target.y + target.height),
    };
  }
  return {
    axis,
    pos,
    from: Math.min(moving.x, target.x),
    to: Math.max(moving.x + moving.width, target.x + target.width),
  };
}

/**
 * 计算吸附修正。
 *
 * - move：X 轴比较自身 左/中/右 × 目标 左/中/右，Y 轴比较 上/中/下 × 目标 上/中/下，
 *   每轴取距离最小且 ≤ threshold 的一项修正 x/y。
 * - resize / resize-left：只在 X 轴比较活动边缘与目标 左/中/右；
 *   center 时两侧对称调整，默认锚定对侧边。
 *   修正后宽度仍 ≥ MIN_FREE_ITEM_WIDTH（低于下限视为未吸附）。
 * - targets 由调用方预先排除自身；threshold 为世界坐标（屏幕阈值 / zoom）。
 */
export function snapFreeItem(
  moving: SnapRect,
  targets: SnapRect[],
  threshold: number,
  mode: "move" | "resize" | "resize-left",
  opts: { center?: boolean; minWidth?: number } = {},
): SnapResult {
  const guides: SnapGuide[] = [];

  if (mode === "resize" || mode === "resize-left") {
    const left = mode === "resize-left";
    const edge = left ? moving.x : moving.x + moving.width;
    const snapX = bestAxisSnap([edge, edge, edge], targets, (t) => points(t.x, t.width), threshold);
    if (!snapX) return { x: moving.x, y: moving.y, width: moving.width, guides };
    const width = moving.width + (left ? -1 : 1) * snapX.delta * (opts.center ? 2 : 1);
    // Clamp at the minimum without displaying a guide we did not reach.
    if (width < (opts.minWidth ?? MIN_FREE_ITEM_WIDTH)) {
      const clamped = opts.minWidth ?? MIN_FREE_ITEM_WIDTH;
      const x = opts.center ? moving.x + (moving.width - clamped) / 2 : left ? moving.x + moving.width - clamped : moving.x;
      return { x, y: moving.y, width: clamped, guides };
    }
    const x = opts.center ? moving.x + (moving.width - width) / 2 : left ? moving.x + snapX.delta : moving.x;
    const corrected = { ...moving, x, width };
    guides.push(spanGuide("x", snapX.pos, corrected, snapX.target));
    return { x, y: moving.y, width, guides };
  }

  const snapX = bestAxisSnap(
    points(moving.x, moving.width),
    targets,
    (t) => points(t.x, t.width),
    threshold,
  );
  const snapY = bestAxisSnap(
    points(moving.y, moving.height),
    targets,
    (t) => points(t.y, t.height),
    threshold,
  );
  const corrected: SnapRect = {
    x: moving.x + (snapX?.delta ?? 0),
    y: moving.y + (snapY?.delta ?? 0),
    width: moving.width,
    height: moving.height,
  };
  if (snapX) guides.push(spanGuide("x", snapX.pos, corrected, snapX.target));
  if (snapY) guides.push(spanGuide("y", snapY.pos, corrected, snapY.target));
  return { x: corrected.x, y: corrected.y, width: corrected.width, guides };
}

/** 吸附候选目标：其他自由元素 + 全部页面（排除自身，成组时排除组内全部）。 */
export function snapTargetsForItem(scene: Scene, excludeItemId: string | readonly string[]): SnapRect[] {
  const exclude = new Set(typeof excludeItemId === "string" ? [excludeItemId] : excludeItemId);
  const targets: SnapRect[] = [];
  for (const item of scene.freeItems) {
    if (exclude.has(item.itemId)) continue;
    targets.push({ x: item.x, y: item.y, width: item.width, height: item.height });
  }
  for (const board of scene.boards) {
    targets.push({ x: board.x, y: board.y, width: board.width, height: board.height });
  }
  return targets;
}
