/** Connector commands and edge anchors. Geometry uses the same measured boxes as free items. */
import { defaultIdGenerator, type CanvasConnector, type CanvasConnectorSide, type CanvasDoc, type CanvasCommandResult, type CanvasIdGenerator } from "./model";
import type { SnapRect } from "./snap";
import { CANVAS_LIMITS } from "./validation";
import { CANVAS_COLOR_KEYS } from "./text-styles";

export const CONNECTOR_SIDES: CanvasConnectorSide[] = ["top", "right", "bottom", "left"];
export function connectorAnchor(rect: SnapRect, side: CanvasConnectorSide) {
  switch (side) {
    case "top": return { x: rect.x + rect.width / 2, y: rect.y };
    case "right": return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case "bottom": return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case "left": return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}
export function nearestConnectorSide(rect: SnapRect, point: { x: number; y: number }): CanvasConnectorSide {
  return CONNECTOR_SIDES.reduce((best, side) => {
    const a = connectorAnchor(rect, side), b = connectorAnchor(rect, best);
    return Math.hypot(a.x - point.x, a.y - point.y) < Math.hypot(b.x - point.x, b.y - point.y) ? side : best;
  });
}
export function connectorPoints(edge: Pick<CanvasConnector, "fromSide" | "toSide">, from: SnapRect, to: SnapRect) {
  const center = (r: SnapRect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  return {
    start: connectorAnchor(from, edge.fromSide ?? nearestConnectorSide(from, center(to))),
    end: connectorAnchor(to, edge.toSide ?? nearestConnectorSide(to, center(from))),
  };
}
export function createConnector(doc: CanvasDoc, from: string, to: string, fromSide?: CanvasConnectorSide, newId: CanvasIdGenerator = defaultIdGenerator): CanvasCommandResult {
  if (from === to || !doc.freeItems.some((item) => item.id === from) || !doc.freeItems.some((item) => item.id === to) || (doc.connectors?.length ?? 0) >= CANVAS_LIMITS.maxConnectors) return { doc };
  const edge: CanvasConnector = { id: newId(), from, to, fromSide, arrow: "end", line: "solid", color: "", label: "" };
  return { doc: { ...doc, connectors: [...(doc.connectors ?? []), edge] }, focus: { kind: "connector", connectorId: edge.id } };
}
export function updateConnector(doc: CanvasDoc, id: string, patch: Partial<Pick<CanvasConnector, "arrow" | "line" | "color" | "label">>): CanvasCommandResult {
  if (patch.arrow !== undefined && !["none", "end", "both"].includes(patch.arrow) ||
      patch.line !== undefined && !["solid", "dashed"].includes(patch.line) ||
      patch.color !== undefined && !CANVAS_COLOR_KEYS.some((key) => key === patch.color) ||
      patch.label !== undefined && patch.label.length > CANVAS_LIMITS.maxConnectorLabelLength) return { doc };
  const edge = doc.connectors?.find((entry) => entry.id === id);
  if (!edge || Object.entries(patch).every(([key, value]) => edge[key as keyof CanvasConnector] === value)) return { doc };
  return { doc: { ...doc, connectors: doc.connectors!.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) } };
}
export function deleteConnector(doc: CanvasDoc, id: string): CanvasCommandResult {
  if (!doc.connectors?.some((edge) => edge.id === id)) return { doc };
  return { doc: { ...doc, connectors: doc.connectors.filter((edge) => edge.id !== id) } };
}
