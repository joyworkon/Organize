"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { appendInkPoint, normalizeInk, type InkPoint } from "@/lib/canvas/ink";
import { screenToWorld } from "@/lib/canvas/coords";
import { createFreeInk } from "@/lib/canvas/commands";
import { CANVAS_LIMITS } from "@/lib/canvas/validation";
import { INK_MAX_SIZE } from "@/lib/canvas/model";
import { toast } from "@/hooks/use-toast";
import type { CanvasStore } from "./canvas-store";

/** Drawing is ephemeral until pointerup. Cancellation never writes or consumes undo. */
export function useCanvasInk(store: CanvasStore, enabled: boolean) {
  const draft = useRef<{ pointerId: number; el: HTMLDivElement; points: InkPoint[]; minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const [points, setPoints] = useState<InkPoint[]>([]);
  const clear = useCallback(() => {
    const current = draft.current;
    draft.current = null;
    setPoints([]);
    if (current?.el.hasPointerCapture(current.pointerId)) current.el.releasePointerCapture(current.pointerId);
  }, []);
  useEffect(() => {
    if (!enabled) clear();
  }, [enabled, clear]);
  useEffect(() => {
    const unsubscribe = store.subscribe((s) => { if (s.tool !== "pen" || s.previewMode || s.readOnly) clear(); });
    window.addEventListener("blur", clear);
    return () => { unsubscribe(); window.removeEventListener("blur", clear); clear(); };
  }, [store, clear]);

  const add = (e: PointerEvent<HTMLDivElement>) => {
    const current = draft.current;
    if (!current || current.pointerId !== e.pointerId) return false;
    const rect = current.el.getBoundingClientRect();
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of [...samples, e]) {
      const point = screenToWorld(sample.clientX, sample.clientY, rect, store.getState().viewport);
      const minX = Math.min(current.minX, point.x), minY = Math.min(current.minY, point.y);
      const maxX = Math.max(current.maxX, point.x), maxY = Math.max(current.maxY, point.y);
      if (maxX - minX > INK_MAX_SIZE || maxY - minY > INK_MAX_SIZE || Math.abs(point.x) > 1e6 || Math.abs(point.y) > 1e6) {
        clear();
        toast({ title: "这笔范围过大", description: "请分成几笔绘制（单笔宽高最多 2000 画布单位）。" });
        return true;
      }
      Object.assign(current, { minX, minY, maxX, maxY });
      current.points = appendInkPoint(current.points, point, 0.75 / store.getState().viewport.zoom);
    }
    setPoints(current.points);
    return true;
  };
  return {
    points, cancel: clear,
    down(e: PointerEvent<HTMLDivElement>) {
      if (!enabled || e.button !== 0) return false;
      e.preventDefault(); e.stopPropagation();
      if (draft.current) return true;
      if (store.getState().doc.freeItems.length >= CANVAS_LIMITS.maxFreeItems) {
        toast({ title: "自由元素已达上限", description: "请删除一些元素后再绘制。" });
        return true;
      }
      const point = screenToWorld(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), store.getState().viewport);
      store.getState().stopEdit(); store.getState().select(null);
      e.currentTarget.focus({ preventScroll: true });
      e.currentTarget.setPointerCapture(e.pointerId);
      draft.current = { el: e.currentTarget, pointerId: e.pointerId, points: [point], minX: point.x, maxX: point.x, minY: point.y, maxY: point.y };
      setPoints([point]);
      return true;
    },
    move(e: PointerEvent<HTMLDivElement>) {
      if (!add(e)) return false;
      e.preventDefault(); e.stopPropagation();
      return true;
    },
    finish(e: PointerEvent<HTMLDivElement>, cancel = false) {
      if (draft.current?.pointerId !== e.pointerId) return false;
      e.preventDefault(); e.stopPropagation();
      if (!cancel) add(e);
      const current = draft.current;
      const stroke = current && !cancel ? normalizeInk(current.points, 3 / store.getState().viewport.zoom) : null;
      clear();
      if (stroke && enabled && store.getState().tool === "pen") store.getState().apply("绘制笔迹", (doc) => createFreeInk(doc, stroke));
      return true;
    },
  };
}
