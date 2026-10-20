/**
 * 自由元素对齐与分布。只算新的 x/y，不写文档。
 * 高度由调用方传入（场景里已测的 height），与 groupBounds / 框选同一套盒子。
 */

import { groupBounds } from "./free-selection";

export interface FreeArrangeMember {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FreePositionPatch {
  itemId: string;
  x?: number;
  y?: number;
}

export type FreeAlignMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";

export type FreeDistributeAxis = "x" | "y";

const POSITION_EPSILON = 1e-6;

function finiteMember(member: FreeArrangeMember): boolean {
  return [member.x, member.y, member.width, member.height].every((value) => Number.isFinite(value));
}

function changed(next: number, current: number): boolean {
  return Math.abs(next - current) > POSITION_EPSILON;
}

/** 按选区外接矩形对齐。不足 2 个、或几何非法时返回空。只返回真正改动的轴。 */
export function alignFreeItems(
  members: readonly FreeArrangeMember[],
  mode: FreeAlignMode,
): FreePositionPatch[] {
  if (members.length < 2 || members.some((member) => !finiteMember(member))) return [];
  const bounds = groupBounds(members);
  if (!bounds) return [];
  const horizontal = mode === "left" || mode === "center-x" || mode === "right";
  const patches: FreePositionPatch[] = [];
  for (const member of members) {
    if (horizontal) {
      const x = mode === "left"
        ? bounds.x
        : mode === "right"
          ? bounds.x + bounds.width - member.width
          : bounds.x + (bounds.width - member.width) / 2;
      if (changed(x, member.x)) patches.push({ itemId: member.id, x });
    } else {
      const y = mode === "top"
        ? bounds.y
        : mode === "bottom"
          ? bounds.y + bounds.height - member.height
          : bounds.y + (bounds.height - member.height) / 2;
      if (changed(y, member.y)) patches.push({ itemId: member.id, y });
    }
  }
  return patches;
}

/**
 * 相邻间隙相等，外接矩形两端不动。
 * 排序先比中心，再比起始边，最后比 id。不足 3 个时返回空。
 * 总宽超过外接矩形时间隙为负（均匀重叠），两端仍不动。
 */
export function distributeFreeItems(
  members: readonly FreeArrangeMember[],
  axis: FreeDistributeAxis,
): FreePositionPatch[] {
  if (members.length < 3 || members.some((member) => !finiteMember(member))) return [];
  const bounds = groupBounds(members);
  if (!bounds) return [];
  const startKey = axis === "x" ? "x" : "y";
  const sizeKey = axis === "x" ? "width" : "height";
  const minEdge = axis === "x" ? bounds.x : bounds.y;
  const maxEdge = axis === "x" ? bounds.x + bounds.width : bounds.y + bounds.height;
  const sorted = [...members].sort((a, b) => {
    const centerDelta = (a[startKey] + a[sizeKey] / 2) - (b[startKey] + b[sizeKey] / 2);
    if (centerDelta !== 0) return centerDelta;
    const edgeDelta = a[startKey] - b[startKey];
    if (edgeDelta !== 0) return edgeDelta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const totalSize = sorted.reduce((sum, member) => sum + member[sizeKey], 0);
  const gap = (maxEdge - minEdge - totalSize) / (sorted.length - 1);
  if (!Number.isFinite(gap)) return [];
  let cursor = minEdge;
  const patches: FreePositionPatch[] = [];
  for (const member of sorted) {
    if (changed(cursor, member[startKey])) {
      patches.push(axis === "x" ? { itemId: member.id, x: cursor } : { itemId: member.id, y: cursor });
    }
    cursor += member[sizeKey] + gap;
  }
  return patches;
}
