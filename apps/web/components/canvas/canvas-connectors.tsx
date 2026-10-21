"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { connectorAnchor, connectorPoints, createConnector, deleteConnector, updateConnector } from "@/lib/canvas/connectors";
import { screenToWorld } from "@/lib/canvas/coords";
import { CANVAS_COLOR_KEYS, COLOR_LABELS } from "@/lib/canvas/text-styles";
import { CANVAS_LIMITS } from "@/lib/canvas/validation";
import type { CanvasConnector, CanvasConnectorSide, CanvasDoc } from "@/lib/canvas/model";
import type { SnapRect } from "@/lib/canvas/snap";
import type { CanvasSelection, CanvasStore } from "./canvas-store";
import { toast } from "@/hooks/use-toast";

type Draft = { from: string; side?: CanvasConnectorSide; point?: { x: number; y: number }; pointerId?: number };
export function useCanvasConnectors(store: CanvasStore, viewport: RefObject<HTMLDivElement | null>, interactive: boolean, connectionsOnly = false) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef<Draft | null>(null);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const update = (value: Draft | null) => { current.current = value; setDraft(value); };
  const canEdit = () => interactive && !store.getState().readOnly && !store.getState().previewMode;
  const cancel = () => update(null);
  const start = (from: string, side?: CanvasConnectorSide, pointerId?: number) => {
    if (!canEdit()) return;
    store.getState().stopEdit();
    store.getState().select({ kind: "free", itemId: from });
    update({ from, side, pointerId });
  };
  const finish = (to: string | undefined) => {
    const pending = current.current;
    if (pending && to && canEdit()) {
      if ((store.getState().doc.connectors?.length ?? 0) >= CANVAS_LIMITS.maxConnectors) {
        toast({ title: "无法连接", description: "连接线数量已达上限", variant: "destructive" });
      } else store.getState().apply("创建连接线", (doc) => createConnector(doc, pending.from, to, pending.side));
    }
    cancel();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { current.current = null; setDraft(null); } };
    const blur = () => { current.current = null; setDraft(null); };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("blur", blur); };
  }, []);
  useEffect(() => {
    const unsubscribe = store.subscribe((state) => {
      if (state.readOnly || state.previewMode || current.current && !state.doc.freeItems.some((item) => item.id === current.current!.from)) {
        current.current = null; setDraft(null);
      }
    });
    if (!interactive) { current.current = null; setDraft(null); }
    return unsubscribe;
  }, [interactive, store]);
  useEffect(() => {
    if (editingLabel) { labelRef.current?.focus(); labelRef.current?.select(); }
  }, [editingLabel]);
  const consume = (e: ReactPointerEvent) => { e.preventDefault(); e.stopPropagation(); };
  return {
    draft, editingLabel, labelRef, start, cancel,
    keyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
      if (!canEdit() || e.key !== "Enter") return;
      const item = (e.target as Element).closest<HTMLElement>("[data-free-item-id]")?.dataset.freeItemId;
      if (!item || (e.target as Element).closest("button, input, textarea")) return;
      if (current.current) { e.preventDefault(); e.stopPropagation(); finish(item); }
      else if (connectionsOnly) { e.preventDefault(); e.stopPropagation(); store.getState().select({ kind: "free", itemId: item }); }
    },
    editLabel: (id: string) => { if (canEdit()) { setEditingLabel(id); labelRef.current?.focus(); } },
    down(e: ReactPointerEvent<HTMLDivElement>) {
      if (!canEdit() || e.button !== 0) return false;
      const target = e.target as Element;
      if (target.closest("[data-connector-id], .canvas-connector-toolbar, .canvas-connect-hint")) return true;
      const port = target.closest<HTMLElement>("[data-connector-port]");
      const item = target.closest<HTMLElement>("[data-free-item-id]")?.dataset.freeItemId;
      if (current.current && !target.closest("[data-connect-start]")) {
        consume(e); finish(item); return true;
      }
      if (port && item) {
        consume(e);
        start(item, port.dataset.connectorPort as CanvasConnectorSide, e.pointerId);
        e.currentTarget.setPointerCapture(e.pointerId);
        return true;
      }
      if (connectionsOnly && item && !target.closest("button, input, textarea")) {
        consume(e);
        store.getState().select({ kind: "free", itemId: item });
        return true;
      }
      return false;
    },
    move(e: ReactPointerEvent<HTMLDivElement>) {
      const pending = current.current;
      if (!pending || pending.pointerId !== e.pointerId) return false;
      consume(e);
      const rect = viewport.current?.getBoundingClientRect();
      if (rect) update({ ...pending, point: screenToWorld(e.clientX, e.clientY, rect, store.getState().viewport) });
      return true;
    },
    up(e: ReactPointerEvent<HTMLDivElement>) {
      if (!current.current || current.current.pointerId !== e.pointerId) return;
      consume(e);
      const to = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-free-item-id]")?.dataset.freeItemId;
      finish(to);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
  };
}

