/**
 * 自由元素多选的纯计算：框选命中、Shift 点击、整组外接矩形吸附。
 * 不写文档、不碰 store。单个仍是 free，两个及以上才是 frees。
 */

import { snapFreeItem, type SnapGuide, type SnapRect } from "./snap";

export interface FreeGroupMember {
  minWidth?: number;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FreeIdSelection =
  | { kind: "free"; itemId: string }
  | { kind: "frees"; itemIds: string[] }
  | null;

export function selectionFromFreeIds(ids: readonly string[]): FreeIdSelection {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length === 0) return null;
  if (unique.length === 1) return { kind: "free", itemId: unique[0] };
  return { kind: "frees", itemIds: unique };
}

export function freeIdsFromSelection(selection: {
  kind: string;
  itemId?: string;
  itemIds?: readonly string[];
} | null): string[] {
  if (!selection) return [];
  if (selection.kind === "free" && selection.itemId) return [selection.itemId];
  if (selection.kind === "frees" && selection.itemIds) return [...selection.itemIds];
  return [];
}

/** Shift 加入/移出；单击已选中的成员时保持整组，便于直接拖动。 */
export function nextFreeIdsOnClick(currentIds: readonly string[], itemId: string, shift: boolean): string[] {
  if (shift) {
    return currentIds.includes(itemId) ? currentIds.filter((id) => id !== itemId) : [...currentIds, itemId];
  }
  if (currentIds.includes(itemId)) return [...currentIds];
  return [itemId];
}

export function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * 框选结果。base* 已按 Shift 收好：非 Shift 为空，Shift 只带当前同类型选区。
 * 碰到任意页面模块时维持 blocks 逻辑；只碰到自由元素时收集自由元素。
 * 什么都没碰到时保留按下时的选区，避免 Shift 框选在空白处把模块选区清掉。
 */
export function resolveMarqueePick(args: {
  baseBlockIds: readonly string[];
  baseFreeIds: readonly string[];
  hitBlockIds: readonly string[];
  hitFreeIds: readonly string[];
}): { kind: "blocks"; ids: string[] } | { kind: "free-items"; ids: string[] } {
  if (args.hitBlockIds.length > 0) {
    return { kind: "blocks", ids: uniqueIds([...args.baseBlockIds, ...args.hitBlockIds]) };
  }
  if (args.hitFreeIds.length > 0) {
    return { kind: "free-items", ids: uniqueIds([...args.baseFreeIds, ...args.hitFreeIds]) };
  }
  if (args.baseBlockIds.length > 0) {
    return { kind: "blocks", ids: uniqueIds(args.baseBlockIds) };
  }
  return { kind: "free-items", ids: uniqueIds(args.baseFreeIds) };
}

export function groupBounds(rects: readonly SnapRect[]): SnapRect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** 整组平移的吸附修正：用外接矩形喂给 snapFreeItem，返回应加到每个成员上的位移。 */
export function snapGroupMove(
  members: readonly SnapRect[],
  dx: number,
  dy: number,
  targets: readonly SnapRect[],
  threshold: number,
  snapEnabled: boolean,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const bounds = groupBounds(members);
  if (!bounds || !snapEnabled) return { dx, dy, guides: [] };
  const moving = { x: bounds.x + dx, y: bounds.y + dy, width: bounds.width, height: bounds.height };
  const snapped = snapFreeItem(moving, [...targets], threshold, "move");
  return {
    dx: snapped.x - bounds.x,
    dy: snapped.y - bounds.y,
    guides: snapped.guides,
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}
