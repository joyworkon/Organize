// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { TaskMonthView, TimeGridView, weekDaysOf } from "./task-month-view";

const day = new Date(2026, 9, 19);
const at = (minutes: number) => new Date(2026, 9, 19, 0, minutes);
const tasks: TaskWithTags[] = Array.from({ length: 4 }, (_, i) => ({
  id: `t${i}`, user_id: "u", title: `重叠会议${i}`, description: null, status: "todo",
  priority: "medium", category: "work", due_date: null,
  schedule_start_at: at(540).toISOString(), schedule_end_at: at(600).toISOString(),
  estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null,
  is_pinned: false, sort_order: i, completed_at: null, created_at: day.toISOString(), updated_at: day.toISOString(),
}));

if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

describe("时间网格 +N 弹层", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onTaskClick = vi.fn();
  const onDateClick = vi.fn();
  const onToggleTaskDone = vi.fn();
  const onTaskContextMenu = vi.fn();
  const onUpdateTaskSchedule = vi.fn().mockResolvedValue(undefined);
  const props = { tasks, countdowns: [], onTaskClick, onDateClick, onToggleTaskDone, onTaskContextMenu, onUpdateTaskSchedule };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(720));
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    HTMLElement.prototype.hasPointerCapture ??= () => false;
    HTMLElement.prototype.setPointerCapture ??= () => {};
    HTMLElement.prototype.releasePointerCapture ??= () => {};
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
    vi.useRealTimers();
  });
  const more = () => container.querySelector<HTMLButtonElement>("[data-timed-overlap-more]")!;
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  const click = (element: HTMLElement) => act(() => element.click());
  function pointer(element: HTMLElement, type = "pointerdown") {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 100, clientY: 200 });
      Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: "touch" } });
      element.dispatchEvent(event);
    });
  }

  it.each([1, 7])("%i 列：三块 +1，全部时间/标题/勾选可达，第4项打开 peek，不触发新建或网格拖拽", (count) => {
    act(() => root.render(createElement(TimeGridView, { ...props, days: count === 1 ? [day] : weekDaysOf(day) })));
    expect(container.querySelectorAll('[data-time-grid-day] [data-calendar-task-id]')).toHaveLength(3);
    expect(container.querySelector('[data-time-grid-day] [data-calendar-task-id="t3"]')).toBeNull();
    expect(more().textContent).toBe("+1");
    expect(more().getAttribute("aria-label")).toBe("查看 10月19日 09:00 – 10:00 重叠任务 全部 4 项");
    pointer(more());
    click(more());
    expect(dialog().textContent).toContain("09:00 – 10:00");
    expect(dialog().querySelectorAll('[data-calendar-task-id]')).toHaveLength(4);
    const fourth = dialog().querySelector<HTMLButtonElement>('[data-calendar-task-id="t3"]')!;
    expect(fourth.textContent).toContain("09:00");
    expect(fourth.querySelector('[data-resize-edge]')).toBeNull();
    pointer(fourth);
    act(() => fourth.querySelector<HTMLElement>('[role="checkbox"]')!.click());
    expect(onToggleTaskDone).toHaveBeenCalledExactlyOnceWith(tasks[3]);
    expect(dialog()).not.toBeNull();
    act(() => fourth.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(onTaskContextMenu).toHaveBeenCalledWith(tasks[3], expect.anything());
    click(fourth);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(tasks[3]);
    expect(onDateClick).not.toHaveBeenCalled();
    expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("createdId 换入可见块且保留高亮；清除后恢复，三条时没有 +N", () => {
    act(() => root.render(createElement(TimeGridView, { ...props, days: [day], createdId: "t3" })));
    expect(container.querySelector('[data-time-grid-day] [data-calendar-task-id="t3"]')?.getAttribute("data-calendar-created")).toBe("true");
    expect(container.querySelector('[data-time-grid-day] [data-calendar-task-id="t2"]')).toBeNull();
    act(() => root.render(createElement(TimeGridView, { ...props, days: [day] })));
    expect(container.querySelector('[data-time-grid-day] [data-calendar-task-id="t3"]')).toBeNull();
    act(() => root.render(createElement(TimeGridView, { ...props, tasks: tasks.slice(0, 3), days: [day] })));
    expect(more()).toBeNull();
  });

  it("Esc 关闭并归还 +N 焦点", () => {
    act(() => root.render(createElement(TimeGridView, { ...props, days: [day] })));
    click(more());
    act(() => dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    act(() => vi.advanceTimersByTime(1));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(more());
    expect(onDateClick).not.toHaveBeenCalled();
  });

  it("portal 行长按沿用日历菜单，抬指不打开详情；右键也能打开菜单", () => {
    act(() => root.render(createElement(TaskMonthView, props)));
    click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "日")!);
    click(more());
    const fourth = dialog().querySelector<HTMLButtonElement>('[data-calendar-task-id="t3"]')!;
    pointer(fourth);
    act(() => vi.advanceTimersByTime(500));
    expect(document.querySelector('[data-testid="calendar-task-menu"]')).not.toBeNull();
    pointer(fourth, "pointerup");
    click(fourth);
    expect(onTaskClick).not.toHaveBeenCalled();
    expect(onDateClick).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    act(() => vi.advanceTimersByTime(1));
    if (!dialog()) click(more());
    const reopened = dialog().querySelector<HTMLButtonElement>('[data-calendar-task-id="t3"]')!;
    act(() => reopened.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 200 })));
    expect(document.querySelector('[data-testid="calendar-task-menu"]')).not.toBeNull();
  });
});
