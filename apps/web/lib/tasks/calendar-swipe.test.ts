import { describe, expect, it } from "vitest";
import {
  SWIPE_AXIS_LOCK_PX,
  SWIPE_STEP_PX,
  acceptSwipePointer,
  advanceSwipe,
  beginSwipe,
  classifySwipeAxis,
  swipeStepDirection,
} from "./calendar-swipe";

describe("acceptSwipePointer", () => {
  it("只接受触控 / 触笔的主指针左键", () => {
    expect(acceptSwipePointer({ pointerType: "touch", isPrimary: true, button: 0 })).toBe(true);
    expect(acceptSwipePointer({ pointerType: "pen", isPrimary: true, button: 0 })).toBe(true);
    expect(acceptSwipePointer({ pointerType: "mouse", isPrimary: true, button: 0 })).toBe(false);
    expect(acceptSwipePointer({ pointerType: "touch", isPrimary: false, button: 0 })).toBe(false);
    expect(acceptSwipePointer({ pointerType: "touch", isPrimary: true, button: 2 })).toBe(false);
  });

  it("缺少 pointerType / isPrimary / button 时按触控主指针处理（jsdom 合成事件）", () => {
    expect(acceptSwipePointer({})).toBe(true);
  });
});

describe("classifySwipeAxis", () => {
  it("位移不足锁定距离时 pending，之后按主导方向锁定，相等归纵向", () => {
    expect(classifySwipeAxis(SWIPE_AXIS_LOCK_PX - 1, 0)).toBe("pending");
    expect(classifySwipeAxis(0, -(SWIPE_AXIS_LOCK_PX - 1))).toBe("pending");
    expect(classifySwipeAxis(20, 5)).toBe("horizontal");
    expect(classifySwipeAxis(-20, 5)).toBe("horizontal");
    expect(classifySwipeAxis(5, 20)).toBe("vertical");
    expect(classifySwipeAxis(15, 15)).toBe("vertical");
  });
});

describe("swipeStepDirection", () => {
  it("左滑下一页、右滑上一页；水平不足 60px 或不足垂直两倍时不翻页", () => {
    expect(swipeStepDirection(-SWIPE_STEP_PX, 10)).toBe(1);
    expect(swipeStepDirection(SWIPE_STEP_PX, -10)).toBe(-1);
    expect(swipeStepDirection(-(SWIPE_STEP_PX - 1), 0)).toBeNull();
    expect(swipeStepDirection(70, 36)).toBeNull();
    expect(swipeStepDirection(70, 35)).toBe(-1);
    expect(swipeStepDirection(0, 0)).toBeNull();
  });
});

describe("advanceSwipe 状态机", () => {
  it("横向手势达阈值触发一次，继续滑动不重复触发", () => {
    let state = beginSwipe(1, 200, 100);
    let result = advanceSwipe(state, 205, 102);
    expect(result).toMatchObject({ step: null, gesture: { axis: "pending", fired: false } });
    state = result.gesture;
    result = advanceSwipe(state, 170, 103);
    expect(result).toMatchObject({ step: null, gesture: { axis: "horizontal", fired: false } });
    state = result.gesture;
    result = advanceSwipe(state, 135, 105);
    expect(result).toMatchObject({ step: 1, gesture: { axis: "horizontal", fired: true } });
    state = result.gesture;
    result = advanceSwipe(state, 60, 105);
    expect(result.step).toBeNull();
    expect(result.gesture.fired).toBe(true);
  });

  it("先走出纵向的手势被锁定为纵向，之后再横向也不翻页", () => {
    let state = beginSwipe(1, 200, 100);
    let result = advanceSwipe(state, 203, 130);
    expect(result.gesture.axis).toBe("vertical");
    state = result.gesture;
    result = advanceSwipe(state, 100, 130);
    expect(result.step).toBeNull();
    expect(result.gesture.axis).toBe("vertical");
  });

  it("右滑返回上一页", () => {
    const result = advanceSwipe(beginSwipe(1, 100, 100), 180, 110);
    expect(result.step).toBe(-1);
  });

  it("不修改传入的手势对象", () => {
    const state = beginSwipe(1, 100, 100);
    advanceSwipe(state, 20, 100);
    expect(state).toEqual({ pointerId: 1, startX: 100, startY: 100, axis: "pending", fired: false });
  });
});
