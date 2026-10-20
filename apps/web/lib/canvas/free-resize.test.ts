import { describe, expect, it } from "vitest";
import { FREE_RESIZE_HANDLES, resizeFreeItem, scaleFreeGroup } from "./free-resize";
import { snapFreeItem } from "./snap";

const origin = { x: 100, y: 200, width: 200, height: 100 };

describe("single free resize", () => {
  it("left/right anchor the opposite edge and clamp without drifting", () => {
    expect(resizeFreeItem(origin, "w", 40, 0)).toMatchObject({ x: 140, width: 160, y: 200 });
    expect(resizeFreeItem(origin, "w", 1000, 0)).toMatchObject({ x: 220, width: 80 });
    expect(resizeFreeItem(origin, "e", 40, 0)).toMatchObject({ x: 100, width: 240 });
  });
  it.each(FREE_RESIZE_HANDLES)("%s uses its diagonal and opposite anchor", (handle) => {
    const left = handle.includes("w");
    const top = handle.includes("n");
    const next = resizeFreeItem(origin, handle, left ? -100 : 100, top ? -50 : 50, { heightForWidth: (w) => w / 2 });
    expect(next.width).toBe(300);
    expect(next.x).toBe(left ? 0 : 100);
    expect(next.y).toBe(top ? 150 : 200);
  });
  it("vertical corner movement changes width and measured text height anchors the bottom", () => {
    const next = resizeFreeItem(origin, "nw", 0, -50, { heightForWidth: (w) => w < 250 ? 70 : 50 });
    expect(next.width).toBe(220);
    expect(next.y + next.height).toBe(300);
  });
  it("Shift maintains horizontal center (and vertical center at corners)", () => {
    const edge = resizeFreeItem(origin, "w", -50, 0, { center: true });
    expect(edge).toMatchObject({ x: 50, width: 300, y: 200 });
    const corner = resizeFreeItem(origin, "se", 50, 25, { center: true, heightForWidth: (w) => w / 2 });
    expect(corner).toMatchObject({ x: 50, y: 175, width: 300, height: 150 });
  });
  it("snaps the left active edge while preserving right anchor; Alt bypasses", () => {
    const opts = { targets: [{ x: 140, y: 0, width: 500, height: 20 }], threshold: 6 };
    const next = resizeFreeItem(origin, "w", 43, 0, opts);
    expect(next).toMatchObject({ x: 140, width: 160 });
    expect(next.guides[0].pos).toBe(140);
    expect(resizeFreeItem(origin, "w", 43, 0, { ...opts, snapEnabled: false })).toMatchObject({ x: 143, width: 157, guides: [] });
  });
  it("center snapping moves both edges and honors minimum", () => {
    const next = snapFreeItem({ x: 53, y: 0, width: 294, height: 100 }, [{ x: 50, y: 0, width: 600, height: 20 }], 6, "resize-left", { center: true });
    expect(next).toMatchObject({ x: 50, width: 300 });
    expect(next.x + next.width / 2).toBe(200);
    expect(snapFreeItem({ x: 220, y: 0, width: 80, height: 100 }, [{ x: 224, y: 0, width: 600, height: 20 }], 6, "resize-left")).toMatchObject({ x: 220, width: 80, guides: [] });
  });
});

const members = [
  { id: "a", x: 100, y: 200, width: 100, height: 50 },
  { id: "b", x: 300, y: 300, width: 200, height: 100 },
];
describe("scaleFreeGroup", () => {
  it.each(FREE_RESIZE_HANDLES)("%s scales around its opposite anchor", (handle) => {
    const left = handle.includes("w");
    const top = handle.includes("n");
    const next = scaleFreeGroup(members, handle, left ? -400 : 400, top ? -200 : 200);
    expect(next.frame?.width).toBe(800);
    expect(next.members.map((m) => m.width)).toEqual([200, 400]);
    const anchorX = left ? 500 : 100;
    const anchorY = handle.length === 1 ? 300 : top ? 400 : 200;
    next.members.forEach((m, i) => {
      expect(m.x).toBe(anchorX + (members[i].x - anchorX) * 2);
      expect(m.y).toBe(anchorY + (members[i].y - anchorY) * 2);
    });
  });
  it("Shift uses group center on both axes", () => {
    const next = scaleFreeGroup(members, "se", 200, 100, { center: true });
    expect(next.members.map(({ x, y, width }) => ({ x, y, width }))).toEqual([
      { x: -100, y: 100, width: 200 }, { x: 300, y: 300, width: 400 },
    ]);
  });
  it("clamps the whole ratio at the narrowest member; does not flip", () => {
    const next = scaleFreeGroup(members, "w", 10000, 0);
    expect(next.members.map((m) => m.width)).toEqual([80, 160]);
    expect(next.members.map((m) => m.x)).toEqual([180, 340]);
    expect(next.frame?.width).toBe(320);
  });
  it("group edge snapping excludes supplied group members; Alt bypasses", () => {
    const opts = { targets: [{ x: 600, y: 0, width: 800, height: 100 }], threshold: 6 };
    const next = scaleFreeGroup(members, "e", 97, 0, opts);
    expect(next.frame?.width).toBe(500);
    expect(next.frame?.guides[0].pos).toBe(600);
    expect(scaleFreeGroup(members, "e", 97, 0, { ...opts, snapEnabled: false }).frame?.width).toBe(497);
  });
  it("rejects empty/invalid members and nonfinite input", () => {
    expect(scaleFreeGroup([], "e", 10, 0).members).toEqual([]);
    expect(scaleFreeGroup([{ ...members[0], width: 0 }], "e", 10, 0).members).toEqual([]);
    expect(scaleFreeGroup(members, "e", NaN, 0).members).toEqual([]);
  });
});
