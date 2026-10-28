// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CountdownDay, TaskWithTags } from "@organize/shared";
import { CalendarJumpDate } from "./calendar-jump-date";

/**
 * 「跳转到日期」面板：迷你月历起步 / 圆点口径 / 翻月与补位日 /
 * 年模式先选年月 / 方向键（隐藏周末跳过）。jsdom 无 matchMedia → 走桌面 Popover 分支。
 * 注意 calendarDayKey 的月份是 0 起：2026 年 10 月的键为 2026-9-x，11 月为 2026-10-x。
 */

function taskOn(day: number): TaskWithTags {
  const start = new Date(2026, 9, day, 12);
  return {
    id: `t-${day}`, user_id: "u1", title: `任务${day}`, description: null, status: "todo",
    priority: "medium", category: "work", due_date: null, estimated_minutes: null, actual_minutes: null,
    reading_item_id: null, note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
    created_at: start.toISOString(), updated_at: start.toISOString(), schedule_start_at: start.toISOString(),
  };
}

function countdownOn(day: number): CountdownDay {
  return {
    id: `c-${day}`, user_id: "u1", title: `倒数日${day}`, target_date: `2026-10-${String(day).padStart(2, "0")}`,
    repeat_annually: false, deleted_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  };
}

type JumpProps = ComponentProps<typeof CalendarJumpDate>;

const BASE_PROPS: JumpProps = {
  open: true,
  onOpenChange: () => {},
  mode: "month",
  cursor: new Date(2026, 9, 1),
  today: new Date(2026, 9, 21, 12),
  selectedDate: new Date(2026, 9, 21),
  weekStart: 1,
  showWeekends: true,
  tasks: [taskOn(22)],
  countdowns: [countdownOn(24)],
  onSelectDate: () => {},
  children: "2026年10月",
};

describe("日历「跳转到日期」面板", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const onSelectDate = vi.fn<(date: Date) => void>();

  function mount(overrides: Partial<JumpProps> = {}) {
    act(() => {
      root.render(createElement(CalendarJumpDate, { ...BASE_PROPS, onOpenChange, onSelectDate, ...overrides }));
    });
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onOpenChange.mockReset();
    onSelectDate.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mount();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelector('[role="dialog"]')?.remove();
  });

  const panel = () => document.querySelector<HTMLElement>("[data-calendar-jump-panel]")!;
  const day = (key: string) => document.querySelector<HTMLButtonElement>(`[data-jump-day="${key}"]`);
  const headerLabels = () => Array.from(panel().querySelectorAll(".grid.text-xs span")).map((node) => node.textContent);

  function click(node: HTMLButtonElement | null) {
    expect(node).not.toBeNull();
    act(() => node!.click());
  }

  function key(target: HTMLElement, keyValue: string) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: keyValue, bubbles: true, cancelable: true }));
    });
  }

  it("迷你月历从 cursor 月起步：表头按周一起始含周末（compactMonthRows 裁掉全补位尾行）", () => {
    expect(panel().querySelectorAll("[data-jump-day]")).toHaveLength(35); // 2026-10 占 5 周
    expect(headerLabels().slice(0, 7)).toEqual(["一", "二", "三", "四", "五", "六", "日"]);
    expect(panel().textContent).toContain("2026年10月");
  });

  it("今天有标注、选中日实心，有任务/倒数日的日子带圆点（与手机迷你月历同口径）", () => {
    expect(day("2026-9-21")!.getAttribute("aria-current")).toBe("date");
    expect(day("2026-9-21")!.getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-9-22")!.querySelector("[data-marker='task']")).not.toBeNull();
    expect(day("2026-9-24")!.querySelector("[data-marker='countdown']")).not.toBeNull();
    expect(day("2026-9-25")!.querySelector("[data-marker]")).toBeNull();
  });

  it("翻到下一月后选当月日期，先关面板再回调选日", () => {
    click(panel().querySelector<HTMLButtonElement>('[aria-label="下一月"]'));
    expect(panel().textContent).toContain("2026年11月");
    click(day("2026-10-15"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelectDate).toHaveBeenCalledWith(new Date(2026, 10, 15));
  });

  it("月份标签进入月份阶段；选月后回到天格；年步进换年", () => {
    click(panel().querySelector<HTMLButtonElement>('[aria-label="选择月份"]'));
    const months = Array.from(panel().querySelectorAll<HTMLButtonElement>("[data-jump-month]"));
    expect(months).toHaveLength(12);
    expect(months[9].getAttribute("aria-pressed")).toBe("true"); // 选中日在 10 月
    click(panel().querySelector<HTMLButtonElement>('[aria-label="下一年"]'));
    click(panel().querySelector<HTMLButtonElement>('[data-jump-month="0"]'));
    expect(panel().textContent).toContain("2027年1月");
    expect(day("2027-0-15")).not.toBeNull();
  });

  it("年视图模式直接从月份阶段开始", () => {
    // 面板状态随弹层挂载初始化；换 root 模拟重新打开
    act(() => root.unmount());
    root = createRoot(container);
    mount({ mode: "year" });
    expect(panel().querySelectorAll("[data-jump-month]")).toHaveLength(12);
    expect(panel().querySelectorAll("[data-jump-day]")).toHaveLength(0);
    click(panel().querySelector<HTMLButtonElement>('[data-jump-month="11"]'));
    click(day("2026-11-25"));
    expect(onSelectDate).toHaveBeenCalledWith(new Date(2026, 11, 25));
  });

  it("方向键在日期格间移动，Home 回本周起始", () => {
    const friday = day("2026-9-23")!; // 周五
    friday.focus();
    key(friday, "ArrowRight");
    expect(document.activeElement).toBe(day("2026-9-24"));
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(day("2026-9-31"));
    key(document.activeElement as HTMLElement, "Home");
    expect(document.activeElement).toBe(day("2026-9-26")); // 10-26 周一
  });

  it("隐藏周末时左右移动跳过周末，表头只留工作日 5 列", () => {
    mount({ showWeekends: false });
    expect(panel().querySelectorAll("[data-jump-day]")).toHaveLength(25); // 5 周 × 5 工作日
    expect(headerLabels().slice(0, 5)).toEqual(["一", "二", "三", "四", "五"]);
    const friday = day("2026-9-23")!;
    friday.focus();
    key(friday, "ArrowRight");
    expect(document.activeElement).toBe(day("2026-9-26")); // 跳过周六日到周一
    key(document.activeElement as HTMLElement, "ArrowLeft");
    expect(document.activeElement).toBe(day("2026-9-23"));
  });

  it("周日起始：表头从日开始", () => {
    mount({ weekStart: 0 });
    expect(headerLabels().slice(0, 7)).toEqual(["日", "一", "二", "三", "四", "五", "六"]);
  });
});
