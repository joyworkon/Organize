import { describe, expect, it } from "vitest";
import { connectorAnchor, connectorPoints, createConnector, deleteConnector, nearestConnectorSide, updateConnector } from "./connectors";
import { createBoard, createFreeText, deleteFreeItem, attachFreeItemToRegion } from "./commands";
import { emptyDoc, ensureCanvasDocV2 } from "./model";
import { CANVAS_LIMITS, validateCanvasContent } from "./validation";
import { copyCanvasSelection, pasteCanvasClipboard } from "./clipboard";
import { createCanvasStore } from "@/components/canvas/canvas-store";
import { duplicateCanvasSelection } from "@/components/canvas/canvas-shortcuts";
import { boundsForSelection } from "./selection-bounds";
import { computeScene } from "./layout";

function fixture() {
  let n = 0;
  const id = () => `id-${++n}`;
  let doc = createFreeText(emptyDoc(), { x: 0, y: 0 }, id).doc;
  doc = createFreeText(doc, { x: 400, y: 200 }, id).doc;
  doc = createFreeText(doc, { x: 800, y: 400 }, id).doc;
  const [a, b, c] = doc.freeItems.map((item) => item.id);
  return { doc, a, b, c, id };
}
const pasteTarget = { pointer: null, pasteIndex: 0, selection: null, explicit: null };

describe("connector geometry", () => {
  const rect = { x: -100, y: 50, width: 200, height: 80 };
  it("uses edge midpoints, including negative world coordinates", () => {
    expect(connectorAnchor(rect, "top")).toEqual({ x: 0, y: 50 });
    expect(connectorAnchor(rect, "right")).toEqual({ x: 100, y: 90 });
    expect(connectorAnchor(rect, "bottom")).toEqual({ x: 0, y: 130 });
    expect(connectorAnchor(rect, "left")).toEqual({ x: -100, y: 90 });
    expect(nearestConnectorSide(rect, { x: 1000, y: 90 })).toBe("right");
  });
  it("automatic edges track moved and resized measured boxes, fixed source stays on its side", () => {
    const to = { x: 400, y: 50, width: 200, height: 80 };
    expect(connectorPoints({}, rect, to)).toEqual({ start: { x: 100, y: 90 }, end: { x: 400, y: 90 } });
    expect(connectorPoints({}, { ...rect, width: 300 }, to).start.x).toBe(200);
    expect(connectorPoints({ fromSide: "bottom" }, rect, to).start).toEqual({ x: 0, y: 130 });
    expect(connectorPoints({}, rect, { ...to, x: -600 }).start.x).toBe(-100);
    expect(connectorPoints({}, rect, { ...to, x: -100, y: 600 }).start.y).toBe(130);
  });
  it("overlapping/coincident boxes produce finite, deterministic points", () => {
    expect(connectorPoints({}, rect, rect)).toEqual(connectorPoints({}, rect, rect));
    expect(Object.values(connectorPoints({}, rect, rect)).flatMap(Object.values).every(Number.isFinite)).toBe(true);
  });
});

