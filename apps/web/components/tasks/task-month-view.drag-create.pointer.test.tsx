// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { DEFAULT_CALENDAR_VIEW_OPTIONS } from "@/lib/tasks/calendar-view-options";
import { TaskMonthView } from "./task-month-view";

// 只补 jsdom 缺少的布局和 pointer capture；行 120px 高、列 100px 宽（隐藏周末时 140px）。
describe("桌面月格空白拖选新建跨天全天", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDateClick = vi.fn();
  const onTaskClick = vi.fn();
  const onReschedule = vi.fn<(id: string, date: Date) => Promise<void>>();
  const start = new Date(2026, 9, 13, 9, 45);
  const day = (date: number) => new Date(2026, 9, date);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onDateClick.mockReset();
    onTaskClick.mockReset();
    onReschedule.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(showWeekends = true) {
    const task: TaskWithTags = {
      id: "task", user_id: "u1", title: "月历测试任务", description: null, status: "todo",
      priority: "medium", category: "work", due_date: start.toISOString(),
      estimated_minutes: null, actual_minutes: null, reading_item_id: null,
      note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
      created_at: start.toISOString(), updated_at: start.toISOString(),
      schedule_start_at: start.toISOString(),
    };
    act(() => root.render(createElement(TaskMonthView, {
      tasks: [task], onRescheduleTask: onReschedule, onTaskClick, onDateClick,
      viewOptions: { ...DEFAULT_CALENDAR_VIEW_OPTIONS, showWeekends },
    })));
    const cols = showWeekends ? 7 : 5;
    const colWidth = 700 / cols;
    const rows = Array.from(container.querySelectorAll<HTMLDivElement>(`[data-calendar-surface="month"] [role="row"]`));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    vi.spyOn(rows[0].parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 700, rows.length * 120));
    for (const [rowIndex, row] of rows.entries()) {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100 + rowIndex * 120, 700, 120));
      for (const [col, cell] of Array.from(row.querySelectorAll<HTMLDivElement>('[role="gridcell"]')).entries()) {
        vi.spyOn(cell, "getBoundingClientRect").mockReturnValue(new DOMRect(100 + col * colWidth, 100 + rowIndex * 120, colWidth, 120));
      }
      for (const element of row.querySelectorAll<HTMLElement>('[role="gridcell"], button')) {
        let captured = false;
        Object.defineProperties(element, {
          setPointerCapture: { value: vi.fn(() => { captured = true; }), configurable: true },
          hasPointerCapture: { value: () => captured, configurable: true },
          releasePointerCapture: { value: vi.fn(() => { captured = false; }), configurable: true },
        });
      }
    }
    return rows;
  }
  const cell = (label: string) => container.querySelector<HTMLDivElement>(`[role="gridcell"][aria-label="${label}"]`)!;
  const highlighted = () => Array.from(container.querySelectorAll('[data-calendar-drag-create="month"]')).map((node) => node.getAttribute("aria-label"));
  const bars = () => Array.from(container.querySelectorAll<HTMLElement>('[data-calendar-drag-create-bar="month"]'));

  function pointer(element: HTMLElement, type: string, x: number, y: number, pointerId = 1, button = 0) {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
      Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
      element.dispatchEvent(event);
    });
  }
  function click(element: HTMLElement, detail = 1) {
    act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
  }

  it("横向拖过三格：区间高亮 + 文案条，松手打开跨天全天创建卡，兼容 click 被吞", () => {
    render();
    const origin = cell("10月20日");
    pointer(origin, "pointerdown", 250, 470);
    expect(origin.setPointerCapture).toHaveBeenCalledWith(1);
    expect(highlighted()).toEqual([]);
    pointer(origin, "pointermove", 450, 470);
    expect(highlighted()).toEqual(["10月20日", "10月21日", "10月22日"]);
    expect(bars()).toHaveLength(1);
    expect(bars()[0].textContent).toBe("10月20日 – 10月22日 全天");
    expect(bars()[0].getAttribute("role")).toBe("status");
    expect(bars()[0].style.left).toMatch(/^calc\(14\.28\d*% \+ 2px\)$/);
    expect(bars()[0].style.width).toMatch(/^calc\(42\.85\d*% - 4px\)$/);
    pointer(origin, "pointerup", 450, 470);
    click(origin);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(day(20), day(22), {
      focusTarget: origin, rect: { x: 200, y: 460, width: 300, height: 120 },
    }, true);
    expect(origin.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(highlighted()).toEqual([]);
    expect(bars()).toHaveLength(0);
    expect(origin.tabIndex).toBe(0);
  });

  it("反向且跨周行拖选归一为升序区间，每行一段只有首段播报，锚点取首尾格包围盒", () => {
    render();
    const origin = cell("10月22日");
    pointer(origin, "pointerdown", 450, 470);
    pointer(origin, "pointermove", 450, 350); // 上一周行同列：10/15
    expect(highlighted()).toEqual(["10月15日", "10月16日", "10月17日", "10月18日", "10月19日", "10月20日", "10月21日", "10月22日"]);
    const segments = bars();
    expect(segments).toHaveLength(2);
    expect(segments.map((bar) => bar.getAttribute("role"))).toEqual(["status", null]);
    expect(segments[1].getAttribute("aria-hidden")).toBe("true");
    expect(segments[0].style.left).toMatch(/^calc\(42\.85\d*% \+ 2px\)$/);
    expect(segments[1].style.width).toMatch(/^calc\(57\.14\d*% - 4px\)$/);
    pointer(origin, "pointerup", 450, 350);
    click(origin);
    // 锚点是首尾两格（同为周四列）的包围盒，纵向跨两行。
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(day(15), day(22), {
      focusTarget: cell("10月15日"), rect: { x: 400, y: 340, width: 100, height: 240 },
    }, true);
    expect(cell("10月15日").tabIndex).toBe(0);
  });

  it("拖出网格下缘夹到末行、左缘夹到首列", () => {
    const rows = render();
    const origin = cell("10月20日");
    const lastRowFirst = rows[rows.length - 1].querySelector<HTMLDivElement>('[role="gridcell"]')!;
    pointer(origin, "pointerdown", 250, 470);
    pointer(origin, "pointermove", -50, 5000);
    expect(highlighted()[highlighted().length - 1]).toBe(lastRowFirst.getAttribute("aria-label"));
    pointer(origin, "pointerup", -50, 5000);
    const end = onDateClick.mock.calls[0][1] as Date;
    expect(`${end.getMonth() + 1}月${end.getDate()}日`).toBe(lastRowFirst.getAttribute("aria-label"));
    expect(onDateClick.mock.calls[0][0]).toEqual(day(20));
    expect(onDateClick.mock.calls[0][3]).toBe(true);
  });

  it("轻点未超阈值仍走 click 建单日全天（保持原三参调用）", () => {
    render();
    const origin = cell("10月20日");
    pointer(origin, "pointerdown", 250, 470);
    pointer(origin, "pointermove", 252, 472);
    expect(highlighted()).toEqual([]);
    pointer(origin, "pointerup", 252, 472);
    expect(onDateClick).not.toHaveBeenCalled();
    click(origin);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(day(20), undefined, expect.objectContaining({ focusTarget: origin }));
    expect(onDateClick.mock.calls[0]).toHaveLength(3);
  });

  it("同格内拖动超过阈值后松手，仍得单日全天但带显式 allDay", () => {
    render();
    const origin = cell("10月20日");
    pointer(origin, "pointerdown", 250, 470);
    pointer(origin, "pointermove", 280, 480);
    expect(highlighted()).toEqual(["10月20日"]);
    expect(bars()[0].textContent).toBe("10月20日 全天");
    pointer(origin, "pointerup", 280, 480);
    click(origin);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(day(20), undefined, expect.objectContaining({ focusTarget: origin }), true);
  });

  it.each(["Escape", "pointercancel", "lostpointercapture"])("%s 取消选区并吞掉随后的 click；下一次轻点仍有效", (type) => {
    render();
    const origin = cell("10月20日");
    pointer(origin, "pointerdown", 250, 470);
    pointer(origin, "pointermove", 450, 470);
    expect(highlighted()).toHaveLength(3);
    if (type === "Escape") act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    else pointer(origin, type, 450, 470);
    expect(highlighted()).toEqual([]);
    expect(origin.releasePointerCapture).toHaveBeenCalledWith(1);
    pointer(origin, "pointerup", 450, 470);
    click(origin);
    expect(onDateClick).not.toHaveBeenCalled();
    pointer(origin, "pointerdown", 250, 470);
    pointer(origin, "pointerup", 250, 470);
    click(origin);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(day(20), undefined, expect.objectContaining({ focusTarget: origin }));
  });

  it("起点在日期数字 / 任务条 / 非主键上不进入拖选；任务条仍改期不新建", async () => {
    render();
    const origin = cell("10月20日");
    const dateButton = origin.querySelector<HTMLButtonElement>("button")!;
    pointer(dateButton, "pointerdown", 250, 470);
    pointer(dateButton, "pointermove", 450, 470);
    pointer(dateButton, "pointerup", 450, 470);
    expect(origin.setPointerCapture).not.toHaveBeenCalled();
    expect(highlighted()).toEqual([]);
    pointer(origin, "pointerdown", 250, 470, 2, 2);
    expect(origin.setPointerCapture).not.toHaveBeenCalled();
    pointer(origin, "pointerup", 250, 470, 2, 2);

    const taskCell = cell("10月13日");
    const bar = container.querySelector<HTMLButtonElement>('[data-calendar-surface="month"] [data-calendar-task-id="task"]')!;
    pointer(bar, "pointerdown", 250, 350);
    pointer(bar, "pointermove", 450, 470);
    expect(taskCell.setPointerCapture).not.toHaveBeenCalled();
    expect(highlighted()).toEqual([]);
    await act(async () => pointer(bar, "pointerup", 450, 470));
    click(bar);
    expect(onReschedule).toHaveBeenCalledExactlyOnceWith("task", new Date(2026, 9, 22, 9, 45));
    expect(onDateClick).not.toHaveBeenCalled();
  });

  it("隐藏周末时按 5 列命中并跳过周末", () => {
    render(false);
    const origin = cell("10月20日");
    pointer(origin, "pointerdown", 310, 470);
    pointer(origin, "pointermove", 730, 470);
    expect(highlighted()).toEqual(["10月20日", "10月21日", "10月22日", "10月23日"]);
    expect(bars()[0].style.width).toBe("calc(80% - 4px)");
    pointer(origin, "pointerup", 730, 470);
    click(origin);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(day(20), day(23), expect.objectContaining({ focusTarget: origin }), true);
  });

  it("未提供 onDateClick 时格子不绑定拖选", () => {
    act(() => root.render(createElement(TaskMonthView, { tasks: [] })));
    const origin = cell("10月20日");
    expect(origin.className).not.toContain("select-none");
    pointer(origin, "pointerdown", 250, 470);
    pointer(origin, "pointermove", 450, 470);
    expect(highlighted()).toEqual([]);
  });
});
