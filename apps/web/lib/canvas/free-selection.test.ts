import { describe, expect, it } from "vitest";
import { snapTargetsForItem, type SnapRect } from "./snap";
import type { Scene } from "./layout";
import {
  groupBounds,
  nextFreeIdsOnClick,
  resolveMarqueePick,
  selectionFromFreeIds,
  snapGroupMove,
} from "./free-selection";

describe("自由元素框选", () => {
  it("只命中自由元素时收集它们，一个仍是 free，多个才是 frees", () => {
    const pick = resolveMarqueePick({
      baseBlockIds: [],
      baseFreeIds: [],
      hitBlockIds: [],
      hitFreeIds: ["a", "b"],
    });
    expect(pick).toEqual({ kind: "free-items", ids: ["a", "b"] });
    expect(selectionFromFreeIds(pick.ids)).toEqual({ kind: "frees", itemIds: ["a", "b"] });
    expect(selectionFromFreeIds(["a"])).toEqual({ kind: "free", itemId: "a" });
    expect(selectionFromFreeIds([])).toBeNull();
  });

  it("碰到页面模块时忽略自由元素，并保留 Shift 已选模块", () => {
    expect(resolveMarqueePick({
      baseBlockIds: ["kept"],
      baseFreeIds: [],
      hitBlockIds: ["hit"],
      hitFreeIds: ["free-a"],
    })).toEqual({ kind: "blocks", ids: ["kept", "hit"] });
  });

  it("Shift 框选把命中的自由元素追加到已有自由选区", () => {
    expect(resolveMarqueePick({
      baseBlockIds: [],
      baseFreeIds: ["a"],
      hitBlockIds: [],
      hitFreeIds: ["b", "a"],
    })).toEqual({ kind: "free-items", ids: ["a", "b"] });
  });

  it("空白框选保留按下时的模块选区，不把选区清掉", () => {
    expect(resolveMarqueePick({
      baseBlockIds: ["kept"],
      baseFreeIds: [],
      hitBlockIds: [],
      hitFreeIds: [],
    })).toEqual({ kind: "blocks", ids: ["kept"] });
    expect(resolveMarqueePick({
      baseBlockIds: [],
      baseFreeIds: ["a"],
      hitBlockIds: [],
      hitFreeIds: [],
    })).toEqual({ kind: "free-items", ids: ["a"] });
  });
});

describe("Shift 点击自由元素", () => {
  it("加入、移出；单击已选中的成员保持整组", () => {
    expect(nextFreeIdsOnClick(["a"], "b", true)).toEqual(["a", "b"]);
    expect(nextFreeIdsOnClick(["a", "b"], "a", true)).toEqual(["b"]);
    expect(nextFreeIdsOnClick(["a", "b"], "a", false)).toEqual(["a", "b"]);
    expect(nextFreeIdsOnClick(["a", "b"], "c", false)).toEqual(["c"]);
    expect(selectionFromFreeIds(nextFreeIdsOnClick(["a", "b"], "a", true))).toEqual({ kind: "free", itemId: "b" });
  });
});

describe("整组吸附", () => {
  const members: SnapRect[] = [
    { x: 0, y: 0, width: 100, height: 40 },
    { x: 200, y: 0, width: 100, height: 40 },
  ];

  it("用外接矩形算一次位移，组内每个成员共用", () => {
    expect(groupBounds(members)).toEqual({ x: 0, y: 0, width: 300, height: 40 });
    const snapped = snapGroupMove(members, 10, 0, [{ x: 8, y: 0, width: 40, height: 40 }], 6, true);
    expect(snapped.dx).toBe(8);
    expect(snapped.dy).toBe(0);
    expect(snapped.guides.some((guide) => guide.axis === "x" && guide.pos === 8)).toBe(true);
    expect(members.map((member) => ({ x: member.x + snapped.dx, y: member.y + snapped.dy }))).toEqual([
      { x: 8, y: 0 },
      { x: 208, y: 0 },
    ]);
  });

  it("关闭吸附时位移保持原样", () => {
    const snapped = snapGroupMove(members, 10, 4, [{ x: 8, y: 0, width: 40, height: 40 }], 6, false);
    expect(snapped).toEqual({ dx: 10, dy: 4, guides: [] });
  });

  it("成组吸附目标排除组内全部自由元素", () => {
    const scene: Scene = {
      boards: [{ boardId: "b", x: 0, y: 400, width: 800, height: 600, regions: [] }],
      freeItems: [
        { itemId: "a", x: 0, y: 0, width: 100, height: 40, zIndex: 1 },
        { itemId: "b", x: 200, y: 0, width: 100, height: 40, zIndex: 2 },
        { itemId: "c", x: 500, y: 20, width: 80, height: 40, zIndex: 3 },
      ],
    };
    const targets = snapTargetsForItem(scene, ["a", "b"]);
    expect(targets).toEqual([
      { x: 500, y: 20, width: 80, height: 40 },
      { x: 0, y: 400, width: 800, height: 600 },
    ]);
  });
});