describe("connector document lifecycle", () => {
  it("creation is immutable, rejects dangling endpoints and self-links", () => {
    const { doc, a, b, id } = fixture();
    const result = createConnector(doc, a, b, "right", id);
    expect(doc.connectors).toEqual([]);
    expect(result.focus?.kind).toBe("connector");
    expect(validateCanvasContent(result.doc).errors).toEqual([]);
    expect(createConnector(doc, a, a).doc).toBe(doc);
    expect(createConnector(doc, a, "missing").doc).toBe(doc);
  });
  it("deleting or attaching an endpoint removes its edges atomically, keeping unrelated edges", () => {
    const { doc, a, b, c, id } = fixture();
    let connected = createConnector(doc, a, b, undefined, id).doc;
    connected = createConnector(connected, b, c, undefined, id).doc;
    const removed = deleteFreeItem(connected, { itemId: a }).doc;
    expect(removed.connectors).toHaveLength(1);
    expect(removed.connectors![0].from).toBe(b);
    const withBoard = createBoard(connected, { x: 0, y: 600 }, id).doc;
    const board = withBoard.boards[0];
    const attached = attachFreeItemToRegion(withBoard, { freeItemId: b, boardId: board.id, regionId: board.regions[0].id }, id).doc;
    expect(attached.connectors).toEqual([]);
    expect(validateCanvasContent(attached).ok).toBe(true);
    expect(connected.connectors).toHaveLength(2);
  });
  it("copies only internal edges and remaps IDs; repeated paste and duplicate remain valid", () => {
    const { doc, a, b, c, id } = fixture();
    const internal = createConnector(doc, a, b, undefined, id).doc;
    const connected = createConnector(internal, b, c, undefined, id).doc;
    const payload = copyCanvasSelection(connected, { kind: "frees", itemIds: [a, b] })!;
    const result = pasteCanvasClipboard(connected, payload, pasteTarget, id);
    expect(result.doc.connectors).toHaveLength(3);
    const edge = result.doc.connectors!.at(-1)!;
    expect(result.itemIds).toContain(edge.from);
    expect(result.itemIds).toContain(edge.to);
    expect([a, b]).not.toContain(edge.from);
    expect(validateCanvasContent(result.doc).ok).toBe(true);
    expect(validateCanvasContent(pasteCanvasClipboard(result.doc, payload, pasteTarget, id).doc).ok).toBe(true);
    const duplicated = duplicateCanvasSelection(connected, { kind: "frees", itemIds: [a, b] });
    expect(duplicated.doc.connectors).toHaveLength(3);
    expect(validateCanvasContent(duplicated.doc).ok).toBe(true);
    const single = copyCanvasSelection(connected, { kind: "free", itemId: a });
    expect(single?.kind === "free" && single.connectors).toEqual([]);
  });
  it("undo/redo restores connector properties, selection and cascade deletion as whole snapshots", () => {
    const { doc, a, b, id } = fixture();
    const store = createCanvasStore({ doc });
    const s = () => store.getState();
    s().apply("连接", (doc) => createConnector(doc, a, b, undefined, id));
    const edgeId = s().doc.connectors![0].id;
    expect(s().selection).toEqual({ kind: "connector", connectorId: edgeId });
    s().apply("样式", (doc) => updateConnector(doc, edgeId, { color: "blue", arrow: "both", line: "dashed", label: "关系" }));
    s().undo(); expect(s().doc.connectors![0].label).toBe("");
    s().redo(); expect(s().doc.connectors![0].label).toBe("关系");
    s().apply("删元素", (doc) => deleteFreeItem(doc, { itemId: a }));
    expect(s().doc.connectors).toEqual([]); expect(s().selection).toBeNull();
    s().undo(); expect(s().doc.connectors![0].label).toBe("关系");
    expect(s().selection).toEqual({ kind: "connector", connectorId: edgeId });
    s().apply("删线", (doc) => deleteConnector(doc, edgeId));
    s().undo(); expect(s().doc.connectors).toHaveLength(1);
    s().redo(); expect(s().doc.connectors).toHaveLength(0);
    const locked = createCanvasStore({ doc: s().doc, readOnly: true });
    locked.getState().apply("连接", (doc) => createConnector(doc, a, b));
    expect(locked.getState().doc).toBe(s().doc);
  });
  it("rejects over-limit create/paste without partial mutations", () => {
    const { doc, a, b, id } = fixture();
    const connected = createConnector(doc, a, b, undefined, id).doc;
    const payload = copyCanvasSelection(connected, { kind: "frees", itemIds: [a, b] })!;
    const full = { ...connected, connectors: Array.from({ length: CANVAS_LIMITS.maxConnectors }, (_, i) => ({ ...connected.connectors![0], id: `edge-${i}` })) };
    expect(createConnector(full, a, b).doc).toBe(full);
    expect(pasteCanvasClipboard(full, payload, pasteTarget, id).doc).toBe(full);
    expect(pasteCanvasClipboard(full, payload, pasteTarget, id).rejected).toBeTruthy();
  });
  it("fit selection includes both endpoints; scene/minimap/outline geometry remains unchanged", () => {
    const { doc, a, b, id } = fixture();
    const connected = createConnector(doc, a, b, undefined, id).doc;
    const scene = computeScene(connected, () => 40);
    expect(scene).toEqual(computeScene(doc, () => 40));
    const bounds = boundsForSelection(scene, { kind: "connector", connectorId: connected.connectors![0].id }, connected)!;
    expect(bounds.x).toBe(0); expect(bounds.width).toBeGreaterThan(400);
  });
});

describe("connector compatibility and validation", () => {
  it("normalizes absent field in old v1/v2 data without mutating input; JSON round-trip preserves fields", () => {
    for (const schemaVersion of [1, 2]) {
      const old = { schemaVersion, boards: [], freeItems: [] };
      const result = validateCanvasContent(old);
      expect(result.ok).toBe(true); expect(result.doc!.connectors).toEqual([]);
      expect(old).not.toHaveProperty("connectors");
    }
    const { doc, a, b, id } = fixture();
    const connected = createConnector(doc, a, b, "left", id).doc;
    expect(validateCanvasContent(JSON.parse(JSON.stringify(connected))).doc).toEqual(connected);
    expect(ensureCanvasDocV2(connected)).toBe(connected);
  });
  it.each([
    ["arrow", "bad"], ["line", "bad"], ["color", "url(evil)"], ["label", "x".repeat(101)],
    ["label", null], ["from", "missing"], ["fromSide", "center"], ["toSide", "bad"], ["id", ""],
  ])("rejects invalid %s", (key, value) => {
    const { doc, a, b, id } = fixture();
    const connected = createConnector(doc, a, b, undefined, id).doc;
    const raw = { ...connected, connectors: [{ ...connected.connectors![0], [key]: value }] };
    expect(validateCanvasContent(raw).ok).toBe(false);
  });
  it("rejects malformed arrays/entries, duplicate IDs, self-links and excessive edges", () => {
    const { doc, a, b, id } = fixture();
    const connected = createConnector(doc, a, b, undefined, id).doc;
    const edge = connected.connectors![0];
    for (const connectors of [null, {}, [null], ["bad"], [{ ...edge, id: a }], [edge, edge], [{ ...edge, to: a }], Array(401).fill(edge)]) {
      expect(validateCanvasContent({ ...connected, connectors }).ok).toBe(false);
    }
    expect(updateConnector(connected, edge.id, { color: "bad" }).doc).toBe(connected);
    expect(updateConnector(connected, edge.id, { label: "x".repeat(101) }).doc).toBe(connected);
    expect(deleteConnector(connected, "missing").doc).toBe(connected);
  });
});
