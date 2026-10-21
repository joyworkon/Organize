// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CountdownDay, TaskWithTags } from "@organize/shared";
import { TaskMonthView, TimeGridView, weekDaysOf } from "./task-month-view";
import { DEFAULT_CALENDAR_VIEW_OPTIONS } from "@/lib/tasks/calendar-view-options";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children),
}));

if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

function taskAt(id: string, title: string, day: number, hour: number, status: TaskWithTags["status"] = "todo", extra: Partial<TaskWithTags> = {}): TaskWithTags {
  const start = new Date(2026, 9, day, hour, 0);
  return {
    id, user_id: "u1", title, description: null, status,
    priority: "medium", category: "work", due_date: null,
    estimated_minutes: null, actual_minutes: null, reading_item_id: null,
    note_id: null, is_pinned: false, sort_order: hour, completed_at: null,
    created_at: start.toISOString(), updated_at: start.toISOString(),
    schedule_start_at: start.toISOString(),
    schedule_end_at: new Date(2026, 9, day, hour + 1, 0).toISOString(),
    ...extra,
  };
}

function recurringSource(day = 13): TaskWithTags {
  return taskAt("r1", "每周任务", day, 9, "todo", {
    recurrence_rule: { frequency: "weekly", interval: 1 } as TaskWithTags["recurrence_rule"],
  });
}

function countdown(id: string, title: string, day: number): CountdownDay {
  return {
    id, user_id: "u1", title, target_date: `2026-10-${String(day).padStart(2, "0")}`, repeat_annually: false,
    deleted_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  };
}

