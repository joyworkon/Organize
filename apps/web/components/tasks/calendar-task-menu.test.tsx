// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import type { CalendarRescheduleShortcut } from "@/lib/tasks/calendar-reschedule";
import { TaskMonthView } from "./task-month-view";

const at = (day: number, hour = 9, minute = 30) => new Date(2026, 9, day, hour, minute);
const task: TaskWithTags = {
  id: "t1", user_id: "u", title: "菜单验证任务", description: null, status: "todo", priority: "medium", category: "work",
  due_date: null, estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null,
  is_pinned: false, sort_order: 0, completed_at: null, created_at: at(21).toISOString(), updated_at: at(21).toISOString(),
  schedule_start_at: at(21).toISOString(), schedule_end_at: at(21, 11).toISOString(), all_day: false,
};
const recurringSource: TaskWithTags = {
  ...task, id: "src", title: "每周例会", recurrence_rule: { frequency: "weekly", interval: 1 },
  schedule_start_at: at(13).toISOString(), schedule_end_at: at(13, 11).toISOString(),
};

function menu() {
  return document.querySelector<HTMLElement>('[data-testid="calendar-task-menu"]');
}
function menuItem(testId: string) {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

describe("日历任务右键菜单", () => {
  let container: HTMLDivElement, root: Root;
  const onTaskClick = vi.fn();
  const onToggleTaskDone = vi.fn();
  const onRescheduleTaskShortcut = vi.fn();
  const onDuplicateTask = vi.fn();
  const onDeleteTask = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(21, 12));
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

  function render(tasks: TaskWithTags[] = [task]) {
    act(() => root.render(createElement(TaskMonthView, {
      tasks,
      onTaskClick,
      onToggleTaskDone,
      onRescheduleTaskShortcut,
      onDuplicateTask,
      onDeleteTask,
    })));
    return container.querySelector('[data-calendar-surface="month"]')!.querySelector<HTMLButtonElement>(
      `button[data-calendar-task-id="${tasks[0].id}"]`
    )!;
  }

  function contextMenu(node: HTMLElement) {
    act(() => {
      node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
    });
  }

  it("右键月视图条目打开统一菜单，包含详情/完成/改期/复制/删除", () => {
    const bar = render();
    contextMenu(bar);
    expect(menu()).not.toBeNull();
    expect(menuItem("calendar-task-menu-open")).not.toBeNull();
    expect(menuItem("calendar-task-menu-toggle")!.textContent).toContain("标记完成");
    expect(menuItem("calendar-task-menu-today")).not.toBeNull();
    expect(menuItem("calendar-task-menu-tomorrow")).not.toBeNull();
    expect(menuItem("calendar-task-menu-next-week")!.textContent).toContain("下周一");
    expect(menuItem("calendar-task-menu-clear")).not.toBeNull();
    expect(menuItem("calendar-task-menu-duplicate")).not.toBeNull();
    expect(menuItem("calendar-task-menu-delete")).not.toBeNull();
  });

  it("菜单改期与删除回调带上任务；菜单随后关闭", () => {
    const bar = render();
    contextMenu(bar);
    act(() => menuItem("calendar-task-menu-tomorrow")!.click());
    expect(onRescheduleTaskShortcut).toHaveBeenCalledExactlyOnceWith(task, "tomorrow");
    expect(menu()).toBeNull();
    contextMenu(bar);
    act(() => menuItem("calendar-task-menu-clear")!.click());
    expect(onRescheduleTaskShortcut).toHaveBeenLastCalledWith(task, "clear");
    contextMenu(bar);
    act(() => menuItem("calendar-task-menu-delete")!.click());
    expect(onDeleteTask).toHaveBeenCalledExactlyOnceWith(task.id);
    contextMenu(bar);
    act(() => menuItem("calendar-task-menu-toggle")!.click());
    expect(onToggleTaskDone).toHaveBeenCalledExactlyOnceWith(task);
    contextMenu(bar);
    act(() => menuItem("calendar-task-menu-open")!.click());
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("周/日视图条目同样能打开菜单", () => {
    act(() => root.render(createElement(TaskMonthView, {
      tasks: [task], onTaskClick, onToggleTaskDone, onRescheduleTaskShortcut, onDuplicateTask, onDeleteTask,
    })));
    // 周视图展示 cursor 所在周；先切周再「今天」，把游标对到任务当周
    act(() => container.querySelector<HTMLButtonElement>('button[title="周视图（w）"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('button[title="今天（t）"]')!.click());
    const chip = container.querySelector<HTMLButtonElement>(`button[data-calendar-task-id="${task.id}"]`)!;
    expect(chip).toBeTruthy();
    contextMenu(chip);
    expect(menu()).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('button[title="日视图（d）"]')!.click());
    const block = container.querySelector<HTMLButtonElement>(`button[data-calendar-task-id="${task.id}"]`)!;
    contextMenu(block);
    expect(menu()).not.toBeNull();
  });

  it("重复投影：只保留打开详情与置灰提示，改期/删除/复制不可用", () => {
    act(() => root.render(createElement(TaskMonthView, {
      tasks: [recurringSource], onTaskClick, onToggleTaskDone, onRescheduleTaskShortcut, onDuplicateTask, onDeleteTask,
    })));
    const projection = container.querySelector<HTMLButtonElement>('button[data-recurring-projection="true"]')!;
    contextMenu(projection);
    expect(menu()).not.toBeNull();
    expect(menuItem("calendar-task-menu-open")).not.toBeNull();
    expect(menuItem("calendar-task-menu-tomorrow")).toBeNull();
    expect(menuItem("calendar-task-menu-delete")).toBeNull();
    expect(menuItem("calendar-task-menu-duplicate")).toBeNull();
    expect(menu()!.textContent).toContain("请在原任务上修改");
    act(() => menuItem("calendar-task-menu-open")!.click());
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(recurringSource);
  });

  it("键盘：Space/x 切换完成、Delete 删除、Shift+F10 打开菜单并聚焦第一项", () => {
    const bar = render();
    bar.focus();
    act(() => bar.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true })));
    expect(onToggleTaskDone).toHaveBeenCalledExactlyOnceWith(task);
    act(() => bar.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
    expect(onToggleTaskDone).toHaveBeenCalledTimes(2);
    act(() => bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })));
    expect(onDeleteTask).toHaveBeenCalledExactlyOnceWith(task.id);
    act(() => bar.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true })));
    expect(menu()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.activeElement).toBe(menuItem("calendar-task-menu-open"));
    // Enter 激活聚焦的菜单项；Escape 关闭并把焦点还给任务条目
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(task);
    act(() => bar.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true })));
    act(() => vi.advanceTimersByTime(1));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(bar);
  });

  it("触屏长按打开菜单；移动取消长按；长按后的 click 被吞掉", () => {
    const bar = render();
    const pointer = (node: HTMLElement, type: string, x: number, y: number, pointerType = "touch") => {
      act(() => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
        Object.defineProperties(event, {
          pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: pointerType },
        });
        node.dispatchEvent(event);
      });
    };
    // 鼠标不触发长按
    pointer(bar, "pointerdown", 100, 200, "mouse");
    act(() => vi.advanceTimersByTime(600));
    expect(menu()).toBeNull();
    // 触屏按住 500ms 打开菜单
    pointer(bar, "pointerdown", 100, 200);
    act(() => vi.advanceTimersByTime(500));
    expect(menu()).not.toBeNull();
    // 长按后的 mousedown（Chromium 抬指时合成，落在源条目上）不把菜单当「点外」误关
    act(() => bar.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    expect(menu()).not.toBeNull();
    // 长按后的 click 不打开详情
    act(() => bar.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })));
    expect(onTaskClick).not.toHaveBeenCalled();
    // 移动超过阈值会取消长按
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    pointer(bar, "pointerdown", 100, 200);
    pointer(bar, "pointermove", 130, 220);
    act(() => vi.advanceTimersByTime(600));
    expect(menu()).toBeNull();
  });

  it("未接线改期回调时菜单不显示改期组", () => {
    act(() => root.render(createElement(TaskMonthView, {
      tasks: [task], onTaskClick, onToggleTaskDone, onDeleteTask,
    })));
    const bar = container.querySelector<HTMLButtonElement>(`button[data-calendar-task-id="${task.id}"]`)!;
    contextMenu(bar);
    expect(menuItem("calendar-task-menu-tomorrow")).toBeNull();
    expect(menuItem("calendar-task-menu-delete")).not.toBeNull();
  });
});
