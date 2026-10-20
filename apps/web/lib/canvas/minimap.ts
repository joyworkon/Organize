/**
 * 小地图几何：世界坐标 ↔ 缩略图、当前视口框、点击居中。不改缩放。
 */

import { sceneBounds, type Scene } from "./layout";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MinimapViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface MinimapLayout {
  bounds: Box;
  width: number;
  height: number;
  pad: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface MinimapShape {
  id: string;
  kind: "board" | "free";
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export const MINIMAP_WIDTH = 180;
export const MINIMAP_HEIGHT = 112;
export const MINIMAP_PAD = 8;
export const MINIMAP_STORAGE_KEY = "organize-canvas-minimap";
export const MINIMAP_NUDGE_WORLD = 48;

export function readMinimapOpen(stored: string | null, narrow: boolean): boolean {
  if (stored === "1") return true;
  if (stored === "0") return false;
  return !narrow;
}

export function contentBounds(scene: Scene): Box | null {
  return sceneBounds(scene);
}

export function minimapShapes(
  scene: Scene,
  names: Readonly<Record<string, string | undefined>>,
): MinimapShape[] {
  return [
    ...scene.boards.map((board) => ({
      id: board.boardId,
      kind: "board" as const,
      x: board.x,
      y: board.y,
      width: board.width,
      height: board.height,
      label: (names[board.boardId] ?? "").trim() || "页面",
    })),
    ...scene.freeItems.map((item) => ({
      id: item.itemId,
      kind: "free" as const,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      label: "",
    })),
  ];
}

/** 内容包围盒等比放进缩略图，四周留白。 */
export function layoutMinimap(bounds: Box, width = MINIMAP_WIDTH, height = MINIMAP_HEIGHT, pad = MINIMAP_PAD): MinimapLayout {
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const scale = Math.min(innerW / Math.max(bounds.width, 1), innerH / Math.max(bounds.height, 1));
  const drawnW = bounds.width * scale;
  const drawnH = bounds.height * scale;
  return {
    bounds,
    width,
    height,
    pad,
    scale,
    offsetX: pad + (innerW - drawnW) / 2,
    offsetY: pad + (innerH - drawnH) / 2,
  };
}

export function worldToMinimap(worldX: number, worldY: number, layout: MinimapLayout): { x: number; y: number } {
  return {
    x: layout.offsetX + (worldX - layout.bounds.x) * layout.scale,
    y: layout.offsetY + (worldY - layout.bounds.y) * layout.scale,
  };
}

export function minimapToWorld(minimapX: number, minimapY: number, layout: MinimapLayout): { x: number; y: number } {
  return {
    x: layout.bounds.x + (minimapX - layout.offsetX) / layout.scale,
    y: layout.bounds.y + (minimapY - layout.offsetY) / layout.scale,
  };
}

export function containsPoint(box: Box, x: number, y: number): boolean {
  return x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height;
}

/** 相机在世界里覆盖的矩形（视口左上角对应 pan 的反号）。 */
export function cameraWorldRect(viewport: MinimapViewport, view: { width: number; height: number }): Box {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: view.width / viewport.zoom,
    height: view.height / viewport.zoom,
  };
}

export function viewportMinimapRect(
  viewport: MinimapViewport,
  view: { width: number; height: number },
  layout: MinimapLayout,
): Box {
  const world = cameraWorldRect(viewport, view);
  const origin = worldToMinimap(world.x, world.y, layout);
  return { x: origin.x, y: origin.y, width: world.width * layout.scale, height: world.height * layout.scale };
}

/** 保持缩放，让 world 落在视口中心。 */
export function centerViewportOn(
  world: { x: number; y: number },
  viewport: MinimapViewport,
  view: { width: number; height: number },
): MinimapViewport {
  return {
    zoom: viewport.zoom,
    x: view.width / 2 - world.x * viewport.zoom,
    y: view.height / 2 - world.y * viewport.zoom,
  };
}

/**
 * 拖视口框：grab 是按下时「指针世界坐标 − 相机中心」。
 * 不传 grab 时，指针下的世界坐标直接成为新的中心（点击跳转）。
 */
export function viewportFromMinimapPoint(
  local: { x: number; y: number },
  layout: MinimapLayout,
  viewport: MinimapViewport,
  view: { width: number; height: number },
  grab: { x: number; y: number } | null = null,
): MinimapViewport {
  const world = minimapToWorld(local.x, local.y, layout);
  return centerViewportOn(grab ? { x: world.x - grab.x, y: world.y - grab.y } : world, viewport, view);
}

export function truncateMinimapLabel(label: string, widthPx: number): string {
  const max = Math.max(0, Math.floor((widthPx - 4) / 7));
  if (label.length <= max) return label;
  if (max <= 1) return "";
  return `${label.slice(0, max - 1)}…`;
}

export function nudgeViewport(
  viewport: MinimapViewport,
  dir: "left" | "right" | "up" | "down",
  step = MINIMAP_NUDGE_WORLD,
): MinimapViewport {
  const dx = dir === "left" ? -step : dir === "right" ? step : 0;
  const dy = dir === "up" ? -step : dir === "down" ? step : 0;
  return {
    zoom: viewport.zoom,
    x: viewport.x - dx * viewport.zoom,
    y: viewport.y - dy * viewport.zoom,
  };
}
