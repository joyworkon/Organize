// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { CalendarUnscheduledTray } from "./calendar-unscheduled-tray";

/** 托盘面板：筛选 / 搜索 / 快捷排期按钮 / pointer 拖拽会话上抛与 Esc 取消。 */
describe("CalendarUnscheduledTray", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOpenTask = vi.fn();
  const onQuickSchedule = vi.fn();
  const onDragStart = vi.fn();
  const onDragMove = vi.fn();
  const onDragEnd = vi.fn();
  const onDragCancel = vi.fn();

  const unscheduled: TaskWithTags = {
    id: "t-unscheduled",
    user_id: "u1",
    title: "未排期任务甲",
    description: null,
    status: "todo",
    priority: "medium",
    category: "work",
    due_date: null,
    estimated_minutes: null,
    actual_minutes: null,
    reading_item_id: null,
    note_id: null,
    is_pinned: false,
    sort_order: 0,
    completed_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    schedule_start_at: null,
    schedule_end_at: null,
    deleted_at: null,
    recurrence_rule: null,
    tags: [],
  };
  const scheduled: TaskWithTags = {
    ...unscheduled,
    id: "t-scheduled",
    title: "已排期任务",
    schedule_start_at: "2026-10-24T02:00:00.000Z",
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onOpenTask.mockReset();
    onQuickSchedule.mockReset();
    onDragStart.mockReset();
    onDragMove.mockReset();
    onDragEnd.mockReset();
    onDragCancel.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderRoot(tasks: TaskWithTags[], dragTaskId: string | null = null) {
    act(() => {
      root.render(
        createElement(CalendarUnscheduledTray, {
          tasks,
          onOpenTask,
          onQuickSchedule,
          dragCallbacks: { onDragStart, onDragMove, onDragEnd, onDragCancel, dragTaskId },
        })
      );
    });
  }

  function render(tasks: TaskWithTags[], dragTaskId: string | null = null) {
    renderRoot(tasks, dragTaskId);
    const row = container.querySelector<HTMLElement>('[data-unscheduled-task-id="t-unscheduled"]');
    expect(row).not.toBeNull();
    let captured = false;
    Object.defineProperties(row, {
      setPointerCapture: { value: vi.fn(() => { captured = true; }), configurable: true },
      hasPointerCapture: { value: () => captured, configurable: true },
      releasePointerCapture: { value: vi.fn(() => { captured = false; }), configurable: true },
    });
    return row!;
  }

  function typeSearch(value: string) {
    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function pointer(target: HTMLElement, type: string, x: number, y: number, pointerId = 1) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  it("只显示未排期任务；搜索按标题过滤并给空态文案", () => {
    render([unscheduled, scheduled]);
    expect(container.querySelector('[data-unscheduled-task-id="t-scheduled"]')).toBeNull();
    typeSearch("不存在");
    expect(container.querySelector('[data-unscheduled-task-id]')).toBeNull();
    expect(container.textContent).toContain("没有匹配的未排期任务");
    typeSearch("甲");
    expect(container.querySelector('[data-unscheduled-task-id="t-unscheduled"]')).not.toBeNull();
  });

  it("空库空态与「今天 / 明天」快捷按钮", () => {
    renderRoot([]);
    expect(container.textContent).toContain("太好了，没有等待排期的任务");
    const row = render([unscheduled]);
    const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>("button"));
    const today = buttons.find((button) => button.textContent === "今天")!;
    const tomorrow = buttons.find((button) => button.textContent === "明天")!;
    act(() => today.click());
    act(() => tomorrow.click());
    expect(onQuickSchedule).toHaveBeenCalledWith(unscheduled, "today");
    expect(onQuickSchedule).toHaveBeenCalledWith(unscheduled, "tomorrow");
    // 快捷按钮的 pointerdown 不启动拖拽
    pointer(today, "pointerdown", 10, 10);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("轻点行打开任务详情；拖拽越过阈值后松手上抛 onDragEnd 且不打开详情", () => {
    const row = render([unscheduled]);
    pointer(row, "pointerdown", 100, 100);
    pointer(row, "pointerup", 100, 100);
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(onOpenTask).toHaveBeenCalledWith(unscheduled);
    expect(onDragEnd).not.toHaveBeenCalled();

    onOpenTask.mockClear();
    pointer(row, "pointerdown", 100, 100);
    expect(onDragStart).toHaveBeenCalledWith(unscheduled, 100, 100);
    pointer(row, "pointermove", 103, 100);
    expect(onDragMove).toHaveBeenLastCalledWith("t-unscheduled", 103, 100, false);
    pointer(row, "pointermove", 130, 140);
    expect(onDragMove).toHaveBeenLastCalledWith("t-unscheduled", 130, 140, true);
    pointer(row, "pointerup", 130, 140);
    expect(onDragEnd).toHaveBeenCalledWith(unscheduled, 130, 140);
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("会话被页面清掉（Esc）后：移动被忽略、松手不落盘、click 被吞", () => {
    const row = render([unscheduled], "t-unscheduled");
    pointer(row, "pointerdown", 100, 100);
    pointer(row, "pointermove", 140, 140);
    expect(onDragMove).toHaveBeenLastCalledWith("t-unscheduled", 140, 140, true);
    // 页面 Esc 清掉会话（dragTaskId 回到 null），行观察到后取消本地会话
    const cancelled = render([unscheduled], null);
    pointer(cancelled, "pointermove", 200, 200);
    expect(onDragMove).toHaveBeenLastCalledWith("t-unscheduled", 140, 140, true);
    pointer(cancelled, "pointerup", 200, 200);
    expect(onDragEnd).not.toHaveBeenCalled();
    act(() => cancelled.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(onOpenTask).not.toHaveBeenCalled();
  });
});
