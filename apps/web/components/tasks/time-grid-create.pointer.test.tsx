// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { TimeGridView, weekDaysOf } from "./task-month-view";

const day = new Date(2026, 9, 19);
const at = (minutes: number) => new Date(2026, 9, 19, 0, minutes);
const task: TaskWithTags = {
  id: "task", user_id: "u", title: "已有任务", description: null, status: "todo",
  priority: "medium", category: "work", due_date: at(540).toISOString(),
  schedule_start_at: at(540).toISOString(), schedule_end_at: at(600).toISOString(),
  estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null,
  is_pinned: false, sort_order: 0, completed_at: null, created_at: day.toISOString(), updated_at: day.toISOString(),
};

describe("时间网格空白拖选创建", () => {
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

  function render(days = [day], tasks: TaskWithTags[] = [], canMove = true) {
    act(() => root.render(createElement(TimeGridView, {
      days, tasks, countdowns: [], onDateClick, onTaskClick,
      onUpdateTaskSchedule: canMove ? onUpdateTaskSchedule : undefined,
    })));
    const columns = Array.from(container.querySelectorAll<HTMLDivElement>("[data-time-grid-day]"));
    for (const column of columns) {
      vi.spyOn(column, "getBoundingClientRect").mockReturnValue(new DOMRect(48, -200, 100, 1344));
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
  function pointer(element: HTMLElement, type: string, minutes: number, pointerId = 1, x = 60, button = 0) {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: -200 + minutes / 60 * 56, button });
      Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
      element.dispatchEvent(event);
    });
  }
  function click(element: HTMLElement, minutes = 540) {
    act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientY: -200 + minutes / 60 * 56 })));
  }

  it.each([1, 7])("%i 列：正向拖选显示标签、保持起始列、只创建一次", (count) => {
    const [column] = render(count === 1 ? [day] : weekDaysOf(day));
    pointer(column, "pointerdown", 540);
    pointer(column, "pointermove", 630, 1, 500);
    expect(column.setPointerCapture).toHaveBeenCalledWith(1);
    expect(column.querySelector('[role="status"]')?.textContent).toBe("09:00 – 10:30");
    pointer(column, "pointerup", 630, 1, 500);
    click(column, 630);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(540), at(630));
    expect(column.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it("反向拖选使用松手的最终坐标", () => {
    const [column] = render();
    pointer(column, "pointerdown", 630);
    pointer(column, "pointermove", 600);
    pointer(column, "pointerup", 540);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(540), at(630));
  });
  it("轻点保留原 30 分钟槽位，午夜起点也传 end", () => {
    const [column] = render();
    pointer(column, "pointerdown", 0);
    pointer(column, "pointermove", 2);
    pointer(column, "pointerup", 2);
    expect(onDateClick).not.toHaveBeenCalled();
    click(column, 2);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(0), at(60));
  });
  it.each(["Escape", "pointercancel", "lostpointercapture"])("%s 取消并拦住后续 click，下一次点击仍有效", (type) => {
    const [column] = render();
    pointer(column, "pointerdown", 540);
    pointer(column, "pointermove", 630);
    if (type === "Escape") act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    else pointer(column, type, 630);
    pointer(column, "pointerup", 630);
    click(column, 630);
    expect(onDateClick).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
    pointer(column, "pointerdown", 540);
    pointer(column, "pointerup", 540);
    click(column);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(540), at(600));
  });
  it("非主键不 capture，其它 pointer 不更新或结束当前范围", () => {
    const [column] = render();
    pointer(column, "pointerdown", 540, 1, 60, 2);
    expect(column.setPointerCapture).not.toHaveBeenCalled();
    pointer(column, "pointerdown", 540);
    pointer(column, "pointermove", 630, 2);
    pointer(column, "pointerup", 630, 2);
    expect(onDateClick).not.toHaveBeenCalled();
    pointer(column, "pointerup", 600);
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(at(540), at(600));
  });
  it.each([true, false])("任务按钮/子元素不触发空白创建（改期回调=%s）", (canMove) => {
    const [column] = render([day], [task], canMove);
    const button = column.querySelector("button")!;
    pointer(button.querySelector("span")!, "pointerdown", 540);
    pointer(button, "pointerup", 540);
    click(button);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(task);
    expect(onDateClick).not.toHaveBeenCalled();
    expect(column.setPointerCapture).not.toHaveBeenCalled();
  });
  it("已有任务仍可拖动改期，不创建或打开详情", () => {
    const [column] = render([day], [task]);
    const button = column.querySelector("button")!;
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(48, -200 + 9 * 56, 100, 56));
    const grid = column.closest(".overflow-y-auto") as HTMLDivElement;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -200, 148, 1500));
    Object.defineProperty(grid, "clientWidth", { value: 148 });
    grid.scrollTop = 0;
    pointer(button, "pointerdown", 540);
    pointer(button, "pointermove", 630);
    pointer(button, "pointerup", 630);
    click(button);
    expect(onUpdateTaskSchedule).toHaveBeenCalledWith("task", expect.objectContaining({
      schedule_start_at: at(630).toISOString(), schedule_end_at: at(690).toISOString(),
    }));
    expect(onDateClick).not.toHaveBeenCalled();
    expect(onTaskClick).not.toHaveBeenCalled();
  });
});
