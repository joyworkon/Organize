// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CountdownDay, TaskWithTags } from "@organize/shared";
import { TimeGridView, weekDaysOf } from "./task-month-view";

const day = new Date(2026, 9, 19);
const at = (date: number, minutes = 0) => new Date(2026, 9, date, 0, minutes);
const allDayTask: TaskWithTags = {
  id: "task", user_id: "u", title: "已有全天任务", description: null, status: "todo",
  priority: "medium", category: "work", due_date: at(21).toISOString(), all_day: true,
  schedule_start_at: at(21).toISOString(), schedule_end_at: null,
  estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null,
  is_pinned: false, sort_order: 0, completed_at: null, created_at: day.toISOString(), updated_at: day.toISOString(),
};
const countdown: CountdownDay = {
  id: "cd", user_id: "u", title: "发布", target_date: "2026-10-20", repeat_annually: false,
  deleted_at: null, created_at: day.toISOString(), updated_at: day.toISOString(),
};

// 全天行：整行 700px 宽、每列 100px；列 rect 按下标铺开，供轻点 / 拖列锚点与命中使用。
describe("日 / 周全天行空白新建", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDateClick = vi.fn();
  const onTaskClick = vi.fn();
  const onUpdateTaskSchedule = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(days = weekDaysOf(day), tasks: TaskWithTags[] = [], countdowns: CountdownDay[] = []) {
    act(() => root.render(createElement(TimeGridView, { days, tasks, countdowns, onDateClick, onTaskClick, onUpdateTaskSchedule })));
    const columns = Array.from(container.querySelectorAll<HTMLDivElement>('[data-countdown-surface="all-day"] [data-countdown-date]'));
    expect(columns).toHaveLength(days.length);
    const width = 700 / days.length;
    vi.spyOn(columns[0].parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(48, 0, 700, 60));
    for (const [index, column] of columns.entries()) {
      vi.spyOn(column, "getBoundingClientRect").mockReturnValue(new DOMRect(48 + index * width, 0, width, 60));
    }
    for (const element of [...columns, ...container.querySelectorAll("button")]) {
      let captured = false;
      Object.defineProperties(element, {
        setPointerCapture: { value: vi.fn(() => { captured = true; }), configurable: true },
        hasPointerCapture: { value: () => captured, configurable: true },
        releasePointerCapture: { value: vi.fn(() => { captured = false; }), configurable: true },
      });
    }
    return columns;
  }
  function pointer(element: HTMLElement, type: string, x: number, pointerId = 1, button = 0, y = 30) {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
      Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
      element.dispatchEvent(event);
    });
  }
  function click(element: HTMLElement) {
    act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  }
  const highlighted = () => Array.from(container.querySelectorAll('[data-calendar-drag-create="all-day"]')).map((node) => node.getAttribute("data-countdown-date"));
  const bar = () => container.querySelector<HTMLElement>('[data-calendar-drag-create-bar="all-day"]');

  it("轻点空白列：不 capture 住选区，click 建当日单日全天并带显式 allDay", () => {
    const columns = render();
    pointer(columns[2], "pointerdown", 250);
    pointer(columns[2], "pointermove", 252);
    pointer(columns[2], "pointerup", 252);
    expect(highlighted()).toEqual([]);
    expect(onDateClick).not.toHaveBeenCalled();
    click(columns[2]);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(21), undefined, { focusTarget: columns[2], rect: { x: 248, y: 0, width: 100, height: 60 } }, true);
    expect(columns[2].releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("拖过相邻两列：列高亮 + 区间条占独立泳道 + 行高让位，松手打开跨天全天并吞掉 click", () => {
    const columns = render(weekDaysOf(day), [allDayTask]);
    expect(columns[0].style.minHeight).toBe("38px");
    pointer(columns[2], "pointerdown", 250);
    expect(columns[2].setPointerCapture).toHaveBeenCalledWith(1);
    pointer(columns[2], "pointermove", 450);
    expect(highlighted()).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(bar()?.textContent).toBe("10月21日 – 10月23日 全天");
    expect(bar()?.getAttribute("role")).toBe("status");
    expect(bar()?.style.top).toBe("32px");
    expect(bar()?.style.left).toMatch(/^calc\(28\.57\d*% \+ 2px\)$/);
    expect(bar()?.style.width).toMatch(/^calc\(42\.85\d*% - 4px\)$/);
    expect(columns[0].style.minHeight).toBe("60px");
    pointer(columns[2], "pointerup", 450);
    click(columns[2]);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(21), at(23), { focusTarget: columns[2], rect: { x: 248, y: 0, width: 300, height: 60 } }, true);
    expect(highlighted()).toEqual([]);
    expect(bar()).toBeNull();
    expect(columns[0].style.minHeight).toBe("38px");
  });

  it("反向拖列归一为升序，并夹在可见列范围内", () => {
    const columns = render();
    pointer(columns[4], "pointerdown", 450);
    pointer(columns[4], "pointermove", -500);
    expect(highlighted()).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    pointer(columns[4], "pointerup", -500);
    click(columns[4]);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(19), at(23), { focusTarget: columns[0], rect: { x: 48, y: 0, width: 500, height: 60 } }, true);
  });

  it("日视图单列拖动仍只得单日全天", () => {
    const [column] = render([day]);
    pointer(column, "pointerdown", 100);
    pointer(column, "pointermove", 600);
    expect(bar()?.textContent).toBe("10月19日 全天");
    pointer(column, "pointerup", 600);
    click(column);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(19), undefined, { focusTarget: column, rect: { x: 48, y: 0, width: 700, height: 60 } }, true);
  });

  it.each(["Escape", "pointercancel", "lostpointercapture"])("%s 取消拖列并拦住后续 click，下一次轻点仍有效", (type) => {
    const columns = render();
    pointer(columns[2], "pointerdown", 250);
    pointer(columns[2], "pointermove", 450);
    expect(highlighted()).toHaveLength(3);
    if (type === "Escape") act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    else pointer(columns[2], type, 450);
    expect(highlighted()).toEqual([]);
    pointer(columns[2], "pointerup", 450);
    click(columns[2]);
    expect(onDateClick).not.toHaveBeenCalled();
    pointer(columns[2], "pointerdown", 250);
    pointer(columns[2], "pointerup", 250);
    click(columns[2]);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(21), undefined, expect.objectContaining({ focusTarget: columns[2] }), true);
  });

  it("起点在倒数日 chip / 连续条 / 非主键上不进入拖列；连续条点击仍开任务", () => {
    const columns = render(weekDaysOf(day), [allDayTask], [countdown]);
    const chip = columns[1].querySelector<HTMLButtonElement>("button")!;
    pointer(chip, "pointerdown", 150);
    pointer(chip, "pointermove", 450);
    pointer(chip, "pointerup", 450);
    expect(columns[1].setPointerCapture).not.toHaveBeenCalled();
    expect(highlighted()).toEqual([]);
    pointer(columns[2], "pointerdown", 250, 2, 2);
    expect(columns[2].setPointerCapture).not.toHaveBeenCalled();
    pointer(columns[2], "pointerup", 250, 2, 2);
    const span = container.querySelector<HTMLButtonElement>('[data-countdown-surface="all-day"] [data-calendar-task-id="task"]')!;
    pointer(span, "pointerdown", 250);
    pointer(span, "pointerup", 250);
    click(span);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(allDayTask);
    expect(onDateClick).not.toHaveBeenCalled();
    expect(highlighted()).toEqual([]);
  });

  it("未提供 onDateClick 时全天列不响应", () => {
    act(() => root.render(createElement(TimeGridView, { days: weekDaysOf(day), tasks: [], countdowns: [] })));
    const column = container.querySelector<HTMLDivElement>('[data-countdown-surface="all-day"] [data-countdown-date]')!;
    expect(column.className).not.toContain("select-none");
    pointer(column, "pointerdown", 250);
    pointer(column, "pointermove", 450);
    click(column);
    expect(highlighted()).toEqual([]);
  });
});