export function CanvasConnectorLayer({ store, doc, selection, boxes, zoom, interactive, draft, onEditLabel }: {
  store: CanvasStore; doc: CanvasDoc; selection: CanvasSelection;
  boxes: (SnapRect & { itemId: string })[]; zoom: number; interactive: boolean;
  draft: Draft | null; onEditLabel: (id: string) => void;
}) {
  const prefix = useId().replace(/:/g, "");
  const rects = new Map(boxes.map((box) => [box.itemId, box]));
  const pick = (id: string) => { store.getState().stopEdit(); store.getState().select({ kind: "connector", connectorId: id }); };
  const canEdit = interactive && !store.getState().readOnly;
  return <svg className="canvas-connectors" role="group" aria-label="元素连接线">
    {(doc.connectors ?? []).map((edge, index) => {
      const from = rects.get(edge.from), to = rects.get(edge.to);
      if (!from || !to) return null;
      const { start, end } = connectorPoints(edge, from, to);
      const selected = selection?.kind === "connector" && selection.connectorId === edge.id;
      const color = edge.color ? `var(--cv-text-${edge.color})` : "hsl(var(--foreground))";
      const marker = `${prefix}-${index}`;
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      return <g key={edge.id} data-connector-id={edge.id} className={selected ? "is-selected" : ""}
        role={canEdit ? "button" : undefined} tabIndex={canEdit ? 0 : undefined}
        aria-label={`连接线${edge.label ? `：${edge.label}` : ""}`} aria-pressed={canEdit ? selected : undefined}
        onPointerDown={canEdit ? (e) => { e.stopPropagation(); pick(edge.id); } : undefined}
        onDoubleClick={canEdit ? (e) => { e.stopPropagation(); pick(edge.id); onEditLabel(edge.id); } : undefined}
        onKeyDown={canEdit ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); pick(edge.id); if (e.key === "Enter") onEditLabel(edge.id); } } : undefined}>
        <defs><marker id={marker} markerWidth={10 / zoom} markerHeight={8 / zoom} refX={9 / zoom} refY={4 / zoom} orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d={`M 0 0 L ${9 / zoom} ${4 / zoom} L 0 ${8 / zoom}`} fill="none" stroke={color} strokeWidth={1.5 / zoom} />
        </marker></defs>
        <line className="canvas-connector-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y}
          stroke="transparent" strokeWidth={20 / zoom} style={{ pointerEvents: canEdit ? "stroke" : "none" }} />
        {selected && <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="hsl(var(--ring))" strokeOpacity="0.2" strokeWidth={8 / zoom} pointerEvents="none" />}
        <line className="canvas-connector-line" x1={start.x} y1={start.y} x2={end.x} y2={end.y}
          stroke={color} strokeWidth={(selected ? 2.5 : 1.5) / zoom} strokeDasharray={edge.line === "dashed" ? `${6 / zoom} ${4 / zoom}` : undefined}
          markerEnd={edge.arrow !== "none" ? `url(#${marker})` : undefined} markerStart={edge.arrow === "both" ? `url(#${marker})` : undefined} pointerEvents="none" />
        {edge.label && <text x={mid.x} y={mid.y - 6 / zoom} textAnchor="middle" fontSize={14 / zoom}
          fill={color} stroke="hsl(var(--background))" strokeWidth={4 / zoom} paintOrder="stroke" style={{ pointerEvents: canEdit ? "auto" : "none" }}>{edge.label}</text>}
      </g>;
    })}
    {draft && (() => {
      const from = rects.get(draft.from);
      if (!from || !draft.point) return null;
      const start = connectorAnchor(from, draft.side ?? "right");
      return <line className="canvas-connector-draft" x1={start.x} y1={start.y} x2={draft.point.x} y2={draft.point.y}
        stroke="hsl(var(--foreground))" strokeWidth={1.5 / zoom} strokeDasharray={`${5 / zoom} ${4 / zoom}`} pointerEvents="none" />;
    })()}
  </svg>;
}

export function CanvasConnectorToolbar({ store, doc, selection, interactive, editingLabel, labelRef }: {
  store: CanvasStore; doc: CanvasDoc; selection: CanvasSelection; interactive: boolean;
  editingLabel: string | null; labelRef: RefObject<HTMLInputElement>;
}) {
  const edge = selection?.kind === "connector" ? doc.connectors?.find((entry) => entry.id === selection.connectorId) : null;
  if (!edge || !interactive || store.getState().readOnly) return null;
  const patch = (value: Partial<CanvasConnector>, typing = false) => store.getState().apply("修改连接线", (doc) => updateConnector(doc, edge.id, value), typing ? { coalesceKey: `connector-label:${edge.id}` } : undefined);
  return <div className="canvas-connector-toolbar" role="toolbar" aria-label="连接线属性" onPointerDown={(e) => e.stopPropagation()}>
    <label>箭头<select aria-label="连接线箭头样式" value={edge.arrow} onChange={(e) => patch({ arrow: e.target.value as CanvasConnector["arrow"] })}>
      <option value="none">无箭头</option><option value="end">单向箭头</option><option value="both">双向箭头</option>
    </select></label>
    <label>线型<select aria-label="连接线线型" value={edge.line} onChange={(e) => patch({ line: e.target.value as CanvasConnector["line"] })}>
      <option value="solid">实线</option><option value="dashed">虚线</option>
    </select></label>
    <div className="canvas-swatch-row" role="group" aria-label="连接线颜色">
      {CANVAS_COLOR_KEYS.map((color) => <button key={color} type="button" className="canvas-swatch" aria-label={`连接线颜色：${COLOR_LABELS[color]}`}
        aria-pressed={edge.color === color} onClick={() => patch({ color })}><span style={{ background: color ? `var(--cv-text-${color})` : "hsl(var(--foreground))" }} /></button>)}
    </div>
    <input ref={labelRef} key={edge.id} aria-label="连接线标签" placeholder="添加短标签" value={edge.label}
      data-editing={editingLabel === edge.id} maxLength={CANVAS_LIMITS.maxConnectorLabelLength}
      onChange={(e) => patch({ label: e.target.value }, true)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }} />
    <Button type="button" size="sm" variant="ghost" aria-label="删除连接线" onClick={() => store.getState().apply("删除连接线", (doc) => deleteConnector(doc, edge.id))}>删除</Button>
  </div>;
}
