/** Resize geometry in world coordinates. Text/image height stays derived; shapes resize both axes. */
import { groupBounds, type FreeGroupMember } from "./free-selection";
import { MIN_FREE_ITEM_WIDTH, snapFreeItem, type SnapGuide, type SnapRect } from "./snap";
import { SHAPE_MIN_HEIGHT, SHAPE_MAX_HEIGHT } from "./model";
import { BLOCK_CHROME } from "./layout";

export const FREE_RESIZE_HANDLES = ["w", "e", "nw", "ne", "sw", "se"] as const;
export const SHAPE_RESIZE_HANDLES = [...FREE_RESIZE_HANDLES, "n", "s"] as const;
export type FreeResizeHandle = typeof SHAPE_RESIZE_HANDLES[number];
export interface FreeResizeOptions {
  center?: boolean;
  targets?: SnapRect[];
  threshold?: number;
  snapEnabled?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minScale?: number;
  maxScale?: number;
  heightForWidth?: (width: number) => number;
  independentHeight?: boolean;
  minHeight?: number;
  maxHeight?: number;
}
export type FreeResizeGeometry = SnapRect & { guides: SnapGuide[] };

export function resizeFreeItem(
  origin: SnapRect, handle: FreeResizeHandle, dx: number, dy: number, opts: FreeResizeOptions = {},
): FreeResizeGeometry {
  if (opts.independentHeight) return resizeShape(origin, handle, dx, dy, opts);
  const left = handle.includes("w");
  const corner = handle.length === 2;
  const sx = left ? -1 : 1;
  const sy = handle.includes("n") ? -1 : 1;
  // Projection onto the initial diagonal makes both pointer axes useful at corners.
  const dw = corner
    ? origin.width * (sx * dx * origin.width + sy * dy * origin.height) / (origin.width ** 2 + origin.height ** 2)
    : sx * dx;
  const minWidth = opts.minWidth ?? MIN_FREE_ITEM_WIDTH;
  const width = Math.min(opts.maxWidth ?? Infinity, Math.max(minWidth, origin.width + dw * (opts.center ? 2 : 1)));
  const x = opts.center ? origin.x + (origin.width - width) / 2 : left ? origin.x + origin.width - width : origin.x;
  let snapped = opts.snapEnabled === false ? { x, width, guides: [] } : snapFreeItem(
    { ...origin, x, width }, opts.targets ?? [], opts.threshold ?? 0, left ? "resize-left" : "resize",
    { center: opts.center, minWidth },
  );
  if (snapped.width > (opts.maxWidth ?? Infinity)) snapped = { x, width, guides: [] };
  const height = opts.heightForWidth?.(snapped.width) ?? origin.height;
  const y = corner && opts.center ? origin.y + (origin.height - height) / 2
    : handle.includes("n") ? origin.y + origin.height - height : origin.y;
  return { x: snapped.x, y, width: snapped.width, height,
    guides: snapped.guides.map((guide) => ({ ...guide, from: Math.min(guide.from, y), to: Math.max(guide.to, y + height) })),
  };
}

/** Reuse edge snapping on each axis (transpose Y), while keeping the opposite edge anchored. */
function resizeShape(origin: SnapRect, handle: FreeResizeHandle, dx: number, dy: number, opts: FreeResizeOptions): FreeResizeGeometry {
  const axis = (start: number, size: number, crossStart: number, crossSize: number, delta: number, leading: boolean, min: number, max: number, targets: SnapRect[]) => {
    const next = Math.min(max, Math.max(min, size + (leading ? -delta : delta) * (opts.center ? 2 : 1)));
    const x = opts.center ? start + (size - next) / 2 : leading ? start + size - next : start;
    const moving = { x, y: crossStart, width: next, height: crossSize };
    const snap = opts.snapEnabled === false ? { ...moving, guides: [] } : snapFreeItem(
      moving, targets, opts.threshold ?? 0, leading ? "resize-left" : "resize", { center: opts.center, minWidth: min },
    );
    return snap.width <= max ? snap : { ...moving, guides: [] };
  };
  const targets = opts.targets ?? [];
  const horizontal = handle.includes("w") || handle.includes("e");
  const vertical = handle.includes("n") || handle.includes("s");
  const rx = horizontal ? axis(origin.x, origin.width, origin.y, origin.height, dx, handle.includes("w"), opts.minWidth ?? MIN_FREE_ITEM_WIDTH, 2000, targets) : { x: origin.x, width: origin.width, guides: [] };
  const ry = vertical ? axis(origin.y, origin.height, rx.x, rx.width, dy, handle.includes("n"), opts.minHeight ?? SHAPE_MIN_HEIGHT + BLOCK_CHROME, opts.maxHeight ?? SHAPE_MAX_HEIGHT + BLOCK_CHROME,
    targets.map((t) => ({ x: t.y, y: t.x, width: t.height, height: t.width }))) : { x: origin.y, width: origin.height, guides: [] };
  return { x: rx.x, y: ry.x, width: rx.width, height: ry.width, guides: [
    ...rx.guides.map((g) => ({ ...g, from: Math.min(g.from, ry.x), to: Math.max(g.to, ry.x + ry.width) })),
    ...ry.guides.map((g) => ({ ...g, axis: "y" as const })),
  ] };
}

/** A common minimum scale keeps every member >=80 without distorting relative positions. */
export function scaleFreeGroup(
  members: readonly FreeGroupMember[], handle: FreeResizeHandle, dx: number, dy: number, opts: FreeResizeOptions = {},
): { members: FreeGroupMember[]; frame: FreeResizeGeometry | null } {
  const bounds = groupBounds(members);
  if (!bounds || bounds.width <= 0 || members.some((m) => m.width <= 0 || ![m.x, m.y, m.width, m.height].every(Number.isFinite)) || ![dx, dy].every(Number.isFinite)) {
    return { members: [], frame: null };
  }
  const minScale = Math.max(opts.minScale ?? 0, ...members.map((m) => MIN_FREE_ITEM_WIDTH / m.width));
  const frame = resizeFreeItem(bounds, handle, dx, dy, {
    ...opts, minWidth: bounds.width * minScale, maxWidth: bounds.width * (opts.maxScale ?? Infinity), heightForWidth: (width) => bounds.height * width / bounds.width,
  });
  // Side handles anchor at the midpoint of the opposite edge.
  if (handle.length === 1) frame.y = bounds.y + (bounds.height - frame.height) / 2;
  const s = frame.width / bounds.width;
  return {
    frame,
    members: members.map((m) => ({
      ...m, x: frame.x + (m.x - bounds.x) * s, y: frame.y + (m.y - bounds.y) * s,
      width: Math.max(MIN_FREE_ITEM_WIDTH, m.width * s), height: m.height * s,
    })),
  };
}
