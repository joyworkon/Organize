import type { CanvasBoard } from "./model";

export const NEW_CANVAS = "__new__";
export const NEW_REGION = "__new_region__";
export interface CanvasAddTarget { canvasId: string; boardId: string; regionId: string }
const key = (userId: string) => `organize:canvas-add-target:${userId}`;

/** Best effort preference, never part of the save transaction. */
export function readCanvasAddTarget(userId: string): CanvasAddTarget | null {
  if (!userId) return null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(userId)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const target = value as Record<string, unknown>;
    if (![target.canvasId, target.boardId, target.regionId].every((id) => typeof id === "string" && id.length > 0)) return null;
    return target as unknown as CanvasAddTarget;
  } catch { return null; }
}

export function rememberCanvasAddTarget(userId: string, target: CanvasAddTarget): void {
  if (!userId) return;
  try { localStorage.setItem(key(userId), JSON.stringify(target)); } catch { /* Storage may be disabled/full. */ }
}

/** Validate each level only after a successful load; a missing page resets its region too. */
export function resolveCanvasAddTarget(boards: CanvasBoard[], target: Pick<CanvasAddTarget, "boardId" | "regionId"> | null) {
  const rememberedBoard = boards.find((board) => board.id === target?.boardId);
  const board = rememberedBoard ?? boards[0];
  return {
    boardId: board?.id ?? "",
    regionId: rememberedBoard?.regions.some((region) => region.id === target?.regionId) ? target!.regionId : NEW_REGION,
  };
}
