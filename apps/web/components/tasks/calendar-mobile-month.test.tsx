// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CountdownDay, TaskWithTags } from "@organize/shared";
import { TaskMonthView, weekDaysOf } from "./task-month-view";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const at = (day: number, hour = 9, month = 9) => new Date(2026, month, day, hour);

function mkTask(id: string, title: string, start: Date, end: Date | null = null): TaskWithTags {
  return {
    id, user_id: "u1", title, description: null, status: "todo", priority: "medium", category: "work",
    due_date: start.toISOString(), estimated_minutes: null, actual_minutes: null, reading_item_id: null,
    note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
    created_at: start.toISOString(), updated_at: start.toISOString(),
    schedule_start_at: start.toISOString(), schedule_end_at: end ? end.toISOString() : null,
  };
}
const countdown: CountdownDay = {
  id: "c1", user_id: "u1", title: "发布日", target_date: "2026-10-25", repeat_annually: false,
  deleted_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};
const tasks = [
  mkTask("span-sep", "跨月延续", at(29, 10, 8), at(2, 18)),
  mkTask("today-task", "今天的任务", at(19, 9)),
  mkTask("multi", "三天任务", at(21, 10), at(23, 18)),
];

function dayTitle(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[(date.getDay() + 6) % 7]}`;
}
function weekTitle(anchor: Date) {
  const days = weekDaysOf(anchor);
  const head = `${days[0].getMonth() + 1}月${days[0].getDate()}日`;
  const tail = days[0].getMonth() === days[6].getMonth() ? `${days[6].getDate()}日` : `${days[6].getMonth() + 1}月${days[6].getDate()}日`;
  return `${head} - ${tail}`;
}

describe("手机月视图：迷你月历 + 议程、周日期条、滑动翻页", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDateClick = vi.fn();
  const onTaskClick = vi.fn();
  const onRescheduleTask = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(19, 12));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onDateClick.mockReset();
    onTaskClick.mockReset();
    // 议程滚动按分组相对列表的矩形差值计算；jsdom 没有布局，这里按「日 × 100px」给出几何，并随列表 scrollTop 平移。
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const key = this.getAttribute("data-agenda-day");
      if (!key) return new DOMRect(0, 0, 390, 100);
      const list = this.closest<HTMLElement>("[data-calendar-agenda]");
      return new DOMRect(0, Number(key.split("-")[2]) * 100 - (list?.scrollTop ?? 0), 390, 100);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(TaskMonthView, { tasks, countdowns: [countdown], onDateClick, onTaskClick, onRescheduleTask }));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const heading = () => container.querySelector("h2")!.textContent;
  const mobile = () => container.querySelector<HTMLElement>('[data-calendar-surface="mobile-month"]')!;
  const mini = () => container.querySelector<HTMLElement>('[data-calendar-surface="mini-month"]')!;
  const list = () => mobile().querySelector<HTMLElement>("[data-calendar-agenda]")!;
  const cell = (key: string) => mini().querySelector<HTMLButtonElement>(`[data-mini-month-day="${key}"]`);
  const section = (key: string) => mobile().querySelector<HTMLElement>(`[data-agenda-day="${key}"]`);
  const sectionKeys = () => Array.from(mobile().querySelectorAll("[data-agenda-day]")).map((node) => node.getAttribute("data-agenda-day"));
  const buttonWithText = (scope: ParentNode, text: string) =>
    Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === text)!;

  function click(node: Element) {
    act(() => node.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  }
  function press(key: string) {
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
  }
  function pointer(node: Element, type: string, x: number, y: number, pointerType = "touch") {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: pointerType } });
      node.dispatchEvent(event);
    });
  }
  function swipe(node: Element, points: Array<[number, number]>, pointerType = "touch") {
    const [first, ...rest] = points;
    pointer(node, "pointerdown", first[0], first[1], pointerType);
    for (const [x, y] of rest) pointer(node, "pointermove", x, y, pointerType);
    const last = points[points.length - 1];
    pointer(node, "pointerup", last[0], last[1], pointerType);
  }

  it("迷你月历：周一开头、紧凑行数、今天与选中标识、任务/倒数日圆点、补位日期淡化无圆点", () => {
    const grid = mini();
    expect(grid.getAttribute("role")).toBe("group");
    expect(grid.getAttribute("aria-label")).toBe("2026年10月月历");
    expect(grid.textContent!.startsWith("一二三四五六日")).toBe(true);
    const cells = grid.querySelectorAll("[data-mini-month-day]");
    expect(cells).toHaveLength(35);
    expect(cells[0].getAttribute("data-mini-month-day")).toBe("2026-8-28");
    expect(cells[0].className).toContain("text-muted-foreground");
    expect(cells[0].querySelector("[data-marker]")).toBeNull();
    expect(cells[34].getAttribute("data-mini-month-day")).toBe("2026-10-1");

    const today = cell("2026-9-19")!;
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(today.getAttribute("aria-pressed")).toBe("true");
    expect(today.getAttribute("aria-label")).toBe("10月19日 周一，今天，1 个任务");
    expect(today.querySelector('[data-marker="task"]')).not.toBeNull();
    expect(today.querySelector("span")!.className).toContain("bg-primary");

    expect(cell("2026-9-1")!.querySelector('[data-marker="task"]')).not.toBeNull();
    expect(cell("2026-9-22")!.querySelector('[data-marker="task"]')).not.toBeNull();
    expect(cell("2026-9-25")!.querySelector('[data-marker="countdown"]')).not.toBeNull();
    expect(cell("2026-9-25")!.getAttribute("aria-label")).toBe("10月25日 周日，1 个倒数日");
    expect(cell("2026-9-5")!.querySelector("[data-marker]")).toBeNull();
    for (const node of cells) expect(node.className).toContain("min-h-11");

    // 桌面月网格的测试与 e2e 按这些选择器取元素，手机面不能撞上。
    expect(mobile().querySelector('[role="grid"], [role="row"], [role="gridcell"], button.absolute, [data-countdown-surface]')).toBeNull();
    expect(Array.from(mobile().querySelectorAll("[aria-label]")).some((node) => node.getAttribute("aria-label")!.startsWith("查看 "))).toBe(false);
  });

  it("议程：按日期排序，含跨月延续与跨天后续天、仅倒数日日期、今天徽标，并初始滚到今天", () => {
    expect(sectionKeys()).toEqual(["2026-9-1", "2026-9-2", "2026-9-19", "2026-9-21", "2026-9-22", "2026-9-23", "2026-9-25"]);
    expect(section("2026-9-1")!.textContent).toContain("跨天 · 第 3/4 天");
    expect(section("2026-9-2")!.querySelector('[data-agenda-span="continued"]')!.textContent).toContain("第 4/4 天");
    expect(section("2026-9-21")!.textContent).toContain("10:00 · 共 3 天");
    expect(section("2026-9-21")!.querySelector('[data-agenda-span="continued"]')).toBeNull();
    expect(section("2026-9-19")!.getAttribute("data-agenda-today")).toBe("true");
    expect(section("2026-9-19")!.textContent).toContain("今天");
    expect(section("2026-9-19")!.textContent).toContain("改期");
    expect(section("2026-9-21")!.getAttribute("data-agenda-today")).toBeNull();
    expect(section("2026-9-25")!.querySelector('button[aria-label="倒数日 · 发布日"]')).not.toBeNull();
    expect(section("2026-9-25")!.textContent).not.toContain("改期");
    expect(list().scrollTop).toBe(1900);

    click(section("2026-9-19")!.querySelector("button[data-recurring-projection], button.min-w-0")!);
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(tasks[1]);
  });

  it("点迷你月历空日：选中切换、议程按顺序插入空态行并滚到它、「添加任务」带该日", () => {
    click(cell("2026-9-27")!);
    expect(cell("2026-9-27")!.getAttribute("aria-pressed")).toBe("true");
    expect(cell("2026-9-19")!.getAttribute("aria-pressed")).toBe("false");
    expect(cell("2026-9-19")!.getAttribute("aria-current")).toBe("date");
    expect(cell("2026-9-19")!.querySelector("span")!.className).toContain("ring-primary");
    expect(sectionKeys()).toEqual(["2026-9-1", "2026-9-2", "2026-9-19", "2026-9-21", "2026-9-22", "2026-9-23", "2026-9-25", "2026-9-27"]);
    const empty = section("2026-9-27")!;
    expect(empty.textContent).toContain("这一天没有安排");
    expect(list().scrollTop).toBe(2700);
    click(buttonWithText(empty, "添加任务"));
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(new Date(2026, 9, 27), undefined, expect.objectContaining({ focusTarget: expect.any(HTMLElement) }));

    click(cell("2026-9-19")!);
    expect(list().scrollTop).toBe(1900);
    expect(section("2026-9-27")).toBeNull();
    expect(heading()).toBe("2026年10月");
  });

  it("点相邻月补位日期切到那个月并选中它；整月为空时仍列出该天空态行并提示整月为空", () => {
    click(cell("2026-10-1")!);
    expect(heading()).toBe("2026年11月");
    expect(mini().getAttribute("aria-label")).toBe("2026年11月月历");
    expect(cell("2026-10-1")!.getAttribute("aria-pressed")).toBe("true");
    expect(sectionKeys()).toEqual(["2026-10-1"]);
    expect(section("2026-10-1")!.textContent).toContain("这一天没有安排");
    expect(mobile().textContent).toContain("本月还没有已排期任务或倒数日");
    click(buttonWithText(section("2026-10-1")!, "添加任务"));
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(new Date(2026, 10, 1), undefined, expect.objectContaining({ focusTarget: expect.any(HTMLElement) }));
  });

  it("翻到空月份：选中日与添加日保留同号，议程滚到所选日", () => {
    click(container.querySelector('button[aria-label="下一页"]')!);
    expect(heading()).toBe("2026年11月");
    expect(mobile().textContent).toContain("本月还没有已排期任务或倒数日");
    expect(sectionKeys()).toEqual(["2026-10-19"]);
    click(buttonWithText(mobile(), "添加任务"));
    expect(onDateClick).toHaveBeenCalledExactlyOnceWith(new Date(2026, 10, 19), undefined, expect.objectContaining({ focusTarget: expect.any(HTMLElement) }));
    expect(list().scrollTop).toBe(1900);
  });

  it("添加事件与手机 n、议程添加使用同一个所选日，弹层打开时不重复创建", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 767px)" }));
    const trigger = document.createElement("button"); document.body.appendChild(trigger);
    const add = () => act(() => { window.dispatchEvent(new CustomEvent("organize:calendar-create", { detail: { focusTarget: trigger } })); });
    add();
    expect(onDateClick.mock.calls[0]).toEqual([new Date(2026, 9, 19), undefined, expect.objectContaining({ focusTarget: trigger })]);
    click(cell("2026-9-25")!);
    add();
    expect(onDateClick.mock.calls[1][0]).toEqual(new Date(2026, 9, 25));
    press("n");
    expect(onDateClick.mock.calls[2][0]).toEqual(new Date(2026, 9, 25));
    click(buttonWithText(container, "周"));
    add();
    expect(onDateClick.mock.calls[3][0]).toEqual(new Date(2026, 9, 25));
    click(buttonWithText(container, "日"));
    add();
    expect(onDateClick.mock.calls[4][0]).toEqual(new Date(2026, 9, 25));
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); document.body.appendChild(dialog);
    add();
    expect(onDateClick).toHaveBeenCalledTimes(5);
    dialog.remove(); trigger.remove(); vi.unstubAllGlobals();
  });

  it("翻月钳制到月末，返回当月的选中、高亮、添加与滚动都回今天", () => {
    click(cell("2026-9-31")!);
    click(container.querySelector('button[aria-label="下一页"]')!);
    expect(cell("2026-10-30")!.getAttribute("aria-pressed")).toBe("true");
    click(buttonWithText(section("2026-10-30")!, "添加任务"));
    expect(onDateClick.mock.calls[0][0]).toEqual(new Date(2026, 10, 30));
    swipe(mini(), [[100, 100], [200, 100]]);
    expect(cell("2026-9-19")!.getAttribute("aria-pressed")).toBe("true");
    expect(list().scrollTop).toBe(1900);
    click(section("2026-9-19")!.querySelector("button")!);
    expect(onDateClick.mock.calls[1][0]).toEqual(new Date(2026, 9, 19));
  });

  it("「今天」回到当月并重新滚到今天", () => {
    click(container.querySelector('button[aria-label="下一页"]')!);
    click(buttonWithText(container, "今天"));
    expect(heading()).toBe("2026年10月");
    expect(cell("2026-9-19")!.getAttribute("aria-pressed")).toBe("true");
    expect(list().scrollTop).toBe(1900);
  });

  it("迷你月历区左右滑动翻月；纵向手势、位移不足与鼠标都不翻页", () => {
    swipe(mini(), [[200, 100], [160, 103], [120, 106]]);
    expect(heading()).toBe("2026年11月");
    swipe(mini(), [[100, 100], [140, 102], [190, 104]]);
    expect(heading()).toBe("2026年10月");
    swipe(mini(), [[200, 100], [202, 140], [100, 142]]);
    expect(heading()).toBe("2026年10月");
    swipe(mini(), [[200, 100], [160, 100]]);
    expect(heading()).toBe("2026年10月");
    swipe(mini(), [[200, 100], [100, 100]], "mouse");
    expect(heading()).toBe("2026年10月");
    // 一次手势只翻一页
    swipe(mini(), [[300, 100], [200, 100], [60, 100]]);
    expect(heading()).toBe("2026年11月");
    expect(onDateClick).not.toHaveBeenCalled();
  });

  it("周视图日期条：圆点覆盖跨天与倒数日、今天标识、滑动翻周且选中日跟随", () => {
    press("w");
    press("t");
    expect(heading()).toBe(weekTitle(at(19)));
    const strip = container.querySelector<HTMLElement>('[data-calendar-surface="mobile-week"]')!;
    const days = Array.from(strip.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(days).toHaveLength(7);
    expect(days[0].getAttribute("aria-current")).toBe("date");
    expect(days[0].getAttribute("aria-pressed")).toBe("true");
    expect(days[0].getAttribute("aria-label")).toBe("10月19日 周一，今天，1 个任务");
    expect(days[0].querySelector('[data-marker="task"]')).not.toBeNull();
    expect(days[3].querySelector('[data-marker="task"]')).not.toBeNull(); // 10/22 被三天任务盖住
    expect(days[6].querySelector('[data-marker="countdown"]')).not.toBeNull(); // 10/25 倒数日
    expect(days[5].querySelector("[data-marker]")).toBeNull();
    expect(days[1].getAttribute("aria-current")).toBeNull();
    for (const day of days) expect(day.className).toContain("min-h-11");

    swipe(strip, [[300, 200], [240, 203], [200, 205]]);
    expect(heading()).toBe(weekTitle(at(26)));
    const nextDays = Array.from(strip.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(nextDays[0].getAttribute("aria-pressed")).toBe("true");
    expect(nextDays[0].textContent).toContain("26");
    expect(nextDays.some((day) => day.getAttribute("aria-current") === "date")).toBe(false);
  });

  it("日视图左右滑动翻日，鼠标拖动不翻", () => {
    press("d");
    expect(heading()).toBe(dayTitle(at(19)));
    const surface = container.querySelector<HTMLElement>('[data-calendar-surface="day"]')!;
    swipe(surface, [[300, 300], [240, 302], [200, 304]]);
    expect(heading()).toBe(dayTitle(at(20)));
    swipe(surface, [[100, 300], [200, 302]]);
    expect(heading()).toBe(dayTitle(at(19)));
    swipe(surface, [[300, 300], [100, 300]], "mouse");
    expect(heading()).toBe(dayTitle(at(19)));
    expect(onDateClick).not.toHaveBeenCalled();
  });
});

describe("手机月视图：就地勾选完成与显示选项列布局", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onTaskClick = vi.fn();
  const onToggleTaskDone = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(19, 12));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const proto = HTMLElement.prototype as HTMLElement & {
      hasPointerCapture?: () => boolean;
      setPointerCapture?: () => void;
      releasePointerCapture?: () => void;
    };
    proto.hasPointerCapture ??= () => false;
    proto.setPointerCapture ??= () => {};
    proto.releasePointerCapture ??= () => {};
    onTaskClick.mockReset();
    onToggleTaskDone.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(TaskMonthView, {
        tasks: [mkTask("m1", "手机议程任务", at(19, 9))],
        countdowns: [],
        onTaskClick,
        onToggleTaskDone,
      }));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("议程行方框点击切换完成，不打开任务；键盘 Space 同样切换", () => {
    const surface = container.querySelector<HTMLElement>('[data-calendar-surface="mobile-month"]')!;
    const box = surface.querySelector<HTMLElement>('[data-calendar-task-checkbox]')!;
    expect(box.getAttribute("role")).toBe("checkbox");
    act(() => box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(onToggleTaskDone).toHaveBeenCalledTimes(1);
    expect(onToggleTaskDone.mock.calls[0][0].id).toBe("m1");
    expect(onTaskClick).not.toHaveBeenCalled();
    act(() => box.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
    expect(onToggleTaskDone).toHaveBeenCalledTimes(2);
  });

  it("隐藏周末时迷你月历 5 列工作日、表头无六/日", () => {
    act(() => {
      root.render(createElement(TaskMonthView, {
        tasks: [], countdowns: [], onTaskClick, onToggleTaskDone,
        viewOptions: { showCompleted: true, showCountdowns: true, weekStart: 1, showWeekends: false },
      }));
    });
    const mini = container.querySelector<HTMLElement>('[data-calendar-surface="mini-month"]')!;
    const headerRow = mini.firstElementChild as HTMLElement;
    const labels = Array.from(headerRow.querySelectorAll("span")).map((span) => span.textContent);
    expect(labels).toEqual(["一", "二", "三", "四", "五"]);
    const firstRow = mini.querySelectorAll("div.grid")[1];
    expect(firstRow.className).toContain("grid-cols-5");
    expect(firstRow.querySelectorAll("button")).toHaveLength(5);
  });
});
