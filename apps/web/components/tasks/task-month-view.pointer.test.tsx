// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { TaskMonthView } from "./task-month-view";

// 只补 jsdom 缺少的布局和 pointer capture，不 mock 页面或业务组件。
describe("桌面月视图 pointer 改期", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onReschedule = vi.fn<(id: string, date: Date) => Promise<void>>();
  const onTaskClick = vi.fn();
  const onDateClick = vi.fn();
  const start = new Date(2026, 9, 13, 9, 45);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onReschedule.mockReset().mockResolvedValue(undefined);
    onTaskClick.mockReset();
    onDateClick.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(overrides: Partial<TaskWithTags> = {}, reschedule = true) {
    const task: TaskWithTags = {
      id: "task", user_id: "u1", title: "月历测试任务", description: null, status: "todo",
      priority: "medium", category: "work", due_date: start.toISOString(),
      estimated_minutes: null, actual_minutes: null, reading_item_id: null,
      note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
      created_at: start.toISOString(), updated_at: start.toISOString(),
      schedule_start_at: start.toISOString(), ...overrides,
    };
    act(() => root.render(createElement(TaskMonthView, {
      tasks: [task], onRescheduleTask: reschedule ? onReschedule : undefined, onTaskClick, onDateClick,
    })));
    const rows = Array.from(container.querySelectorAll<HTMLDivElement>(".relative.grid.flex-1.grid-cols-7"));
    const rect = (top: number, height: number) => new DOMRect(100, top, 700, height);
    vi.spyOn(rows[0].parentElement!, "getBoundingClientRect").mockReturnValue(rect(100, 720));
    for (const [index, row] of rows.entries()) {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue(rect(100 + index * 120, 120));
      for (const button of row.querySelectorAll("button")) {
        let captured = false;
        Object.defineProperties(button, {
          setPointerCapture: { value: vi.fn(() => { captured = true; }) },
          hasPointerCapture: { value: () => captured },
          releasePointerCapture: { value: vi.fn(() => { captured = false; }) },
        });
      }
    }
    // 日期数字和「+N」也是按钮；拖拽目标仍是绝对定位的任务条。
    const button = rows[2].querySelector<HTMLButtonElement>("button.absolute");
    expect(button).not.toBeNull();
    return { rows, button: button! };
  }

  function pointer(button: HTMLButtonElement, type: string, x: number, y: number, pointerId = 1) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
    button.dispatchEvent(event);
  }

  function click(button: HTMLButtonElement, detail = 1) {
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
  }

  it("capture 在源按钮上也能跨周高亮/画幽灵，松手保时分且不打开详情", async () => {
    const { rows, button } = render();
    expect(button.hasAttribute("draggable")).toBe(false);
    expect(button.style.touchAction).toBe("none");
    act(() => pointer(button, "pointerdown", 250, 370));
    expect(button.setPointerCapture).toHaveBeenCalledWith(1);
    act(() => pointer(button, "pointermove", 450, 490)); // 第四周周四，10/22
    expect(rows[3].querySelector(".border-dashed")?.textContent).toBe("月历测试任务");
    expect(rows[3].children[3].className).toContain("ring-primary");
    expect(button.className).toContain("opacity-40");
    await act(async () => pointer(button, "pointerup", 450, 490));
    click(button);
    expect(onReschedule).toHaveBeenCalledExactlyOnceWith("task", new Date(2026, 9, 22, 9, 45));
    expect(button.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(container.querySelector('[data-calendar-surface="month"] .border-dashed')).toBeNull();
    expect(onTaskClick).not.toHaveBeenCalled();
    expect(onDateClick).not.toHaveBeenCalled();
  });

  it("跨天任务续段轻点不改期，仍打开一次详情", async () => {
    const { button } = render({
      schedule_start_at: new Date(2026, 9, 9, 9, 45).toISOString(),
      schedule_end_at: new Date(2026, 9, 13, 10, 45).toISOString(),
    });
    act(() => pointer(button, "pointerdown", 250, 370));
    act(() => pointer(button, "pointermove", 252, 372));
    await act(async () => pointer(button, "pointerup", 252, 372));
    click(button);
    expect(onReschedule).not.toHaveBeenCalled();
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onDateClick).not.toHaveBeenCalled();
  });

  it("拖出后落回原日不改期，仍按点击处理", async () => {
    const { button } = render();
    act(() => pointer(button, "pointerdown", 250, 370));
    act(() => pointer(button, "pointermove", 450, 490));
    await act(async () => pointer(button, "pointerup", 260, 370));
    click(button);
    expect(onReschedule).not.toHaveBeenCalled();
    expect(onTaskClick).toHaveBeenCalledTimes(1);
  });

  it.each(["pointercancel", "lostpointercapture"])("%s 清除幽灵和高亮，不改期或打开详情", (type) => {
    const { button } = render();
    act(() => pointer(button, "pointerdown", 250, 370));
    act(() => pointer(button, "pointermove", 450, 490));
    act(() => pointer(button, type, 450, 490));
    click(button);
    expect(onReschedule).not.toHaveBeenCalled();
    expect(onTaskClick).not.toHaveBeenCalled();
    expect(container.querySelector('[data-calendar-surface="month"] .border-dashed')).toBeNull();
    expect(container.querySelector('[data-calendar-surface="month"] .ring-primary')).toBeNull();
    // 取消后仍允许键盘激活，下一次 pointer 手势也能正常点击。
    click(button, 0);
    expect(onTaskClick).toHaveBeenCalledTimes(1);
  });

  it("松手采用最后坐标，移出可见网格则取消且不沿用旧落点", async () => {
    const { button } = render();
    act(() => pointer(button, "pointerdown", 250, 370));
    act(() => pointer(button, "pointermove", 450, 490));
    await act(async () => pointer(button, "pointerup", 450, 90));
    click(button);
    expect(onReschedule).not.toHaveBeenCalled();
    expect(onTaskClick).not.toHaveBeenCalled();
    expect(container.querySelector('[data-calendar-surface="month"] .border-dashed')).toBeNull();
  });

  it("忽略其它 pointer，最终可从右边缘夹紧落在周日", async () => {
    const { button } = render();
    act(() => pointer(button, "pointerdown", 250, 370));
    act(() => pointer(button, "pointermove", 450, 490, 2));
    await act(async () => pointer(button, "pointerup", 450, 490, 2));
    expect(onReschedule).not.toHaveBeenCalled();
    await act(async () => pointer(button, "pointerup", 1000, 490));
    expect(onReschedule).toHaveBeenCalledExactlyOnceWith("task", new Date(2026, 9, 25, 9, 45));
  });

  it("没有改期回调时保持普通点击", async () => {
    const { button } = render({}, false);
    act(() => pointer(button, "pointerdown", 250, 370));
    act(() => pointer(button, "pointermove", 450, 490));
    await act(async () => pointer(button, "pointerup", 450, 490));
    click(button);
    expect(button.setPointerCapture).not.toHaveBeenCalled();
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onReschedule).not.toHaveBeenCalled();
  });
});
