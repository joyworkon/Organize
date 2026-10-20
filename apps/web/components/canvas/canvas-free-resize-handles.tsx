"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import { FREE_RESIZE_HANDLES, type FreeResizeHandle } from "@/lib/canvas/free-resize";

const LABELS: Record<FreeResizeHandle, string> = { w: "左边", e: "右边", nw: "左上角", ne: "右上角", sw: "左下角", se: "右下角" };

/** Shared screen-sized handles; the parent remains in world coordinates. */
export function CanvasFreeResizeHandles({ zoom, group = false, active, size, onBegin, onMove, onEnd, onCancel, onKeyDown }: {
  zoom: number;
  group?: boolean;
  active?: FreeResizeHandle | null;
  size?: string;
  onBegin: (e: PointerEvent, handle: FreeResizeHandle) => void;
  onMove: (e: PointerEvent) => void;
  onEnd: (e: PointerEvent) => void;
  onCancel: () => void;
  onKeyDown?: (e: KeyboardEvent, handle: FreeResizeHandle) => void;
}) {
  return <>
    {FREE_RESIZE_HANDLES.map((handle) => (
      <div
        key={handle}
        className={`canvas-resize-handle canvas-resize-${handle}${!group && handle === "e" ? " canvas-free-resize" : ""}`}
        data-resize-handle={handle}
        style={{ transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        role="button"
        tabIndex={0}
        aria-label={!group && handle === "e" ? "拖动调整自由容器宽度" : `拖动${LABELS[handle]}缩放${group ? "整组自由容器" : "自由容器"}`}
        title={`${LABELS[handle]}缩放 · Shift 中心缩放 · Alt 关闭吸附 · Esc 取消`}
        onPointerDown={(e) => onBegin(e, handle)}
        onPointerMove={onMove}
        onPointerUp={onEnd}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
        onKeyDown={(e) => onKeyDown?.(e, handle)}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    ))}
    {active && size && <span
      className={`canvas-resize-size canvas-resize-${active}`}
      style={{ transform: `translate(14px, 14px) scale(${1 / zoom})`, transformOrigin: "top left" }}
      role="status"
    >{size}</span>}
  </>;
}
