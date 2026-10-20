import { describe, expect, it } from "vitest";
import type { Scene } from "./layout";
import {
  cameraWorldRect,
  centerViewportOn,
  contentBounds,
  layoutMinimap,
  minimapShapes,
  minimapToWorld,
  nudgeViewport,
  readMinimapOpen,
  truncateMinimapLabel,
  viewportFromMinimapPoint,
  viewportMinimapRect,
  worldToMinimap,
} from "./minimap";

const bounds = { x: -50, y: 20, width: 1000, height: 400 };

describe("minimap geometry", () => {
  it("round-trips world coordinates and fits the bounds inside the pad", () => {
    const layout = layoutMinimap(bounds, 180, 112, 8);
    expect(layout.scale).toBeGreaterThan(0);
    const projected = worldToMinimap(bounds.x, bounds.y, layout);
    expect(projected.x).toBeGreaterThanOrEqual(8);
    expect(projected.y).toBeGreaterThanOrEqual(8);
    const back = minimapToWorld(projected.x, projected.y, layout);
    expect(back.x).toBeCloseTo(bounds.x);
    expect(back.y).toBeCloseTo(bounds.y);
    const far = worldToMinimap(bounds.x + bounds.width, bounds.y + bounds.height, layout);
    expect(far.x).toBeLessThanOrEqual(172);
    expect(far.y).toBeLessThanOrEqual(104);
    expect(minimapToWorld(far.x, far.y, layout).x).toBeCloseTo(bounds.x + bounds.width);
  });

  it("draws the camera rect from the visible world rectangle", () => {
    const layout = layoutMinimap(bounds);
    const viewport = { x: 80, y: -40, zoom: 2 };
    const view = { width: 400, height: 300 };
    const world = cameraWorldRect(viewport, view);
    expect(world).toEqual({ x: -40, y: 20, width: 200, height: 150 });
    const frame = viewportMinimapRect(viewport, view, layout);
    const origin = worldToMinimap(world.x, world.y, layout);
    expect(frame.x).toBeCloseTo(origin.x);
    expect(frame.y).toBeCloseTo(origin.y);
    expect(frame.width).toBeCloseTo(world.width * layout.scale);
    expect(frame.height).toBeCloseTo(world.height * layout.scale);
  });

  it("centers a click without changing zoom, and a frame drag keeps the grab offset", () => {
    const layout = layoutMinimap(bounds, 180, 112, 8);
    const viewport = { x: 10, y: 30, zoom: 1.5 };
    const view = { width: 800, height: 600 };
    const local = { x: 40, y: 70 };
    const world = minimapToWorld(local.x, local.y, layout);
    const centered = centerViewportOn(world, viewport, view);
    expect(centered.zoom).toBe(1.5);
    const seen = cameraWorldRect(centered, view);
    expect(seen.x + seen.width / 2).toBeCloseTo(world.x);
    expect(seen.y + seen.height / 2).toBeCloseTo(world.y);

    const grab = { x: 25, y: -10 };
    const dragged = viewportFromMinimapPoint({ x: 90, y: 40 }, layout, viewport, view, grab);
    const draggedWorld = minimapToWorld(90, 40, layout);
    const draggedSeen = cameraWorldRect(dragged, view);
    expect(dragged.zoom).toBe(viewport.zoom);
    expect(draggedSeen.x + draggedSeen.width / 2).toBeCloseTo(draggedWorld.x - grab.x);
    expect(draggedSeen.y + draggedSeen.height / 2).toBeCloseTo(draggedWorld.y - grab.y);
  });

  it("reads the persisted switch, names boards, and hides an empty scene", () => {
    expect(readMinimapOpen(null, false)).toBe(true);
    expect(readMinimapOpen(null, true)).toBe(false);
    expect(readMinimapOpen("0", false)).toBe(false);
    expect(readMinimapOpen("1", true)).toBe(true);
    expect(readMinimapOpen("maybe", true)).toBe(false);

    const scene: Scene = {
      boards: [{ boardId: "b1", x: 0, y: 0, width: 200, height: 80, regions: [] }],
      freeItems: [{ itemId: "f1", x: 300, y: 10, width: 40, height: 20, zIndex: 1 }],
    };
    expect(contentBounds(scene)).toMatchObject({ x: 0, y: 0 });
    expect(minimapShapes(scene, { b1: " 草案 " })).toEqual([
      { id: "b1", kind: "board", x: 0, y: 0, width: 200, height: 80, label: "草案" },
      { id: "f1", kind: "free", x: 300, y: 10, width: 40, height: 20, label: "" },
    ]);
    expect(minimapShapes({ boards: [], freeItems: [] }, {})).toEqual([]);
    expect(contentBounds({ boards: [], freeItems: [] })).toBeNull();
    expect(truncateMinimapLabel("未命名的长页面标题", 32)).toBe("未命名…");
    expect(nudgeViewport({ x: 0, y: 0, zoom: 2 }, "right", 10)).toEqual({ x: -20, y: 0, zoom: 2 });
  });
});
