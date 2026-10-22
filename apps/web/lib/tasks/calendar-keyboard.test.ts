// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { dateForDayView, isMonthGridCellEventTarget, matchCalendarNavKey, type CalendarNavKeyEvent } from "./calendar-keyboard";

function key(partial: Partial<CalendarNavKeyEvent> & Pick<CalendarNavKeyEvent, "key">): CalendarNavKeyEvent {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...partial };
}

describe("matchCalendarNavKey", () => {
  it("方向键翻页，字母切今天与视图，大小写不敏感", () => {
    expect(matchCalendarNavKey(key({ key: "ArrowLeft" }))).toBe("prev");
    expect(matchCalendarNavKey(key({ key: "ArrowRight" }))).toBe("next");
    expect(matchCalendarNavKey(key({ key: "t" }))).toBe("today");
    expect(matchCalendarNavKey(key({ key: "T", shiftKey: true }))).toBe("today");
    expect(matchCalendarNavKey(key({ key: "d" }))).toBe("day");
    expect(matchCalendarNavKey(key({ key: "D" }))).toBe("day");
    expect(matchCalendarNavKey(key({ key: "w" }))).toBe("week");
    expect(matchCalendarNavKey(key({ key: "W" }))).toBe("week");
    expect(matchCalendarNavKey(key({ key: "m" }))).toBe("month");
    expect(matchCalendarNavKey(key({ key: "M" }))).toBe("month");
    expect(matchCalendarNavKey(key({ key: "y" }))).toBe("year");
    expect(matchCalendarNavKey(key({ key: "Y" }))).toBe("year");
    expect(matchCalendarNavKey(key({ key: "a" }))).toBe("agenda");
    expect(matchCalendarNavKey(key({ key: "A", shiftKey: true }))).toBe("agenda");
  });

  it("⌘ / Ctrl / Alt 以及 Shift+方向键不触发", () => {
    for (const mod of ["metaKey", "ctrlKey", "altKey"] as const) {
      expect(matchCalendarNavKey(key({ key: "ArrowLeft", [mod]: true }))).toBeNull();
      expect(matchCalendarNavKey(key({ key: "t", [mod]: true }))).toBeNull();
      expect(matchCalendarNavKey(key({ key: "d", [mod]: true }))).toBeNull();
    }
    expect(matchCalendarNavKey(key({ key: "ArrowLeft", shiftKey: true }))).toBeNull();
    expect(matchCalendarNavKey(key({ key: "ArrowRight", shiftKey: true }))).toBeNull();
  });

  it("其他键与小写方向键名不匹配", () => {
    for (const name of ["n", "?", "Escape", "ArrowUp", "ArrowDown", "arrowleft", "Enter", ""]) {
      expect(matchCalendarNavKey(key({ key: name }))).toBeNull();
    }
  });
});

describe("isMonthGridCellEventTarget", () => {
  it("月网格格子及其内部控件算格内，任务条和别的网格不算", () => {
    const grid = document.createElement("div");
    grid.setAttribute("role", "grid");
    grid.setAttribute("data-calendar-surface", "month");
    const cell = document.createElement("div");
    cell.setAttribute("role", "gridcell");
    const inner = document.createElement("button");
    cell.append(inner);
    const taskBar = document.createElement("button");
    grid.append(cell, taskBar);
    const other = document.createElement("div");
    other.setAttribute("role", "grid");
    const otherCell = document.createElement("div");
    otherCell.setAttribute("role", "gridcell");
    other.append(otherCell);
    document.body.append(grid, other);

    inner.textContent = "19";
    expect(isMonthGridCellEventTarget(cell)).toBe(true);
    expect(isMonthGridCellEventTarget(inner)).toBe(true);
    expect(isMonthGridCellEventTarget(inner.firstChild)).toBe(true);
    expect(isMonthGridCellEventTarget(taskBar)).toBe(false);
    expect(isMonthGridCellEventTarget(otherCell)).toBe(false);
    expect(isMonthGridCellEventTarget(null)).toBe(false);
    expect(isMonthGridCellEventTarget(document)).toBe(false);
    expect(isMonthGridCellEventTarget(document.createTextNode("19"))).toBe(false);

    grid.remove();
    other.remove();
  });
});

describe("dateForDayView", () => {
  it("月/年视图把日号夹进 cursor 所在月", () => {
    const selected = new Date(2026, 9, 31);
    expect(dateForDayView("month", new Date(2026, 10, 1), selected)).toEqual(new Date(2026, 10, 30));
    expect(dateForDayView("year", new Date(2026, 2, 1), selected)).toEqual(new Date(2026, 2, 31));
    expect(dateForDayView("year", new Date(2026, 1, 1), selected)).toEqual(new Date(2026, 1, 28));
    expect(dateForDayView("month", new Date(2024, 1, 1), selected)).toEqual(new Date(2024, 1, 29));
    expect(selected).toEqual(new Date(2026, 9, 31));
  });

  it("日/周/日程视图沿用 selectedDate，不跟 cursor 改月", () => {
    const selected = new Date(2026, 9, 19);
    const cursor = new Date(2026, 8, 28);
    expect(dateForDayView("day", cursor, selected)).toEqual(new Date(2026, 9, 19));
    expect(dateForDayView("week", cursor, selected)).toEqual(new Date(2026, 9, 19));
    expect(dateForDayView("agenda", new Date(2026, 9, 19), selected)).toEqual(new Date(2026, 9, 19));
    expect(cursor).toEqual(new Date(2026, 8, 28));
  });
});
