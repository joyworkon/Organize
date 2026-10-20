import { describe, expect, it } from "vitest";
import { nudgeRange, resizeRangeFromPointer } from "./time-grid-resize";

describe("resizeRangeFromPointer", () => {
  it("下沿按 15 分钟吸附延长/缩短，开始不变", () => {
    expect(resizeRangeFromPointer({ edge: "end", startMin: 540, endMin: 600, pointerMin: 630 }))
      .toEqual({ startMin: 540, endMin: 630 });
    expect(resizeRangeFromPointer({ edge: "end", startMin: 540, endMin: 600, pointerMin: 638 }))
      .toEqual({ startMin: 540, endMin: 645 });
    expect(resizeRangeFromPointer({ edge: "end", startMin: 540, endMin: 600, pointerMin: 570 }))
      .toEqual({ startMin: 540, endMin: 570 });
  });

  it("上沿按 15 分钟吸附提前/推后，结束不变", () => {
    expect(resizeRangeFromPointer({ edge: "start", startMin: 540, endMin: 600, pointerMin: 510 }))
      .toEqual({ startMin: 510, endMin: 600 });
    expect(resizeRangeFromPointer({ edge: "start", startMin: 540, endMin: 600, pointerMin: 562 }))
      .toEqual({ startMin: 555, endMin: 600 });
  });

  it("拖过对边时夹在最短 15 分钟，不翻转", () => {
    expect(resizeRangeFromPointer({ edge: "end", startMin: 540, endMin: 600, pointerMin: 500 }))
      .toEqual({ startMin: 540, endMin: 555 });
    expect(resizeRangeFromPointer({ edge: "start", startMin: 540, endMin: 600, pointerMin: 700 }))
      .toEqual({ startMin: 585, endMin: 600 });
  });

  it("夹在当天 0..1440，不允许负值或越过午夜", () => {
    expect(resizeRangeFromPointer({ edge: "start", startMin: 60, endMin: 120, pointerMin: -30 }))
      .toEqual({ startMin: 0, endMin: 120 });
    expect(resizeRangeFromPointer({ edge: "end", startMin: 1380, endMin: 1410, pointerMin: 1500 }))
      .toEqual({ startMin: 1380, endMin: 1440 });
    expect(resizeRangeFromPointer({ edge: "start", startMin: 1410, endMin: 1440, pointerMin: 1500 }))
      .toEqual({ startMin: 1425, endMin: 1440 });
  });

  it("未吸附的指针位置按最近 15 分钟取整", () => {
    expect(resizeRangeFromPointer({ edge: "end", startMin: 540, endMin: 600, pointerMin: 653 }))
      .toEqual({ startMin: 540, endMin: 660 });
    expect(resizeRangeFromPointer({ edge: "end", startMin: 540, endMin: 600, pointerMin: 668 }))
      .toEqual({ startMin: 540, endMin: 675 });
  });
});

describe("nudgeRange", () => {
  it("move 保持时长整体平移", () => {
    expect(nudgeRange({ startMin: 540, endMin: 600, deltaMin: 30, mode: "move" }))
      .toEqual({ startMin: 570, endMin: 630 });
    expect(nudgeRange({ startMin: 540, endMin: 600, deltaMin: -30, mode: "move" }))
      .toEqual({ startMin: 510, endMin: 570 });
  });

  it("move 夹在当天：顶部不再前移、底部整体贴到 24:00", () => {
    expect(nudgeRange({ startMin: 15, endMin: 75, deltaMin: -30, mode: "move" }))
      .toEqual({ startMin: 0, endMin: 60 });
    expect(nudgeRange({ startMin: 1380, endMin: 1410, deltaMin: 60, mode: "move" }))
      .toEqual({ startMin: 1410, endMin: 1440 });
  });

  it("resize-end 只改结束时间", () => {
    expect(nudgeRange({ startMin: 540, endMin: 600, deltaMin: 15, mode: "resize-end" }))
      .toEqual({ startMin: 540, endMin: 615 });
    expect(nudgeRange({ startMin: 540, endMin: 600, deltaMin: -15, mode: "resize-end" }))
      .toEqual({ startMin: 540, endMin: 585 });
  });

  it("resize-end 最短 15 分钟且不越过午夜", () => {
    expect(nudgeRange({ startMin: 540, endMin: 555, deltaMin: -15, mode: "resize-end" }))
      .toEqual({ startMin: 540, endMin: 555 });
    expect(nudgeRange({ startMin: 1380, endMin: 1440, deltaMin: 15, mode: "resize-end" }))
      .toEqual({ startMin: 1380, endMin: 1440 });
  });
});