describe("日历就地勾选完成", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onTaskClick = vi.fn();
  const onToggleTaskDone = vi.fn();
  const onRescheduleTask = vi.fn().mockResolvedValue(undefined);
  const onUpdateTaskSchedule = vi.fn().mockResolvedValue(undefined);
  const onDateClick = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const proto = HTMLElement.prototype as HTMLElement & {
      hasPointerCapture?: (id: number) => boolean;
      setPointerCapture?: (id: number) => void;
      releasePointerCapture?: (id: number) => void;
      scrollIntoView?: () => void;
    };
    proto.hasPointerCapture ??= () => false;
    proto.setPointerCapture ??= () => {};
    proto.releasePointerCapture ??= () => {};
    proto.scrollIntoView ??= () => {};
    onTaskClick.mockReset();
    onToggleTaskDone.mockReset();
    onRescheduleTask.mockReset();
    onUpdateTaskSchedule.mockReset();
    onDateClick.mockReset();
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

  function renderMonth(tasks: TaskWithTags[], props: Record<string, unknown> = {}) {
    act(() => {
      root.render(createElement(TaskMonthView, {
        tasks, countdowns: [], onTaskClick, onToggleTaskDone, onRescheduleTask, onUpdateTaskSchedule, onDateClick,
        ...props,
      }));
    });
  }

  function checkboxIn(scope: ParentNode = container) {
    return Array.from(scope.querySelectorAll<HTMLElement>('[data-calendar-task-checkbox]'));
  }

  it("月视图条形段：点方框切换完成，不打开 peek、不触发拖拽改期", () => {
    renderMonth([taskAt("t1", "条形任务", 19, 9)]);
    const bar = Array.from(container.querySelectorAll("button.absolute")).find((button) => button.textContent?.includes("条形任务"))!;
    const box = bar.querySelector<HTMLElement>('[data-calendar-task-checkbox]')!;
    expect(box.getAttribute("role")).toBe("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    act(() => {
      box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onToggleTaskDone).toHaveBeenCalledTimes(1);
    expect(onToggleTaskDone.mock.calls[0][0].id).toBe("t1");
    expect(onTaskClick).not.toHaveBeenCalled();
    expect(onRescheduleTask).not.toHaveBeenCalled();
    expect(onDateClick).not.toHaveBeenCalled();
  });

  it("方框 pointerdown 不冒泡：拖拽会话不启动（capture 不被调用）", () => {
    renderMonth([taskAt("t1", "条形任务", 19, 9)]);
    const bar = Array.from(container.querySelectorAll("button.absolute")).find((button) => button.textContent?.includes("条形任务"))!;
    const box = bar.querySelector<HTMLElement>('[data-calendar-task-checkbox]')!;
    const capture = vi.fn();
    bar.setPointerCapture = capture;
    act(() => {
      box.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it("键盘 Space 切换完成；done 状态 aria-checked=true", () => {
    renderMonth([taskAt("t1", "已完成条", 19, 9, "done")]);
    const bar = Array.from(container.querySelectorAll("button.absolute")).find((button) => button.textContent?.includes("已完成条"))!;
    const box = bar.querySelector<HTMLElement>('[data-calendar-task-checkbox]')!;
    expect(box.getAttribute("aria-checked")).toBe("true");
    act(() => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    });
    expect(onToggleTaskDone).toHaveBeenCalledTimes(1);
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it("重复任务投影不渲染方框，不会误改母任务", () => {
    const source = recurringSource(13); // 10-13 周二，每周 → 10-20 出现投影
    renderMonth([source]);
    const bars = Array.from(container.querySelectorAll("button.absolute"));
    const projectedBar = bars.find((button) => button.getAttribute("data-recurring-projection") === "true");
    expect(projectedBar).toBeTruthy();
    expect(projectedBar!.querySelector("[data-calendar-task-checkbox]")).toBeNull();
    const realBar = bars.find((button) => button.textContent?.includes("每周任务") && button.getAttribute("data-recurring-projection") !== "true");
    expect(realBar!.querySelector("[data-calendar-task-checkbox]")).not.toBeNull();
  });

  it("当天弹层（+N）内点方框只切换完成，不打开任务", () => {
    const tasks = [
      taskAt("t1", "任务一", 19, 9),
      taskAt("t2", "任务二", 19, 10),
      taskAt("t3", "任务三", 19, 11),
      taskAt("t4", "任务四", 19, 12),
    ];
    renderMonth(tasks);
    const more = container.querySelector<HTMLButtonElement>("[aria-label^='查看 ']")!;
    act(() => { more.click(); });
    const dialog = document.querySelector("[role='dialog']")!;
    const boxes = checkboxIn(dialog);
    expect(boxes.length).toBe(4);
    act(() => {
      boxes[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onToggleTaskDone).toHaveBeenCalledTimes(1);
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it("日视图列表：点方框切换完成，不打开 peek", () => {
    renderMonth([taskAt("t1", "日列表任务", 19, 9)]);
    const dayButton = container.querySelector<HTMLButtonElement>('[aria-label="打开 10月19日 日视图"]')!;
    act(() => { dayButton.click(); });
    const box = container.querySelector<HTMLElement>('[data-calendar-task-checkbox]')!;
    act(() => {
      box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onToggleTaskDone).toHaveBeenCalledTimes(1);
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it("时间网格：定时块与全天芯片的方框切换完成，不触发改期回调", () => {
    const day = new Date(2026, 9, 19);
    const timed = taskAt("t1", "定时任务", 19, 9);
    const allDay = taskAt("t2", "全天任务", 19, 0, "todo", { all_day: true, schedule_end_at: new Date(2026, 9, 19, 23, 59).toISOString() });
    act(() => {
      root.render(createElement(TimeGridView, {
        days: weekDaysOf(day), tasks: [timed, allDay], countdowns: [],
        onTaskClick, onToggleTaskDone, onUpdateTaskSchedule, onDateClick,
      }));
    });
    const boxes = checkboxIn();
    expect(boxes.length).toBe(2);
    for (const box of boxes) {
      act(() => {
        box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    }
    expect(onToggleTaskDone).toHaveBeenCalledTimes(2);
    expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it("无 onToggleTaskDone 时退回纯展示方框（不可聚焦、无 role）", () => {
    renderMonth([taskAt("t1", "条形任务", 19, 9, "done")], { onToggleTaskDone: undefined });
    const bar = Array.from(container.querySelectorAll("button.absolute")).find((button) => button.textContent?.includes("条形任务"))!;
    const box = bar.querySelector("span")!;
    expect(box.getAttribute("role")).toBeNull();
    expect(box.textContent).toContain("✓");
    expect(box.getAttribute("tabIndex")).toBeNull();
  });
});

describe("日历显示选项菜单与列布局", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onViewOptionsChange = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const proto = HTMLElement.prototype as HTMLElement & {
      hasPointerCapture?: (id: number) => boolean;
      setPointerCapture?: (id: number) => void;
      releasePointerCapture?: (id: number) => void;
      scrollIntoView?: () => void;
    };
    proto.hasPointerCapture ??= () => false;
    proto.setPointerCapture ??= () => {};
    proto.releasePointerCapture ??= () => {};
    proto.scrollIntoView ??= () => {};
    onViewOptionsChange.mockReset();
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

  function render({ viewOptions: patch, ...props }: { viewOptions?: Record<string, unknown> } & Record<string, unknown> = {}) {
    act(() => {
      root.render(createElement(TaskMonthView, {
        tasks: [], countdowns: [], onViewOptionsChange,
        ...props,
        viewOptions: { ...DEFAULT_CALENDAR_VIEW_OPTIONS, ...patch },
      }));
    });
  }

  function showButton() {
    return container.querySelector<HTMLButtonElement>('[aria-label="日历显示选项"]')!;
  }

  function monthHeaderLabels() {
    const header = container.querySelector<HTMLElement>("[data-calendar-month-header]");
    expect(header).not.toBeNull();
    return Array.from(header!.querySelectorAll<HTMLDivElement>("div")).map((node) => node.textContent?.trim() ?? "");
  }

  it("显示菜单：四个选项生效并回调整体值", () => {
    render();
    act(() => { showButton().click(); });
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull();
    const item = (label: string) =>
      Array.from(menu.querySelectorAll<HTMLElement>("[role^='menuitem']")).find((node) => node.textContent?.includes(label))!;
    expect(item("显示已完成任务").getAttribute("aria-checked")).toBe("true");
    act(() => { item("显示已完成任务").click(); });
    expect(onViewOptionsChange).toHaveBeenCalledWith({ ...DEFAULT_CALENDAR_VIEW_OPTIONS, showCompleted: false });
    act(() => { item("显示倒数日").click(); });
    expect(onViewOptionsChange).toHaveBeenCalledWith({ ...DEFAULT_CALENDAR_VIEW_OPTIONS, showCountdowns: false });
    act(() => { item("周日").click(); });
    expect(onViewOptionsChange).toHaveBeenCalledWith({ ...DEFAULT_CALENDAR_VIEW_OPTIONS, weekStart: 0 });
  });

  it("Esc 关闭菜单并把焦点还给「显示」按钮；方向键在菜单项间移动", () => {
    render();
    act(() => { showButton().click(); });
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const items = Array.from(menu.querySelectorAll<HTMLElement>("[role='menuitemcheckbox']"));
    expect(document.activeElement).toBeInstanceOf(HTMLElement);
    // 方向键移到第二项
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(items[1]);
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(items[0]);
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(showButton());
  });

  it("周日起始：月视图表头第一列为周日，今天高亮列正确", () => {
    render({ viewOptions: { weekStart: 0 } });
    const labels = monthHeaderLabels();
    expect(labels[0]).toBe("周日");
    expect(labels).toHaveLength(7);
    expect(labels[6]).toBe("周六");
  });

  it("隐藏周末：表头 5 列工作日，周日任务不出现在条形段", () => {
    const sundayTask = taskAt("sun", "周日任务", 18, 9); // 2026-10-18 周日
    const weekdayTask = taskAt("mon", "周一任务", 19, 9);
    render({ tasks: [sundayTask, weekdayTask], viewOptions: { showWeekends: false } });
    const labels = monthHeaderLabels();
    expect(labels).toEqual(["周一", "周二", "周三", "周四", "周五"]);
    const bars = Array.from(container.querySelectorAll("button.absolute")).map((button) => button.textContent);
    expect(bars.join(" ")).not.toContain("周日任务");
    expect(bars.join(" ")).toContain("周一任务");
  });

  it("隐藏周末：跨周末任务条被夹到工作日列并标记延续", () => {
    // 周五到下周二（跨周末）
    const spanTask: TaskWithTags = {
      ...taskAt("span", "跨周末任务", 16, 9),
      schedule_start_at: new Date(2026, 9, 16, 9, 0).toISOString(), // 10-16 周五
      schedule_end_at: new Date(2026, 9, 20, 9, 0).toISOString(), // 10-20 周二
    };
    render({ tasks: [spanTask], viewOptions: { showWeekends: false } });
    const bars = Array.from(container.querySelectorAll<HTMLButtonElement>("button.absolute"))
      .filter((button) => button.textContent?.includes("跨周末任务"));
    // 两行各出现一次：含 10-16 的行（周五单列、右延续）与含 10-19 的行（周一周二两列、左延续）
    expect(bars).toHaveLength(2);
    const widths = bars.map((bar) => bar.style.width).sort();
    expect(widths[0]).toContain("20%");
    expect(widths[1]).toContain("40%");
    expect(bars.every((bar) => bar.textContent?.includes("跨周末任务"))).toBe(true);
  });
});
