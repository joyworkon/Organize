"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Scene, SceneBlockBox } from "@/lib/canvas/layout";
import { findBlockLocation } from "@/lib/canvas/model";
import { CANVAS_LIMITS } from "@/lib/canvas/validation";
import { toast } from "@/hooks/use-toast";
import { relocateBlocks } from "@/lib/canvas/commands";
import { screenToWorld } from "@/lib/canvas/coords";
import type { CanvasStore } from "./canvas-store";

const boxesIn = (scene: Scene) => scene.boards.flatMap((b) => b.regions)
  .flatMap((r) => r.sections).flatMap((s) => s.columns).flatMap((c) => c.blocks);
const selectedIds = (store: CanvasStore) => {
  const sel = store.getState().selection;
  return sel?.kind === "block" ? [sel.blockId] : sel?.kind === "blocks" ? sel.blockIds : [];
};
function selectIds(store: CanvasStore, ids: string[]) {
  store.getState().select(ids.length === 1 ? { kind: "block", blockId: ids[0] }
    : ids.length ? { kind: "blocks", blockIds: ids } : null);
}

/** Marquee and structural module drag share viewport capture; text editing keeps native selection. */
export function useCanvasPointer(store: CanvasStore, scene: Scene, interactive: boolean, spaceHeld: boolean) {
  const gesture = useRef<null | {
    kind: "marquee" | "move"; x: number; y: number; clientX: number; clientY: number;
    ids: string[]; boxes: SceneBlockBox[]; moved: boolean;
  }>(null);
  const [visual, setVisual] = useState<null | {
    marquee?: { x: number; y: number; width: number; height: number };
    ghosts?: SceneBlockBox[];
    drop?: { columnId: string; beforeBlockId?: string; x: number; y: number; width: number };
    hint?: string;
    canFree?: boolean;
  }>(null);
  const suppressClick = useRef(false);
  const world = (e: ReactPointerEvent<HTMLDivElement>) => screenToWorld(e.clientX, e.clientY,
    e.currentTarget.getBoundingClientRect(), store.getState().viewport);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || spaceHeld || e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest("button, input, textarea, a, [contenteditable=true], .canvas-divider, .canvas-board-handle, .canvas-board-resize, .canvas-free-item")) return;
    const id = el.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
    const empty = el.classList.contains("canvas-viewport") || !!el.closest(".canvas-world");
    if (!id && !empty) return;
    e.preventDefault();
    e.stopPropagation();
    store.getState().stopEdit();
    suppressClick.current = false;
    const previous = selectedIds(store);
    const ids = id ? e.shiftKey ? previous.includes(id) ? previous.filter((i) => i !== id) : [...previous, id]
      : previous.includes(id) ? previous : [id] : e.shiftKey ? previous : [];
    if (!id && !e.shiftKey) {
      const region = el.closest<HTMLElement>("[data-region-id]");
      const board = el.closest<HTMLElement>("[data-board-id]");
      store.getState().select(region && board ? { kind: "region", boardId: board.dataset.boardId!, regionId: region.dataset.regionId! }
        : board ? { kind: "board", boardId: board.dataset.boardId! } : null);
    } else selectIds(store, ids);
    const at = world(e);
    gesture.current = { kind: id ? "move" : "marquee", ...at, clientX: e.clientX, clientY: e.clientY,
      ids, boxes: boxesIn(scene).filter((b) => ids.includes(b.blockId)), moved: false };
    if (id) el.closest<HTMLElement>("[data-block-id]")?.focus({ preventScroll: true });
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) < 4) return;
    g.moved = true;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
    const at = world(e);
    if (g.kind === "marquee") {
      const rect = { x: Math.min(g.x, at.x), y: Math.min(g.y, at.y), width: Math.abs(at.x - g.x), height: Math.abs(at.y - g.y) };
      const ids = boxesIn(scene).filter((b) => b.x < rect.x + rect.width && b.x + b.width > rect.x
        && b.y < rect.y + rect.height && b.y + b.height > rect.y).map((b) => b.blockId);
      selectIds(store, [...new Set([...g.ids, ...ids])]);
      setVisual({ marquee: rect });
    } else {
      let drop: NonNullable<typeof visual>["drop"];
      // Only columns are drop targets; padding and gaps never silently append elsewhere.
      for (const b of [...scene.boards].reverse()) {
        for (const r of b.regions) for (const s of r.sections) for (const c of s.columns) {
          if (at.x < c.x || at.x > c.x + c.width || at.y < s.y || at.y > s.y + s.height) continue;
          const remaining = c.blocks.filter((box) => !g.ids.includes(box.blockId));
          const before = remaining.find((box) => at.y < box.y + box.height / 2);
          const last = remaining[remaining.length - 1];
          drop = { columnId: c.columnId, beforeBlockId: before?.blockId, x: c.x,
            y: before?.y ?? (last ? last.y + last.height : c.y), width: c.width };
        }
        if (drop) break;
      }
      const insideBoard = scene.boards.some((b) => at.x >= b.x && at.x <= b.x + b.width && at.y >= b.y && at.y <= b.y + b.height);
      const canFree = !insideBoard && store.getState().doc.freeItems.length + g.ids.length <= CANVAS_LIMITS.maxFreeItems && g.ids.every((id) => {
        const type = findBlockLocation(store.getState().doc, id)?.block.type;
        return type === "text" || type === "image";
      });
      setVisual({ canFree, ghosts: g.boxes.map((b) => ({ ...b, x: b.x + at.x - g.x, y: b.y + at.y - g.y })), drop,
        hint: drop ? "松开以移动到标记位置" : canFree ? "松开以移到画布，成为自由内容框" : "请拖到目标列；文字和图片可移到页面外自由放置" });
    }
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancel = false) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    suppressClick.current = g.moved;
    if (!cancel && g.kind === "move" && g.moved && visual) {
      if (!visual.drop && !visual.canFree) {
        toast({ title: "未移动模块", description: "请拖到目标列，或将文字、图片拖到页面外的空白画布。" });
      } else store.getState().apply("拖动移动模块", (doc) => relocateBlocks(doc, {
        blockIds: g.ids, target: visual.drop,
        freePositions: visual.ghosts?.map((b) => ({ blockId: b.blockId, x: b.x, y: b.y, width: b.width })),
      }));
      if (!visual.drop && store.getState().doc.freeItems.some((i) => g.ids.includes(i.block.id))) store.getState().select(null);
      store.getState().requestSmartRecompute();
    }
    setVisual(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return { down, move, finish, visual, clickCapture: (e: React.MouseEvent) => {
    if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; }
  } };
}
