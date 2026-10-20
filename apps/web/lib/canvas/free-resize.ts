/** Resize geometry in world coordinates. Height stays derived; only x/y/width are persisted. */
import { groupBounds, type FreeGroupMember } from "./free-selection";
import { MIN_FREE_ITEM_WIDTH, snapFreeItem, type SnapGuide, type SnapRect } from "./snap";

export const FREE_RESIZE_HANDLES = ["w", "e", "nw", "ne", "sw", "se"] as const;
export type FreeResizeHandle = typeof FREE_RESIZE_HANDLES[number];
export interface FreeResizeOptions {
  center?: boolean;
  targets?: SnapRect[];
  threshold?: number;
  snapEnabled?: boolean;
  minWidth?: number;
  heightForWidth?: (width: number) => number;
}
export type FreeResizeGeometry = SnapRect & { guides: SnapGuide[] };

export function resizeFreeItem(
  origin: SnapRect, handle: FreeResizeHandle, dx: number, dy: number, opts: FreeResizeOptions = {},
): FreeResizeGeometry {
  const left = handle.includes("w");
  const corner = handle.length === 2;
  const sx = left ? -1 : 1;
  const sy = handle.includes("n") ? -1 : 1;
  // Projection onto the initial diagonal makes both pointer axes useful at corners.
  const dw = corner
    ? origin.width * (sx * dx * origin.width + sy * dy * origin.height) / (origin.width ** 2 + origin.height ** 2)
    : sx * dx;
  const minWidth = opts.minWidth ?? MIN_FREE_ITEM_WIDTH;
  const width = Math.max(minWidth, origin.width + dw * (opts.center ? 2 : 1));
  const x = opts.center ? origin.x + (origin.width - width) / 2 : left ? origin.x + origin.width - width : origin.x;
  const snapped = opts.snapEnabled === false ? { x, width, guides: [] } : snapFreeItem(
    { ...origin, x, width }, opts.targets ?? [], opts.threshold ?? 0, left ? "resize-left" : "resize",
    { center: opts.center, minWidth },
  );
  const height = opts.heightForWidth?.(snapped.width) ?? origin.height;
  const y = corner && opts.center ? origin.y + (origin.height - height) / 2
    : handle.includes("n") ? origin.y + origin.height - height : origin.y;
  return { x: snapped.x, y, width: snapped.width, height,
    guides: snapped.guides.map((guide) => ({ ...guide, from: Math.min(guide.from, y), to: Math.max(guide.to, y + height) })),
  };
}

/** A common minimum scale keeps every member >=80 without distorting relative positions. */
export function scaleFreeGroup(
  members: readonly FreeGroupMember[], handle: FreeResizeHandle, dx: number, dy: number, opts: FreeResizeOptions = {},
): { members: FreeGroupMember[]; frame: FreeResizeGeometry | null } {
  const bounds = groupBounds(members);
  if (!bounds || bounds.width <= 0 || members.some((m) => m.width <= 0 || ![m.x, m.y, m.width, m.height].every(Number.isFinite)) || ![dx, dy].every(Number.isFinite)) {
    return { members: [], frame: null };
  }
  const minScale = Math.max(...members.map((m) => MIN_FREE_ITEM_WIDTH / m.width));
  const frame = resizeFreeItem(bounds, handle, dx, dy, {
    ...opts, minWidth: bounds.width * minScale, heightForWidth: (width) => bounds.height * width / bounds.width,
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
