// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { TaskMonthView, TimeGridView, weekDaysOf } from "./task-month-view";

const at = (day: number, hour = 9) => new Date(2026, 9, day, hour);
const source: TaskWithTags = {
  id: "source", user_id: "u", title: "每周例会", description: null, status: "todo", priority: "medium", category: "work",
  due_date: null, estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null,
  is_pinned: false, sort_order: 0, completed_at: null, created_at: at(13).toISOString(), updated_at: at(13).toISOString(),
  schedule_start_at: at(13).toISOString(), schedule_end_at: at(13, 11).toISOString(),
  all_day: false, recurrence_rule: { frequency: "weekly", interval: 1 },
};

describe("日历重复任务只读发生", () => {
  let container: HTMLDivElement, root: Root;
  const onTaskClick = vi.fn(), onRescheduleTask = vi.fn(), onUpdateTaskSchedule = vi.fn(), onDateClick = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(19, 12));
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  function pointer(node: HTMLElement, type: string, x: number, y: number) {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
      node.dispatchEvent(event);
    });
  }
  function click(node: HTMLElement) {
    act(() => node.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  }
  function projected(parent: ParentNode = container) {
    const button = parent.querySelector<HTMLButtonElement>('button[data-recurring-projection="true"]');
    expect(button).not.toBeNull();
    return button!;
  }
  function renderMonth(tasks = [source]) {
    act(() => root.render(createElement(TaskMonthView, { tasks, onTaskClick, onRescheduleTask, onUpdateTaskSchedule, onDateClick })));
    return container.querySelector('[data-calendar-surface="month"]')!;
  }
  it("下一周出现预计发生，真实和虚拟都有重复图标，点击打开原任务", () => {
    const grid = renderMonth();
    const projection = projected(grid);
    expect(projection.getAttribute("aria-label")).toContain("重复 · 预计 10月20日");
    expect(projection.querySelector("[data-recurring-icon]")).not.toBeNull();
    expect(grid.querySelector('button.absolute:not([data-recurring-projection]) [data-recurring-icon]')).not.toBeNull();
    expect(projection.className).toContain("border-dashed");
    expect(projection.className).not.toContain("cursor-grab");
    expect(projection.style.touchAction).toBe("auto");
    expect(projection.querySelector(".border-current\\/40")).toBeNull();
    click(projection);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(source);
  });
  it("月格投影按下移动不 capture、不改期、不创建", () => {
    const projection = projected(renderMonth());
    const capture = vi.fn();
    Object.defineProperty(projection, "setPointerCapture", { value: capture });
    pointer(projection, "pointerdown", 200, 400);
    pointer(projection, "pointermove", 500, 520);
    pointer(projection, "pointerup", 500, 520);
    expect(capture).not.toHaveBeenCalled();
    expect(onRescheduleTask).not.toHaveBeenCalled();
    expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    expect(onDateClick).not.toHaveBeenCalled();
    click(projection);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(source);
  });
  it.each([1, 7])("%i 列保留时段和时长、参与 lane，禁止拖拽/resize/键盘改期", (count) => {
    const overlap = { ...source, id: "other", recurrence_rule: null, schedule_start_at: at(20, 10).toISOString(), schedule_end_at: at(20, 12).toISOString() };
    act(() => root.render(createElement(TimeGridView, {
      days: count === 1 ? [at(20, 0)] : weekDaysOf(at(20)), tasks: [source, overlap], countdowns: [],
      onTaskClick, onUpdateTaskSchedule, onDateClick,
    })));
    const projection = projected();
    expect(projection.textContent).toContain("09:00");
    expect(projection.style.height).toBe("110px");
    expect(projection.style.width).toContain("50%");
    expect(projection.style.touchAction).toBe("auto");
    expect(projection.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(projection.querySelector("[data-resize-edge]")).toBeNull();
    const capture = vi.fn();
    Object.defineProperty(projection, "setPointerCapture", { value: capture });
    pointer(projection, "pointerdown", 80, 300);
    pointer(projection, "pointermove", 250, 500);
    pointer(projection, "pointerup", 250, 500);
    act(() => projection.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, shiftKey: true, bubbles: true })));
    expect(capture).not.toHaveBeenCalled();
    expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    expect(onDateClick).not.toHaveBeenCalled();
    click(projection);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(source);
  });
  it("全天芯片可聚焦和打开源任务，不启动跨区转换", () => {
    const allDay = { ...source, all_day: true, schedule_end_at: null };
    act(() => root.render(createElement(TimeGridView, {
      days: weekDaysOf(at(20)), tasks: [allDay], countdowns: [], onTaskClick, onUpdateTaskSchedule, onDateClick,
    })));
    const projection = projected(container.querySelector('[data-countdown-surface="all-day"]')!);
    expect(projection.tabIndex).toBe(0);
    pointer(projection, "pointerdown", 80, 100);
    pointer(projection, "pointermove", 80, 500);
    pointer(projection, "pointerup", 80, 500);
    expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    click(projection);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(allDay);
  });
  it("手机议程的投影没有改期入口，仍打开源任务", () => {
    renderMonth();
    const projection = projected(container.querySelector(".overflow-y-auto.md\\:hidden")!);
    expect(projection.parentElement!.textContent).not.toContain("改期");
    click(projection);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(source);
  });
  it("翻到下个月仍展开来自上月的源任务，年视图不展开", () => {
    renderMonth();
    click(container.querySelector('button[aria-label="下一页"]')!);
    expect(projected(container.querySelector('[data-calendar-surface="month"]')!).getAttribute("aria-label")).toContain("预计");
    click(container.querySelector('button[title="年视图（y）"]')!);
    expect(container.querySelector("[data-recurring-projection]")).toBeNull();
  });
  it.each(["done", "cancelled", "nonrecurring"])("%s 不生成投影", (kind) => {
    renderMonth([{ ...source, ...(kind === "nonrecurring" ? { recurrence_rule: null } : { status: kind as "done" | "cancelled" }) }]);
    expect(container.querySelector("[data-recurring-projection]")).toBeNull();
  });
});
