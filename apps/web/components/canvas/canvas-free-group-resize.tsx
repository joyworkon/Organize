"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { scaleFreeGroup, type FreeResizeHandle } from "@/lib/canvas/free-resize";
import type { FreeGroupMember } from "@/lib/canvas/free-selection";
import type { SnapGuide, SnapRect } from "@/lib/canvas/snap";
import { updateFreeItem } from "@/lib/canvas/commands";
import type { CanvasStore } from "./canvas-store";
import { setFreeItemDragging } from "./canvas-free-item";
import { CanvasFreeResizeHandles } from "./canvas-free-resize-handles";

export function CanvasFreeGroupResize({ store, members, zoom, targets, onLive, onGuides }: {
  store: CanvasStore;
  members: FreeGroupMember[];
  zoom: number;
  targets: SnapRect[];
  onLive: (members: FreeGroupMember[] | null) => void;
  onGuides: (guides: SnapGuide[] | null) => void;
}) {
  const drag = useRef<{
    el: HTMLElement; pointerId: number; startX: number; startY: number;
    members: FreeGroupMember[]; handle: FreeResizeHandle; last: FreeGroupMember[] | null;
  } | null>(null);
  const [label, setLabel] = useState<{ handle: FreeResizeHandle; size: string } | null>(null);
  const esc = useRef<((e: KeyboardEvent) => void) | null>(null);
  const finish = useCallback((commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (esc.current) window.removeEventListener("keydown", esc.current, true);
    esc.current = null;
    setFreeItemDragging(false);
    if (current.el.hasPointerCapture(current.pointerId)) current.el.releasePointerCapture(current.pointerId);
    onLive(null);
    onGuides(null);
    setLabel(null);
    if (!commit || !current.last || store.getState().readOnly) return;
    const patches = current.last.filter((m, i) => m.x !== current.members[i].x || m.y !== current.members[i].y || m.width !== current.members[i].width);
    if (!patches.length) return;
    store.getState().apply("缩放整组自由容器", (doc) => {
      let next = doc;
      for (const member of patches) next = updateFreeItem(next, { itemId: member.id, x: member.x, y: member.y, width: member.width }).doc;
      return { doc: next };
    });
  }, [onGuides, onLive, store]);
  useEffect(() => () => finish(false), [finish]);

  const move = (e: PointerEvent) => {
    const current = drag.current;
    if (!current || e.pointerId !== current.pointerId) return;
    e.stopPropagation();
    const dx = (e.clientX - current.startX) / zoom;
    const dy = (e.clientY - current.startY) / zoom;
    if (!current.last && Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return;
    const result = scaleFreeGroup(current.members, current.handle, dx, dy, {
      center: e.shiftKey, snapEnabled: !e.altKey, targets, threshold: 6 / zoom,
    });
    current.last = result.members;
    onLive(result.members);
    onGuides(result.frame?.guides.length ? result.frame.guides : null);
    if (result.frame) setLabel({ handle: current.handle, size: `${Math.round(result.frame.width)} px` });
  };
  return <CanvasFreeResizeHandles
    zoom={zoom}
    group
    active={label?.handle}
    size={label?.size}
    onBegin={(e, handle) => {
      if (e.button !== 0 || drag.current || store.getState().readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      drag.current = { el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, members, handle, last: null };
      setFreeItemDragging(true);
      esc.current = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      };
      window.addEventListener("keydown", esc.current, true);
    }}
    onMove={move}
    onEnd={(e) => {
      if (drag.current?.pointerId !== e.pointerId) return;
      e.stopPropagation();
      finish(true);
    }}
    onCancel={() => finish(false)}
    onKeyDown={(e, handle) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      if (store.getState().readOnly) return;
      const result = scaleFreeGroup(members, handle, e.key === "ArrowLeft" ? -10 : 10, 0, { center: e.shiftKey, snapEnabled: false });
      store.getState().apply("缩放整组自由容器", (doc) => {
        let next = doc;
        for (const m of result.members) next = updateFreeItem(next, { itemId: m.id, x: m.x, y: m.y, width: m.width }).doc;
        return { doc: next };
      });
    }}
  />;
}
