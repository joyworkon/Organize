import { describe, expect, it } from "vitest";
import { alignFreeItems, distributeFreeItems, type FreeArrangeMember } from "./free-align";

function member(id: string, x: number, y: number, width: number, height: number): FreeArrangeMember {
  return { id, x, y, width, height };
}

describe("alignFreeItems", () => {
  const pair = [
    member("a", 0, 10, 100, 40),
    member("b", 150, 30, 60, 100),
  ];

  it("左对齐只改 x，把每个成员贴到外接矩形左缘", () => {
    expect(alignFreeItems(pair, "left")).toEqual([{ itemId: "b", x: 0 }]);
    expect(pair[1].x).toBe(150);
  });

  it("右对齐贴到右缘，宽不变；已经贴住的成员不进补丁", () => {
    expect(alignFreeItems(pair, "right")).toEqual([{ itemId: "a", x: 110 }]);
  });

  it("水平居中按各自宽度把中心放到选区中线", () => {
    expect(alignFreeItems(pair, "center-x")).toEqual([
      { itemId: "a", x: 55 },
      { itemId: "b", x: 75 },
    ]);
  });

  it("顶对齐和底对齐用传入的高度，不猜固定高", () => {
    expect(alignFreeItems(pair, "top")).toEqual([{ itemId: "b", y: 10 }]);
    expect(alignFreeItems(pair, "bottom")).toEqual([{ itemId: "a", y: 90 }]);
    expect(alignFreeItems(pair, "center-y")).toEqual([
      { itemId: "a", y: 50 },
      { itemId: "b", y: 20 },
    ]);
  });

  it("已经对齐时不返回补丁", () => {
    const aligned = [member("a", 0, 0, 80, 20), member("b", 0, 40, 40, 20)];
    expect(alignFreeItems(aligned, "left")).toEqual([]);
  });

  it("不足 2 个或几何非法时返回空", () => {
    expect(alignFreeItems([pair[0]], "left")).toEqual([]);
    expect(alignFreeItems([], "bottom")).toEqual([]);
    expect(alignFreeItems([pair[0], member("b", Number.NaN, 0, 10, 10)], "left")).toEqual([]);
  });
});

describe("distributeFreeItems", () => {
  it("水平分布让间隙相等，左右两端和 y 不动", () => {
    const members = [
      member("a", 0, 5, 100, 40),
      member("b", 120, 8, 40, 20),
      member("c", 300, 1, 80, 60),
    ];
    expect(distributeFreeItems(members, "x")).toEqual([{ itemId: "b", x: 180 }]);
    const placed = { a: 0, b: 180, c: 300 };
    const widths = { a: 100, b: 40, c: 80 };
    const gap = placed.b - (placed.a + widths.a);
    expect(gap).toBe(placed.c - (placed.b + widths.b));
    expect(placed.a).toBe(0);
    expect(placed.c + widths.c).toBe(380);
  });

  it("垂直分布按中心排序，上下两端不动", () => {
    const members = [
      member("a", 1, 0, 10, 40),
      member("b", 2, 20, 10, 100),
      member("c", 3, 200, 10, 20),
    ];
    expect(distributeFreeItems(members, "y")).toEqual([{ itemId: "b", y: 70 }]);
    expect(0).toBe(0);
    expect(70 + 100).toBeLessThan(200);
    const gap = 70 - 40;
    expect(200 - (70 + 100)).toBe(gap);
  });

  it("中心顺序和左缘不一致时按中心排，外接矩形两端仍不动", () => {
    const members = [
      member("a", 0, 0, 200, 10),
      member("b", 30, 0, 20, 10),
      member("c", 400, 0, 40, 10),
    ];
    expect(distributeFreeItems(members, "x")).toEqual([
      { itemId: "b", x: 0 },
      { itemId: "a", x: 110 },
    ]);
  });

  it("重叠时用负间隙，两端仍是原来的外接矩形", () => {
    const members = [
      member("a", 0, 0, 100, 10),
      member("b", 50, 0, 100, 10),
      member("c", 20, 0, 100, 10),
    ];
    const patches = distributeFreeItems(members, "x");
    const xOf = new Map(members.map((item) => [item.id, item.x]));
    for (const patch of patches) xOf.set(patch.itemId, patch.x ?? 0);
    const ordered = [...members].sort((a, b) => (a.x + a.width / 2) - (b.x + b.width / 2));
    const xs = ordered.map((item) => xOf.get(item.id) ?? item.x);
    const gaps = [xs[1] - (xs[0] + 100), xs[2] - (xs[1] + 100)];
    expect(gaps[0]).toBeCloseTo(gaps[1], 6);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs) + 100).toBe(150);
  });

  it("不足 3 个时返回空", () => {
    const members = [member("a", 0, 0, 10, 10), member("b", 40, 0, 10, 10)];
    expect(distributeFreeItems(members, "x")).toEqual([]);
    expect(distributeFreeItems([members[0]], "y")).toEqual([]);
    expect(distributeFreeItems([], "x")).toEqual([]);
  });
});
