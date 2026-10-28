// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { TaskMonthView } from "./task-month-view";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children),
}));

/** 标题「跳转到日期」面板（点标题 / g）在五模式下的落点；面板挂在 body portal，从 document 取。 */

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function dayTitle(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[(date.getDay() + 6) % 7]}`;
}

describe("日历标题跳转：g 打开面板与五模式落点", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDateClick = vi.fn();
  const today = new Date(2026, 9, 19, 12);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(today);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onDateClick.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const task = (id: string, day: number): TaskWithTags => ({
      id, user_id: "u1", title: `任务${day}`, description: null, status: "todo",
      priority: "medium", category: "work", due_date: null, estimated_minutes: null, actual_minutes: null,
      reading_item_id: null, note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
      created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
      schedule_start_at: new Date(2026, 9, day, 12).toISOString(),
    });
    act(() => {
      root.render(createElement(TaskMonthView, { tasks: [task("t1", 22), task("t2", 26)], onDateClick }));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelector('[role="dialog"]')?.remove();
    vi.useRealTimers();
  });

  function heading() {
    return container.querySelector("h2")!.textContent;
  }

  function trigger() {
    return container.querySelector<HTMLButtonElement>("[data-calendar-jump-trigger]")!;
  }

  function panel() {
    return document.querySelector<HTMLElement>("[data-calendar-jump-panel]");
  }

  function day(key: string) {
    return document.querySelector<HTMLButtonElement>(`[data-jump-day="${key}"]`);
  }

  function press(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init, key });
    act(() => { window.dispatchEvent(event); });
    return event;
  }

  function click(node: Element | null) {
    expect(node).not.toBeNull();
    act(() => (node as HTMLButtonElement).click());
  }

  function openPanelByTrigger() {
    act(() => trigger().click());
    expect(panel()).not.toBeNull();
  }

  it("g 打开面板、Esc 关闭并还焦点给触发器；标题按钮带 aria/title 提示", () => {
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger().title).toBe("跳转到日期（g）");
    press("g");
    expect(panel()).not.toBeNull();
    // 弹层已打开时再按 g / 模式键不重复触发（hasOpenDialog 让位）
    press("g");
    press("m");
    expect(panel()).not.toBeNull();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(panel()).toBeNull();
    // Radix FocusScope 的关闭回焦在 setTimeout(0) 里派发，推进假时钟后触发器拿回焦点
    act(() => { vi.advanceTimersByTime(1); });
    expect(document.activeElement).toBe(trigger());
    expect(heading()).toBe("2026年10月");
  });

  it("g 不在 IME 合成、修饰键或连发中触发", () => {
    press("g", { isComposing: true });
    press("g", { keyCode: 229 });
    press("g", { ctrlKey: true });
    press("g", { repeat: true });
    expect(panel()).toBeNull();
  });

  it("月视图：翻月选日 → 该月并选中该日", () => {
    press("g");
    click(panel()!.querySelector('[aria-label="下一月"]'));
    click(day("2026-10-15"));
    expect(panel()).toBeNull();
    expect(heading()).toBe("2026年11月");
    const cell = container.querySelector<HTMLElement>('[role="gridcell"][aria-label="11月15日"]');
    expect(cell?.tabIndex).toBe(0);
    // 弹层回焦在 0ms，选中日在 1ms 再拿回焦点
    act(() => { vi.advanceTimersByTime(1); });
    expect(document.activeElement).toBe(cell);
  });

  it("日视图：跳到那天", () => {
    press("d");
    press("g");
    click(day("2026-9-26"));
    expect(heading()).toBe(dayTitle(new Date(2026, 9, 26)));
  });

  it("周视图：跳到含该日的那一周（周一起始把周日归入上一周）", () => {
    press("w");
    press("g");
    click(panel()!.querySelector('[aria-label="下一月"]'));
    click(day("2026-10-1")); // 11-01 周日
    expect(heading()).toBe("10月26日 - 11月1日");
  });

  it("年视图：先选年月再选日，直接进入该日的日视图", () => {
    press("y");
    press("g");
    expect(panel()!.querySelectorAll("[data-jump-month]")).toHaveLength(12);
    click(panel()!.querySelector('[data-jump-month="11"]'));
    click(day("2026-11-25"));
    expect(container.querySelector<HTMLButtonElement>('button[title="日视图（d）"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(heading()).toBe(dayTitle(new Date(2026, 11, 25)));
  });

  it("日程视图：以该日为 30 天窗口起点；目标日无分组时其后最近的分组在场", () => {
    press("a");
    press("g");
    click(day("2026-9-24"));
    expect(heading()).toBe("10月24日 - 11月22日");
    // 10/24 当天无安排（分组只含有内容的日子）；其后最近的 10/26 分组在场。
    // jsdom 无布局，滚动本身由 e2e 覆盖。
    expect(document.querySelector('[data-calendar-surface="agenda"] [data-agenda-day="2026-9-26"]')).not.toBeNull();
    expect(document.querySelector('[data-calendar-surface="agenda"] [data-agenda-day="2026-9-22"]')).toBeNull();
  });

  it("点触发器同样打开面板并可用（与 g 同一入口）", () => {
    openPanelByTrigger();
    click(day("2026-9-22"));
    expect(panel()).toBeNull();
    expect(heading()).toBe("2026年10月");
  });
});
