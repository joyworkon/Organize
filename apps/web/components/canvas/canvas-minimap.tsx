"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Scene } from "@/lib/canvas/layout";
import {
  MINIMAP_HEIGHT,
  MINIMAP_NUDGE_WORLD,
  MINIMAP_STORAGE_KEY,
  MINIMAP_WIDTH,
  centerViewportOn,
  containsPoint,
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
  type MinimapViewport,
} from "@/lib/canvas/minimap";

const DRAG_SLOP = 3;

export function useMinimapOpen(narrow: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(readMinimapOpen(window.localStorage.getItem(MINIMAP_STORAGE_KEY), narrow));
  }, [narrow]);
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      window.localStorage.setItem(MINIMAP_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);
  return [open, toggle];
}

export function CanvasMinimapToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant={open ? "secondary" : "ghost"}
      size="icon"
      className="shrink-0 text-muted-foreground"
      title="小地图"
      aria-label={open ? "隐藏小地图" : "显示小地图"}
      aria-pressed={open}
      onClick={onToggle}
    >
      <MapIcon className="h-4 w-4" />
    </Button>
  );
}

function useElementSize(ref: RefObject<HTMLElement | null> | undefined, active: boolean) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref?.current;
    if (!el || !active) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, ref]);
  return size;
}

export function CanvasMinimap({
  open,
  scene,
  names,
  viewport,
  viewSize,
  shellRef,
  onViewport,
}: {
  open: boolean;
  scene: Scene;
  names: Readonly<Record<string, string | undefined>>;
  viewport: MinimapViewport;
  viewSize?: { width: number; height: number };
  shellRef?: RefObject<HTMLElement | null>;
  onViewport: (viewport: MinimapViewport) => void;
}) {
  const measured = useElementSize(shellRef, open && !viewSize);
  const size = viewSize ?? measured;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cameraRef = useRef<SVGRectElement | null>(null);
  const dragRef = useRef<null | {
    kind: "camera" | "jump";
    moved: boolean;
    grabX: number;
    grabY: number;
    pointerId: number;
    startX: number;
    startY: number;
  }>(null);

  const bounds = open ? contentBounds(scene) : null;
  const layout = bounds && bounds.width > 0 && bounds.height > 0 ? layoutMinimap(bounds) : null;
  const shapes = layout ? minimapShapes(scene, names) : [];
  const camera = layout && size.width > 0 && size.height > 0 ? viewportMinimapRect(viewport, size, layout) : null;

  const localOf = (e: ReactPointerEvent<HTMLDivElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * MINIMAP_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * MINIMAP_HEIGHT,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!layout || !camera || e.button > 0 || size.width <= 0 || size.height <= 0) return;
    const local = localOf(e);
    if (!local) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.currentTarget.setPointerCapture === "function") {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 指针已结束 */ }
    }
    const world = minimapToWorld(local.x, local.y, layout);
    const seen = {
      x: -viewport.x / viewport.zoom,
      y: -viewport.y / viewport.zoom,
      width: size.width / viewport.zoom,
      height: size.height / viewport.zoom,
    };
    const onCamera = containsPoint(camera, local.x, local.y);
    dragRef.current = {
      kind: onCamera ? "camera" : "jump",
      moved: false,
      grabX: world.x - (seen.x + seen.width / 2),
      grabY: world.y - (seen.y + seen.height / 2),
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
    if (onCamera) cameraRef.current?.focus();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !layout || drag.pointerId !== e.pointerId || size.width <= 0) return;
    const local = localOf(e);
    if (!local) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_SLOP) return;
    drag.moved = true;
    e.preventDefault();
    const next = drag.kind === "camera"
      ? viewportFromMinimapPoint(local, layout, viewport, size, { x: drag.grabX, y: drag.grabY })
      : centerViewportOn(minimapToWorld(local.x, local.y, layout), viewport, size);
    onViewport(next);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (typeof e.currentTarget.releasePointerCapture === "function" && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
    }
    if (!layout || drag.moved || drag.kind !== "jump" || size.width <= 0) return;
    const local = localOf(e);
    if (!local) return;
    onViewport(centerViewportOn(minimapToWorld(local.x, local.y, layout), viewport, size));
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGRectElement>) => {
    const dir = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
    if (!dir || size.width <= 0) return;
    e.preventDefault();
    onViewport(nudgeViewport(viewport, dir, e.shiftKey ? MINIMAP_NUDGE_WORLD * 4 : MINIMAP_NUDGE_WORLD));
  };

  if (!open) return null;
  if (!layout || !bounds) {
    return (
      <div className="canvas-minimap is-empty" aria-label="画布小地图">
        <p>画布是空的</p>
      </div>
    );
  }

  return (
    <div
      className="canvas-minimap"
      aria-label="画布小地图"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg
        ref={svgRef}
        className="canvas-minimap-svg"
        viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
      >
        {shapes.map((shape) => {
          const at = worldToMinimap(shape.x, shape.y, layout);
          const width = Math.max(shape.width * layout.scale, shape.kind === "free" ? 2 : 4);
          const height = Math.max(shape.height * layout.scale, shape.kind === "free" ? 2 : 3);
          const label = shape.kind === "board" ? truncateMinimapLabel(shape.label, width) : "";
          return (
            <g key={`${shape.kind}-${shape.id}`}>
              <rect
                className={shape.kind === "board" ? "canvas-minimap-board" : "canvas-minimap-free"}
                x={at.x}
                y={at.y}
                width={width}
                height={height}
                rx={shape.kind === "board" ? 3 : 1}
              />
              {label ? (
                <text className="canvas-minimap-label" x={at.x + 3} y={at.y + 10}>
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
        {camera && (
          <rect
            ref={cameraRef}
            className="canvas-minimap-camera"
            x={camera.x}
            y={camera.y}
            width={Math.max(camera.width, 4)}
            height={Math.max(camera.height, 4)}
            rx={2}
            tabIndex={0}
            role="button"
            aria-label="当前视口"
            onKeyDown={onKeyDown}
          />
        )}
      </svg>
    </div>
  );
}
