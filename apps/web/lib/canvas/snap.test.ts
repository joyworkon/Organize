import { describe, expect, it } from "vitest";
import type { Scene } from "./layout";
import { MIN_FREE_ITEM_WIDTH, snapFreeItem, snapTargetsForItem, type SnapRect } from "./snap";

const rect = (x: number, y: number, width = 100, height = 60): SnapRect => ({ x, y, width, height });

describe("snapFreeItem · move", () => {
  it("左对齐：自身左缘吸附到目标左缘", () => {
    const result = snapFreeItem(rect(103, 300), [rect(100, 0)], 6, "move");
    expect(result.x).toBe(100);
    expect(result.y).toBe(300);
    expect(result.guides).toEqual([
      { axis: "x", pos: 100, from: 0, to: 360 },
    ]);
  });

  it("中线对齐：自身水平中线吸附到目标水平中线", () => {
    // 自身宽 100 → 中点 402；目标 x=300 宽 200 → 中点 400；唯一阈值内配对，差 -2
    const result = snapFreeItem(rect(352, 300), [{ x: 300, y: 100, width: 200, height: 60 }], 6, "move");
    expect(result.x).toBe(350);
    expect(result.guides).toEqual([
      { axis: "x", pos: 400, from: 100, to: 360 },
    ]);
  });

  it("右对齐：自身右缘吸附到目标右缘", () => {
    // 自身 x=137 宽 100 → 右缘 237；目标宽 240 → 右缘 240；唯一阈值内配对，差 +3
    const result = snapFreeItem(rect(137, 300), [{ x: 0, y: 0, width: 240, height: 80 }], 6, "move");
    expect(result.x).toBe(140);
    expect(result.guides).toEqual([
      { axis: "x", pos: 240, from: 0, to: 360 },
    ]);
  });

  it("上对齐：自身上缘吸附到目标上缘", () => {
    const result = snapFreeItem(rect(300, 104), [rect(0, 100)], 6, "move");
    expect(result.y).toBe(100);
    expect(result.guides).toEqual([
      { axis: "y", pos: 100, from: 0, to: 400 },
    ]);
  });

  it("垂直中线对齐：自身垂直中线吸附到目标垂直中线", () => {
    // 自身高 60 → 中点 283；目标 y=200 高 160 → 中点 280；唯一阈值内配对，差 -3
    const result = snapFreeItem(rect(300, 253), [{ x: 0, y: 200, width: 100, height: 160 }], 6, "move");
    expect(result.y).toBe(250);
    expect(result.guides).toEqual([
      { axis: "y", pos: 280, from: 0, to: 400 },
    ]);
  });

  it("下对齐：自身下缘吸附到目标下缘", () => {
    // 自身 y=344 高 60 → 下缘 404；目标 y=300 高 100 → 下缘 400；最近配对（-4 < 上缘对中线 +6）
    const result = snapFreeItem(rect(300, 344, 100, 60), [rect(0, 300, 100, 100)], 6, "move");
    expect(result.y).toBe(340);
    expect(result.guides).toEqual([
      { axis: "y", pos: 400, from: 0, to: 400 },
    ]);
  });

  it("阈值外不吸附", () => {
    const result = snapFreeItem(rect(107, 300), [rect(100, 0)], 6, "move");
    expect(result.x).toBe(107);
    expect(result.guides).toEqual([]);
  });

  it("多个候选取最近", () => {
    // 目标 A 左缘 95（差 -5），目标 B 左缘 99（差 -1）→ 取 B
    const result = snapFreeItem(rect(100, 300), [rect(95, 0), rect(99, 500)], 6, "move");
    expect(result.x).toBe(99);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({ axis: "x", pos: 99 });
  });

  it("两轴可同时吸附并各出一条参考线", () => {
    const result = snapFreeItem(rect(102, 203), [rect(100, 200)], 6, "move");
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(result.guides).toHaveLength(2);
  });

  it("空目标列表不吸附（调用方负责排除自身）", () => {
    const result = snapFreeItem(rect(100, 100), [], 6, "move");
    expect(result).toMatchObject({ x: 100, y: 100, width: 100, guides: [] });
  });
});

describe("snapTargetsForItem", () => {
  const scene: Scene = {
    boards: [{ boardId: "b1", x: 0, y: 0, width: 800, height: 600, regions: [] }],
    freeItems: [
      { itemId: "a", x: 10, y: 20, width: 100, height: 60, zIndex: 0 },
      { itemId: "b", x: 300, y: 20, width: 120, height: 80, zIndex: 1 },
    ],
  };

  it("包含其他自由元素与全部页面，并排除自身", () => {
    const targets = snapTargetsForItem(scene, "a");
    expect(targets).toHaveLength(2);
    expect(targets).toContainEqual({ x: 300, y: 20, width: 120, height: 80 });
    expect(targets).toContainEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(targets.some((t) => t.x === 10 && t.width === 100)).toBe(false);
  });

  it("唯一的自由元素被排除后只剩页面", () => {
    const targets = snapTargetsForItem({ boards: scene.boards, freeItems: [scene.freeItems[0]] }, "a");
    expect(targets).toEqual([{ x: 0, y: 0, width: 800, height: 600 }]);
  });
});

describe("snapFreeItem · resize", () => {
  it("右缘吸附到目标左缘，宽度随之修正", () => {
    // 自身 x=0 宽 203 → 右缘 203；目标 x=200 → 差 -3
    const result = snapFreeItem(rect(0, 300, 203), [rect(200, 0)], 6, "resize");
    expect(result.width).toBe(200);
    expect(result.x).toBe(0);
    expect(result.guides).toEqual([
      { axis: "x", pos: 200, from: 0, to: 360 },
    ]);
  });

  it("右缘吸附到目标中线", () => {
    // 右缘 252；目标 x=200 宽 100 → 中线 250；差 -2
    const result = snapFreeItem(rect(0, 300, 252), [rect(200, 0)], 6, "resize");
    expect(result.width).toBe(250);
  });

  it("阈值外不吸附", () => {
    const result = snapFreeItem(rect(0, 300, 208), [rect(200, 0)], 6, "resize");
    expect(result.width).toBe(208);
    expect(result.guides).toEqual([]);
  });

  it(`宽度不小于 ${MIN_FREE_ITEM_WIDTH}（低于下限视为未吸附）`, () => {
    // 右缘 84；目标左缘 80 → 差 -4 → 宽度 80 - 但等于下限可吸附？这里差 -4 得 80，等于下限允许
    const ok = snapFreeItem(rect(0, 300, 84), [rect(80, 0)], 6, "resize");
    expect(ok.width).toBe(MIN_FREE_ITEM_WIDTH);
    expect(ok.guides).toEqual([{ axis: "x", pos: 80, from: 0, to: 360 }]);
    // 差 -4 → 宽度 78 < 80：不吸附，宽度直接夹到 80，无参考线
    const clamped = snapFreeItem(rect(0, 300, 82), [rect(78, 0)], 6, "resize");
    expect(clamped.width).toBe(MIN_FREE_ITEM_WIDTH);
    expect(clamped.guides).toEqual([]);
  });

  it("Y 轴不受影响", () => {
    const result = snapFreeItem(rect(0, 203, 203), [rect(200, 200)], 6, "resize");
    expect(result.y).toBe(203);
  });
});
