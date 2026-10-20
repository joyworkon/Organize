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

describe("时间网格拖边缘改时长 + Esc 取消 + 键盘微调", () => {
  let container: HTMLDivElement;
  let root: Root;
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

  function render(days = [day], tasks: TaskWithTags[] = [task]) {
    act(() => root.render(createElement(TimeGridView, {
      days, tasks, countdowns: [], onTaskClick, onUpdateTaskSchedule,
    })));
    const columns = Array.from(container.querySelectorAll<HTMLDivElement>("[data-time-grid-day]"));
    for (const column of columns) {
      vi.spyOn(column, "getBoundingClientRect").mockReturnValue(new DOMRect(48, -200, 100, 1344));
    }
    const grid = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -200, 148, 1500));
    for (const element of container.querySelectorAll("[data-time-grid-day], button, [data-resize-edge]")) {
      let captured = false;
      Object.defineProperties(element, {
        setPointerCapture: { value: vi.fn(() => { captured = true; }), configurable: true },
        hasPointerCapture: { value: () => captured, configurable: true },
        releasePointerCapture: { value: vi.fn(() => { captured = false; }), configurable: true },
      });
    }
    return { columns, button: container.querySelector("button")! };
  }
  function pointer(element: Element, type: string, minutes: number, pointerId = 1) {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, clientX: 60, clientY: -200 + minutes / 60 * 56, button: 0 });
      Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
      element.dispatchEvent(event);
    });
  }
  function click(element: HTMLElement) {
    act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  }
  function escape() {
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  }
  function key(element: HTMLElement, init: KeyboardEventInit) {
    act(() => element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })));
  }
  const handle = (edge: "start" | "end") => container.querySelector(`[data-resize-edge="${edge}"]`)!;

  it.each([1, 7])("%i 列：下沿往下拖 30 分钟只改结束时间，松手提交一次且随后 click 不打开详情", (count) => {
    const { button } = render(count === 1 ? [day] : weekDaysOf(day));
    expect(handle("end")).not.toBeNull();
    pointer(handle("end"), "pointerdown", 600);
    expect(button.className).toContain("opacity-30");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("09:00 – 10:00");
    pointer(handle("end"), "pointermove", 660);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("09:00 – 11:00");
    pointer(handle("end"), "pointerup", 660);
    expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
      schedule_start_at: at(540).toISOString(), schedule_end_at: at(660).toISOString(),
    }));
    expect(container.querySelector('[role="status"]')).toBeNull();
    click(button);
    expect(onTaskClick).not.toHaveBeenCalled();
    // 抑制是一次性的，下一次普通点击仍打开详情
    click(button);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("上沿往上拖 30 分钟只改开始时间", () => {
    const { } = render();
    pointer(handle("start"), "pointerdown", 540);
    pointer(handle("start"), "pointermove", 510);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("08:30 – 10:00");
    pointer(handle("start"), "pointerup", 510);
    expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
      schedule_start_at: at(510).toISOString(), schedule_end_at: at(600).toISOString(),
    }));
  });

  it("下沿拖过开始时间时夹在最短 15 分钟", () => {
    render();
    pointer(handle("end"), "pointerdown", 600);
    pointer(handle("end"), "pointermove", 500);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("09:00 – 09:15");
    pointer(handle("end"), "pointerup", 500);
    expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
      schedule_start_at: at(540).toISOString(), schedule_end_at: at(555).toISOString(),
    }));
  });

  it("resize 中按 Esc 取消：不提交、预览消失、随后 click 不打开详情", () => {
    const { button } = render();
    pointer(handle("end"), "pointerdown", 600);
    pointer(handle("end"), "pointermove", 660);
    escape();
    expect(container.querySelector('[role="status"]')).toBeNull();
    pointer(handle("end"), "pointerup", 660);
    click(button);
    expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    expect(onTaskClick).not.toHaveBeenCalled();
    click(button);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("热区轻点不改时间也不打开详情", () => {
    const { button } = render();
    pointer(handle("end"), "pointerdown", 600);
    pointer(handle("end"), "pointerup", 600);
    click(button);
    expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it("move 拖动中按 Esc 取消：不提交、幽灵消失、随后 click 不打开详情", () => {
    const { button } = render();
    pointer(button, "pointerdown", 540);
    pointer(button, "pointermove", 630);
    expect(container.querySelector(".-rotate-2")).not.toBeNull();
    escape();
    expect(container.querySelector(".-rotate-2")).toBeNull();
    expect(button.className).not.toContain("opacity-30");
    pointer(button, "pointerup", 630);
    click(button);
    expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    expect(onTaskClick).not.toHaveBeenCalled();
    click(button);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("聚焦任务块：⌥⇧↓ 延长 15 分钟，⌥↓ 后移 30 分钟", () => {
    const { button } = render();
    expect(button.getAttribute("aria-keyshortcuts")).toContain("Alt+ArrowDown");
    key(button, { key: "ArrowDown", altKey: true, shiftKey: true });
    expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
      schedule_start_at: at(540).toISOString(), schedule_end_at: at(615).toISOString(),
    }));
    onUpdateTaskSchedule.mockClear();
    key(button, { key: "ArrowDown", altKey: true });
    expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
      schedule_start_at: at(570).toISOString(), schedule_end_at: at(630).toISOString(),
    }));
    onUpdateTaskSchedule.mockClear();
    // 不带 ⌥ 的方向键不改期，保留默认滚动行为
    key(button, { key: "ArrowDown" });
    expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
  });

  it("高度不足 20px 的块不渲染热区", () => {
    render([day], [{ ...task, id: "short", schedule_end_at: at(555).toISOString() }]);
    expect(container.querySelector("[data-resize-edge]")).toBeNull();
  });
});
