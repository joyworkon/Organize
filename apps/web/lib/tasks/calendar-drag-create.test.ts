import { describe, expect, it } from "vitest";
import {
  dragCreateDayRange,
  dragCreateRangeLabel,
  dragCreateRowIndex,
  dragCreateWeekColumns,
  isDayInDragCreateRange,
  unionRect,
} from "./calendar-drag-create";

const day = (date: number, hour = 0) => new Date(2026, 9, date, hour, 30);

describe("dragCreateDayRange", () => {
  it("去掉时刻并升序；反向拖选也归一", () => {
    expect(dragCreateDayRange(day(22, 15), day(24, 9))).toEqual({ start: new Date(2026, 9, 22), end: new Date(2026, 9, 24) });
    expect(dragCreateDayRange(day(24, 15), day(22, 9))).toEqual({ start: new Date(2026, 9, 22), end: new Date(2026, 9, 24) });
  });
  it("同日为单日区间", () => {
    const range = dragCreateDayRange(day(22, 15), day(22, 1));
    expect(range.start).toEqual(range.end);
    expect(isDayInDragCreateRange(day(22, 23), range)).toBe(true);
    expect(isDayInDragCreateRange(day(23), range)).toBe(false);
  });
  it("跨月跨年也按本地日期比较", () => {
    const range = dragCreateDayRange(new Date(2026, 11, 30), new Date(2027, 0, 2));
    expect(isDayInDragCreateRange(new Date(2026, 11, 31, 12), range)).toBe(true);
    expect(isDayInDragCreateRange(new Date(2027, 0, 3), range)).toBe(false);
  });
});

describe("dragCreateRangeLabel", () => {
  it("单日与跨日文案", () => {
    expect(dragCreateRangeLabel(dragCreateDayRange(day(22), day(22)))).toBe("10月22日 全天");
    expect(dragCreateRangeLabel(dragCreateDayRange(day(22), day(24)))).toBe("10月22日 – 10月24日 全天");
  });
  it("跨年补年份", () => {
    expect(dragCreateRangeLabel(dragCreateDayRange(new Date(2026, 11, 30), new Date(2027, 0, 2)))).toBe("12月30日 – 2027年1月2日 全天");
  });
});

describe("dragCreateRowIndex", () => {
  const rows = [{ top: 100, bottom: 220 }, { top: 220, bottom: 340 }, null, { top: 460, bottom: 580 }];
  it("命中行内 / 夹到首末行 / 缝隙归上一行", () => {
    expect(dragCreateRowIndex(rows, 150)).toBe(0);
    expect(dragCreateRowIndex(rows, 339)).toBe(1);
    expect(dragCreateRowIndex(rows, 10)).toBe(0);
    expect(dragCreateRowIndex(rows, 900)).toBe(3);
    expect(dragCreateRowIndex(rows, 400)).toBe(1);
  });
  it("没有可用行返回 -1", () => {
    expect(dragCreateRowIndex([null, undefined], 100)).toBe(-1);
    expect(dragCreateRowIndex([], 100)).toBe(-1);
  });
});

describe("dragCreateWeekColumns", () => {
  const week = (first: number, length = 7) => Array.from({ length }, (_, index) => new Date(2026, 9, first + index));
  it("完整落在周内 / 跨周截断 / 不相交", () => {
    const range = dragCreateDayRange(day(22), day(27));
    expect(dragCreateWeekColumns(week(19), range)).toEqual({ startCol: 3, endCol: 6 });
    expect(dragCreateWeekColumns(week(26), range)).toEqual({ startCol: 0, endCol: 1 });
    expect(dragCreateWeekColumns(week(12), range)).toBeNull();
  });
  it("隐藏周末的 5 列按可见日列号计算", () => {
    const weekdays = [19, 20, 21, 22, 23].map((date) => new Date(2026, 9, date));
    expect(dragCreateWeekColumns(weekdays, dragCreateDayRange(day(21), day(25)))).toEqual({ startCol: 2, endCol: 4 });
    expect(dragCreateWeekColumns(weekdays, dragCreateDayRange(day(24), day(25)))).toBeNull();
  });
});

describe("unionRect", () => {
  it("取两矩形包围盒", () => {
    expect(unionRect({ x: 10, y: 20, width: 30, height: 40 }, { x: 50, y: 10, width: 10, height: 20 })).toEqual({ x: 10, y: 10, width: 50, height: 50 });
    expect(unionRect({ x: 50, y: 10, width: 10, height: 20 }, { x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 10, y: 10, width: 50, height: 50 });
  });
});
