// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CountdownDay, TaskWithTags } from "@organize/shared";
import { TaskMonthView } from "./task-month-view";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children),
}));

if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function dayTitle(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[(date.getDay() + 6) % 7]}`;
}

function taskAt(id: string, title: string, day: number, hour: number, status: TaskWithTags["status"] = "todo"): TaskWithTags {
  const start = new Date(2026, 9, day, hour, 0);
  return {
    id, user_id: "u1", title, description: null, status,
    priority: "medium", category: "work", due_date: null,
    estimated_minutes: null, actual_minutes: null, reading_item_id: null,
    note_id: null, is_pinned: false, sort_order: hour, completed_at: null,
    created_at: start.toISOString(), updated_at: start.toISOString(),
    schedule_start_at: start.toISOString(),
    schedule_end_at: new Date(2026, 9, day, hour + 1, 0).toISOString(),
  };
}

function countdown(id: string, title: string, day: number): CountdownDay {
  return {
    id, user_id: "u1", title, target_date: `2026-10-${String(day).padStart(2, "0")}`, repeat_annually: false,
    deleted_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  };
}

describe("月视图当天弹层、日期钻取与格子键盘", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDateClick = vi.fn();
  const onTaskClick = vi.fn();

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
    onDateClick.mockReset();
    onTaskClick.mockReset();
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

  function render(tasks: TaskWithTags[] = [], countdowns: CountdownDay[] = []) {
    act(() => {
      root.render(createElement(TaskMonthView, { tasks, countdowns, onDateClick, onTaskClick }));
    });
  }

  function heading() {
    return container.querySelector("h2")!.textContent;
  }

  function cell(label: string) {
    const node = container.querySelector<HTMLDivElement>(`[role="gridcell"][aria-label="${label}"]`);
    expect(node).not.toBeNull();
    return node!;
  }

  function press(node: HTMLElement, key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init, key });
    act(() => {
      node.focus();
      node.dispatchEvent(event);
    });
    return event;
  }

  function moreButton() {
    return container.querySelector<HTMLButtonElement>("[aria-label^='查看 ']");
  }

  it("五个任务显示三条和 +2，弹层列出全部并可打开第四条", () => {
    const tasks = [
      taskAt("t1", "任务一", 19, 9),
      taskAt("t2", "任务二", 19, 10),
      taskAt("t3", "任务三", 19, 11),
      taskAt("t4", "任务四", 19, 12),
      taskAt("t5", "任务五", 19, 13, "done"),
    ];
    render(tasks);
    const bars = Array.from(container.querySelectorAll("button.absolute")).map((button) => button.textContent);
    expect(bars).toHaveLength(3);
    expect(bars.join(" ")).toContain("任务一");
    expect(bars.join(" ")).toContain("任务三");
    expect(bars.join(" ")).not.toContain("任务四");
    const more = moreButton()!;
    expect(more.textContent).toBe("+2");
    expect(more.getAttribute("aria-label")).toBe("查看 10月19日 全部 5 项");
    expect(more.className).toContain("focus-visible:ring-2");

    act(() => { more.click(); });
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog.textContent).toContain("10月19日 周一");
    const titles = ["任务一", "任务二", "任务三", "任务四", "任务五"];
    for (const title of titles) expect(dialog.textContent).toContain(title);
    expect(dialog.textContent).toContain("12:00");
    const fourth = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent?.includes("任务四"))!;
    const done = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent?.includes("任务五"))!;
    expect(done.className).toContain("line-through");
    expect(done.textContent).toContain("✓");
    act(() => { fourth.click(); });
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onTaskClick.mock.calls[0][0].id).toBe("t4");
    expect(onDateClick).not.toHaveBeenCalled();
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("倒数日全部出现在同一弹层，并能进日视图或添加", () => {
    render([], [countdown("c1", "生日", 19), countdown("c2", "纪念日", 19)]);
    expect(container.textContent).toContain("生日");
    const more = moreButton()!;
    expect(more.textContent).toBe("+1");
    expect(more.getAttribute("aria-label")).toBe("查看 10月19日 全部 2 项");
    act(() => { more.click(); });
    expect(onDateClick).not.toHaveBeenCalled();
    const dialog = document.querySelector("[role='dialog']")!;
    const chips = Array.from(dialog.querySelectorAll("button[aria-label^='倒数日']"));
    expect(chips.map((chip) => chip.textContent)).toEqual(["生日", "纪念日"]);

    const blocked = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(blocked); });
    expect(heading()).toBe("2026年10月");
    expect(blocked.defaultPrevented).toBe(false);

    act(() => {
      Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "在日视图打开")!.click();
    });
    expect(heading()).toBe(dayTitle(new Date(2026, 9, 19)));
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(onDateClick).not.toHaveBeenCalled();
  });

  it("只有折叠倒数日时 Esc 关闭并把焦点还给 +N，添加仍走 onDateClick", async () => {
    render([], [countdown("c1", "生日", 19), countdown("c2", "纪念日", 19)]);
    const more = moreButton()!;
    act(() => { more.focus(); more.click(); });
    const dialog = document.querySelector("[role='dialog']")!;
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    // 焦点归还发生在弹层卸载后的 setTimeout(0)，要等这一拍。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(more);

    act(() => { more.click(); });
    const add = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("添加"))!;
    act(() => { add.click(); });
    expect(onDateClick).toHaveBeenCalledTimes(1);
    expect(onDateClick.mock.calls[0][0]).toEqual(new Date(2026, 9, 19));
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("日期数字进入日视图，格子空白仍添加", () => {
    render([taskAt("t1", "一条", 20, 9)]);
    expect(moreButton()).toBeNull();
    const day = cell("10月20日");
    const dateButton = day.querySelector("button")!;
    expect(dateButton.getAttribute("aria-label")).toBe("打开 10月20日 日视图");
    expect(dateButton.className).toContain("rounded-full");
    act(() => { dateButton.click(); });
    expect(heading()).toBe(dayTitle(new Date(2026, 9, 20)));
    expect(onDateClick).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }));
    });
    expect(heading()).toBe("2026年10月");
    act(() => { cell("10月20日").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onDateClick).toHaveBeenCalledTimes(1);
    expect(onDateClick.mock.calls[0][0]).toEqual(new Date(2026, 9, 20));
    expect(heading()).toBe("2026年10月");
  });

  it("方向键在格子内移动且不翻页，月末再向右进入下月 1 日", () => {
    render();
    const cells = Array.from(container.querySelectorAll<HTMLElement>("[role='gridcell']"));
    expect(cells.filter((item) => item.tabIndex === 0).map((item) => item.getAttribute("aria-label"))).toEqual(["10月19日"]);
    expect(cell("10月19日").className).toContain("focus-visible:ring-2");
    const rows = container.querySelectorAll("[role='row']");
    expect(rows).toHaveLength(6);
    expect(container.querySelector("[role='grid']")?.getAttribute("aria-label")).toBe("2026年10月");

    press(cell("10月19日"), "ArrowRight");
    expect(heading()).toBe("2026年10月");
    expect(document.activeElement).toBe(cell("10月20日"));
    expect(cell("10月20日").tabIndex).toBe(0);
    expect(cell("10月19日").tabIndex).toBe(-1);

    press(cell("10月20日"), "ArrowLeft");
    expect(document.activeElement).toBe(cell("10月19日"));
    press(cell("10月19日"), "ArrowDown");
    expect(document.activeElement).toBe(cell("10月26日"));
    press(cell("10月26日"), "Home");
    expect(document.activeElement).toBe(cell("10月26日"));
    press(cell("10月26日"), "End");
    expect(heading()).toBe("2026年11月");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("11月1日");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true }));
    });
    press(cell("10月1日"), "Home");
    expect(heading()).toBe("2026年9月");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("9月28日");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true }));
    });
    expect(heading()).toBe("2026年10月");
    press(cell("10月31日"), "ArrowRight");
    expect(heading()).toBe("2026年11月");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("11月1日");
    expect(cell("11月1日").tabIndex).toBe(0);
    expect(onDateClick).not.toHaveBeenCalled();
  });

  it("Enter 和空格添加，Shift+Enter 进日视图；格子内按 d 仍切视图", () => {
    render();
    press(cell("10月19日"), "Enter");
    expect(onDateClick).toHaveBeenCalledTimes(1);
    expect(onDateClick.mock.calls[0][0]).toEqual(new Date(2026, 9, 19));
    expect(heading()).toBe("2026年10月");

    press(cell("10月19日"), " ");
    expect(onDateClick).toHaveBeenCalledTimes(2);

    const viewed = press(cell("10月19日"), "d");
    expect(viewed.defaultPrevented).toBe(true);
    expect(heading()).toBe(dayTitle(new Date(2026, 9, 19)));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }));
    });
    press(cell("10月18日"), "Enter", { shiftKey: true });
    expect(heading()).toBe(dayTitle(new Date(2026, 9, 18)));
    expect(onDateClick).toHaveBeenCalledTimes(2);
  });

  it("翻页后焦点落点回到今天或该月 1 日，格子外的方向键仍翻页", () => {
    render();
    press(cell("10月19日"), "ArrowRight");
    act(() => {
      container.querySelector<HTMLButtonElement>("button[aria-label='下一页']")!.click();
    });
    expect(heading()).toBe("2026年11月");
    expect(container.querySelectorAll("[role='gridcell'][tabindex='0']")).toHaveLength(1);
    expect(cell("11月1日").tabIndex).toBe(0);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    });
    expect(heading()).toBe("2026年10月");
  });
});
