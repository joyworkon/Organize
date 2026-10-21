// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { TaskMonthView, weekDaysOf } from "./task-month-view";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function dayTitle(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[(date.getDay() + 6) % 7]}`;
}

function weekTitle(anchor: Date) {
  const days = weekDaysOf(anchor);
  const first = days[0];
  const last = days[6];
  const head = `${first.getMonth() + 1}月${first.getDate()}日`;
  const tail = first.getMonth() === last.getMonth() ? `${last.getDate()}日` : `${last.getMonth() + 1}月${last.getDate()}日`;
  return `${head} - ${tail}`;
}

describe("日历顶栏、键盘导航与年视图钻取", () => {
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
    const task: TaskWithTags = {
      id: "march", user_id: "u1", title: "三月任务", description: null, status: "todo",
      priority: "medium", category: "work", due_date: null,
      estimated_minutes: null, actual_minutes: null, reading_item_id: null,
      note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
      created_at: "2026-03-15T04:00:00Z", updated_at: "2026-03-15T04:00:00Z",
      schedule_start_at: new Date(2026, 2, 15, 12).toISOString(),
    };
    act(() => {
      root.render(createElement(TaskMonthView, { tasks: [task], onDateClick }));
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

  function press(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init, key });
    act(() => { window.dispatchEvent(event); });
    return event;
  }

  function click(selector: string) {
    const button = container.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    act(() => { button!.click(); });
  }

  it("N 在月格新建全天事项，日/周视图新建下个整点的范围", () => {
    press("n");
    expect(onDateClick.mock.calls[0][0]).toEqual(new Date(2026, 9, 19));
    expect(onDateClick.mock.calls[0][1]).toBeUndefined();
    expect(onDateClick.mock.calls[0][2].focusTarget.getAttribute("role")).toBe("gridcell");
    press("d");
    press("N");
    expect(onDateClick.mock.calls[1].slice(0, 2)).toEqual([new Date(2026, 9, 19, 13), new Date(2026, 9, 19, 14)]);
    press("w");
    press("n");
    expect(onDateClick.mock.calls[2].slice(0, 2)).toEqual([new Date(2026, 9, 19, 13), new Date(2026, 9, 19, 14)]);
  });

  it("N 的下个整点跨过午夜时，日视图跟随次日保住占位位置", () => {
    vi.setSystemTime(new Date(2026, 9, 19, 23, 45));
    press("d"); press("n");
    expect(onDateClick.mock.calls[0].slice(0, 2)).toEqual([new Date(2026, 9, 20), new Date(2026, 9, 20, 1)]);
    expect(heading()).toBe(dayTitle(new Date(2026, 9, 20)));
    expect(onDateClick.mock.calls[0][2].focusTarget.dataset.timeGridDay).toBe("2026-9-20");
  });

  it("保存后的新排期超出当前月时，展示对应月份并标出新事件", () => {
    const start = new Date(2026, 10, 15, 9).toISOString();
    const task: TaskWithTags = { id: "created", user_id: "u", title: "改到下月", description: null, status: "todo", priority: "medium", category: "work", due_date: start, schedule_start_at: start, estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null, is_pinned: false, sort_order: 0, completed_at: null, created_at: start, updated_at: start };
    act(() => root.render(createElement(TaskMonthView, { tasks: [task], onDateClick, createdId: "created" })));
    expect(heading()).toBe("2026年11月");
    expect(container.querySelector('[data-calendar-created="true"]')?.textContent).toContain("改到下月");
  });

  it("N 不在输入框、弹层、IME、修饰键或连发中触发", () => {
    const input = document.createElement("input"); document.body.appendChild(input);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true })));
    input.remove();
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); document.body.appendChild(dialog);
    press("n"); dialog.remove();
    press("n", { ctrlKey: true }); press("n", { metaKey: true }); press("n", { altKey: true });
    press("n", { isComposing: true }); press("n", { keyCode: 229 }); press("n", { repeat: true });
    expect(onDateClick).not.toHaveBeenCalled();
  });

  it("顶栏用共享按钮，保留模式文案、aria-label，并用 title 提示快捷键", () => {
    const month = container.querySelector<HTMLButtonElement>('button[title="月视图（m）"]')!;
    const day = container.querySelector<HTMLButtonElement>('button[title="日视图（d）"]')!;
    const prev = container.querySelector<HTMLButtonElement>('button[aria-label="上一页"]')!;
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')!;
    const todayButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "今天")!;
    expect(month.getAttribute("aria-pressed")).toBe("true");
    expect(day.getAttribute("aria-pressed")).toBe("false");
    // 手机与桌面共用同一组按钮和同一文案：月视图在手机上不再叫「议程」。
    expect(month.textContent).toBe("月");
    expect(container.querySelectorAll('button[title="月视图（m）"]')).toHaveLength(1);
    expect(day.textContent).toBe("日");
    expect(container.querySelector('button[title="周视图（w）"]')!.textContent).toBe("周");
    expect(container.querySelector('button[title="年视图（y）"]')!.textContent).toBe("年");
    expect(prev.title).toBe("上一页（←）");
    expect(next.title).toBe("下一页（→）");
    expect(todayButton.title).toBe("今天（t）");
    for (const button of [month, prev, todayButton]) {
      expect(button.className).toContain("focus-visible:ring-2");
    }
    // 模式分段与导航组都是 header 的直接子元素：手机上分段靠 order-last + basis-full 落到第二行，桌面顺序不变。
    const header = container.querySelector("header")!;
    const segment = month.parentElement!;
    const nav = prev.parentElement!;
    expect(segment.parentElement).toBe(header);
    expect(nav.parentElement).toBe(header);
    expect(segment.className).toContain("order-last");
    expect(segment.className).toContain("basis-full");
    expect(segment.className).toContain("md:order-none");
    expect(segment.className).toContain("md:ml-auto");
    expect(nav.className).toContain("ml-auto");
    expect(nav.className).toContain("md:ml-0");
    expect(month.className).toContain("flex-1");
    expect(month.className).toContain("md:flex-none");
    expect(Array.from(header.children).indexOf(segment)).toBeLessThan(Array.from(header.children).indexOf(nav));
    expect(heading()).toBe("2026年10月");
  });

  it("方向键翻页、t 回今天、d/w/m/y 切视图，连发按每次一步", () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    });
    expect(heading()).toBe("2026年8月");
    press("t");
    expect(heading()).toBe("2026年10月");
    press("ArrowLeft");
    press("d");
    expect(heading()).toBe(dayTitle(new Date(2026, 8, 19)));
    press("ArrowLeft");
    press("ArrowLeft");
    expect(heading()).toBe(dayTitle(new Date(2026, 8, 17)));
    press("t");
    press("w");
    expect(heading()).toBe(weekTitle(new Date(2026, 9, 19)));
    press("y");
    expect(heading()).toBe("2026年");
    press("ArrowLeft");
    expect(heading()).toBe("2025年");
    press("d");
    expect(heading()).toBe(dayTitle(new Date(2025, 9, 19)));
    press("m");
    expect(heading()).toBe("2025年10月");
  });

  it("月转周跟随选中日，周转月规范化月份后翻页保持所选日号", () => {
    click('[role="gridcell"][aria-label="10月21日"]');
    press("w");
    expect(heading()).toBe(weekTitle(new Date(2026, 9, 21)));
    press("ArrowRight");
    expect(heading()).toBe(weekTitle(new Date(2026, 9, 28)));
    press("m");
    expect(heading()).toBe("2026年10月");
    expect(container.querySelector('[data-mini-month-day="2026-9-19"]')!.getAttribute("aria-pressed")).toBe("true");
    press("ArrowRight");
    press("d");
    expect(heading()).toBe(dayTitle(new Date(2026, 10, 19)));
  });

  it("年视图返回当月同步今天，进入其它月钳制选中日", () => {
    click('[data-mini-month-day="2026-9-31"]');
    press("y");
    click('button[aria-label="查看 2 月"]');
    expect(container.querySelector('[data-mini-month-day="2026-1-28"]')!.getAttribute("aria-pressed")).toBe("true");
    press("y");
    click('button[aria-label="查看 10 月"]');
    expect(container.querySelector('[data-mini-month-day="2026-9-19"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("输入框、弹层和修饰键不翻页", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const typed = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(typed); });
    expect(heading()).toBe("2026年10月");
    expect(typed.defaultPrevented).toBe(false);
    input.remove();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    const blocked = press("ArrowRight");
    expect(heading()).toBe("2026年10月");
    expect(blocked.defaultPrevented).toBe(false);
    dialog.remove();

    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
    ]) {
      const event = press("ArrowLeft", init);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(press("t", { altKey: true }).defaultPrevented).toBe(false);
    expect(press("?", {}).defaultPrevented).toBe(false);
    expect(heading()).toBe("2026年10月");
  });

  it("详情面板里的输入框聚焦时，日历导航键不切换视图", () => {
    const aside = document.createElement("aside");
    aside.className = "organize-task-detail";
    const input = document.createElement("textarea");
    aside.appendChild(input);
    document.body.appendChild(aside);
    input.focus();
    for (const key of ["ArrowLeft", "ArrowRight", "t", "d", "w", "m", "y"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => { input.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(heading()).toBe("2026年10月");
    aside.remove();
  });

  it("年视图点月份进入该月，点日期进入日视图且不打开添加", () => {
    click('button[title="年视图（y）"]');
    expect(heading()).toBe("2026年");
    expect(container.textContent).not.toContain("点击添加任务或倒数日");
    const march = container.querySelector<HTMLButtonElement>('button[aria-label="查看 3 月"]')!;
    expect(march.textContent).toBe("三月");
    const day15 = Array.from(march.parentElement!.querySelectorAll("button")).find((button) => button.title === "查看这一天" && button.textContent === "15")!;
    expect(day15.querySelector(".bg-primary")).not.toBeNull();

    click('button[aria-label="查看 3 月"]');
    expect(heading()).toBe("2026年3月");
    expect(onDateClick).not.toHaveBeenCalled();

    click('button[title="年视图（y）"]');
    const marchAgain = container.querySelector<HTMLButtonElement>('button[aria-label="查看 3 月"]')!;
    const dayAgain = Array.from(marchAgain.parentElement!.querySelectorAll("button")).find((button) => button.title === "查看这一天" && button.textContent === "15")!;
    act(() => { dayAgain.click(); });
    expect(heading()).toBe(dayTitle(new Date(2026, 2, 15)));
    expect(onDateClick).not.toHaveBeenCalled();
  });
});
