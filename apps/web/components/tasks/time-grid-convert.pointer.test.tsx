// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { TimeGridView, weekDaysOf } from "./task-month-view";

// 2026-10-19 是周一：7 列时位于第 0 列。
const day = new Date(2026, 9, 19);
const at = (minutes: number, dayOfMonth = 19) => new Date(2026, 9, dayOfMonth, 0, minutes);
const base: TaskWithTags = {
  id: "task", user_id: "u", title: "已有任务", description: null, status: "todo",
  priority: "medium", category: "work", due_date: at(540).toISOString(),
  schedule_start_at: at(540).toISOString(), schedule_end_at: at(600).toISOString(),
  estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null,
  is_pinned: false, sort_order: 0, completed_at: null, created_at: day.toISOString(), updated_at: day.toISOString(),
};
const timedTask: TaskWithTags = { ...base, all_day: false };
/** 日期选择器「日期」单日模式写出的全天任务：本地 00:00，没有结束。 */
const allDayTask: TaskWithTags = {
  ...base, all_day: true, due_date: at(0).toISOString(),
  schedule_start_at: at(0).toISOString(), schedule_end_at: null,
};

/** grid 顶边 = −200；网格内 clientY = −200 + 分钟 × 56/60；全天行取 −230。 */
const GRID_TOP = -200;
const ALL_DAY_Y = -230;
const gridY = (minutes: number) => GRID_TOP + (minutes / 60) * 56;

describe("时间网格 全天 ↔ 定时 跨区拖拽转换", () => {
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

  function render(days: Date[], tasks: TaskWithTags[]) {
    act(() => root.render(createElement(TimeGridView, {
      days, tasks, countdowns: [], onTaskClick, onUpdateTaskSchedule,
    })));
    const columns = Array.from(container.querySelectorAll<HTMLDivElement>("[data-time-grid-day]"));
    for (const column of columns) {
      vi.spyOn(column, "getBoundingClientRect").mockReturnValue(new DOMRect(48, GRID_TOP, 100, 1344));
    }
    const grid = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue(new DOMRect(0, GRID_TOP, 148, 1500));
    Object.defineProperty(grid, "clientWidth", { value: 148, configurable: true });
    grid.scrollTop = 0;
    for (const element of container.querySelectorAll("[data-time-grid-day], button, [data-resize-edge]")) {
      let captured = false;
      Object.defineProperties(element, {
        setPointerCapture: { value: vi.fn(() => { captured = true; }), configurable: true },
        hasPointerCapture: { value: () => captured, configurable: true },
        releasePointerCapture: { value: vi.fn(() => { captured = false; }), configurable: true },
      });
    }
    const chip = container.querySelector<HTMLButtonElement>('[data-countdown-surface="all-day"] button');
    const block = container.querySelector<HTMLButtonElement>("[data-time-grid-day] button");
    if (block) {
      // 块顶与 09:00 对齐，让抓取偏移为 0，断言的槽位就是指针槽位。
      vi.spyOn(block, "getBoundingClientRect").mockReturnValue(new DOMRect(48, gridY(540), 100, 56));
    }
    return { chip, block, cells: Array.from(container.querySelectorAll<HTMLDivElement>("[data-countdown-date]")) };
  }
  function pointer(element: Element, type: string, clientY: number, x = 60, pointerId = 1) {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY, button: 0 });
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
  const ghost = () => container.querySelector(".-rotate-2");
  const placeholder = () => container.querySelector('[data-drop-placeholder="all-day"]');

  describe("全天 → 定时", () => {
    it("日视图：芯片拖进 10:00 槽位显示 1 小时 ghost，松手写回 all_day=false + 60 分钟，click 不打开详情", () => {
      const { chip, block } = render([day], [allDayTask]);
      expect(chip).not.toBeNull();
      expect(block).toBeNull(); // 全天任务不在网格里
      pointer(chip!, "pointerdown", ALL_DAY_Y);
      expect(chip!.className).toContain("opacity-30");
      pointer(chip!, "pointermove", gridY(600));
      expect(ghost()?.textContent).toContain("10:00 – 11:00");
      expect(placeholder()).toBeNull();
      pointer(chip!, "pointerup", gridY(600));
      expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", {
        schedule_start_at: at(600).toISOString(),
        schedule_end_at: at(660).toISOString(),
        all_day: false,
        timezone: null,
        recurrence_rule: null,
      });
      expect(ghost()).toBeNull();
      click(chip!);
      expect(onTaskClick).not.toHaveBeenCalled();
    });

    it("周视图：从周一芯片拖到周五 10:00 列，落点日随列变化", () => {
      const { chip } = render(weekDaysOf(day), [allDayTask]);
      pointer(chip!, "pointerdown", ALL_DAY_Y);
      pointer(chip!, "pointermove", gridY(600), 110);
      expect(ghost()?.textContent).toContain("周五 10:00 – 11:00");
      pointer(chip!, "pointerup", gridY(600), 110);
      expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
        schedule_start_at: at(600, 23).toISOString(),
        schedule_end_at: at(660, 23).toISOString(),
        all_day: false,
      }));
    });

    it("落在 23:30 时 ghost 与写回都夹到 24:00", () => {
      const { chip } = render([day], [allDayTask]);
      pointer(chip!, "pointerdown", ALL_DAY_Y);
      pointer(chip!, "pointermove", gridY(1410));
      expect(ghost()?.textContent).toContain("23:30 – 24:00");
      pointer(chip!, "pointerup", gridY(1410));
      expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
        schedule_start_at: at(1410).toISOString(),
        schedule_end_at: at(0, 20).toISOString(),
        all_day: false,
      }));
    });

    it("未过跨区阈值：芯片底边往下几像素进入网格不转换，松手仍是点击", () => {
      const { chip } = render([day], [allDayTask]);
      pointer(chip!, "pointerdown", GRID_TOP - 5);
      pointer(chip!, "pointermove", GRID_TOP + 5); // 位移 10px < 14px
      expect(ghost()).toBeNull();
      pointer(chip!, "pointerup", GRID_TOP + 5);
      expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
      click(chip!);
      expect(onTaskClick).toHaveBeenCalledExactlyOnceWith(allDayTask);
    });

    it("过了阈值才换区：同一手势里 10px 不转换、15px 出现 ghost", () => {
      const { chip } = render([day], [allDayTask]);
      pointer(chip!, "pointerdown", GRID_TOP - 5);
      pointer(chip!, "pointermove", GRID_TOP + 5);
      expect(ghost()).toBeNull();
      pointer(chip!, "pointermove", GRID_TOP + 10);
      expect(ghost()).not.toBeNull();
    });

    it("Esc 取消：ghost 消失、不写回、随后 click 不打开详情", () => {
      const { chip } = render([day], [allDayTask]);
      pointer(chip!, "pointerdown", ALL_DAY_Y);
      pointer(chip!, "pointermove", gridY(600));
      expect(ghost()).not.toBeNull();
      escape();
      expect(ghost()).toBeNull();
      expect(chip!.className).not.toContain("opacity-30");
      pointer(chip!, "pointerup", gridY(600));
      expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
      click(chip!);
      expect(onTaskClick).not.toHaveBeenCalled();
    });

    it("全天行里的跨天定时任务拖进网格同样变成 1 小时定时块", () => {
      const spanning: TaskWithTags = {
        ...timedTask,
        schedule_start_at: new Date(2026, 9, 19, 22).toISOString(),
        schedule_end_at: new Date(2026, 9, 21, 2).toISOString(),
      };
      const { chip, block } = render([day], [spanning]);
      expect(block).toBeNull();
      pointer(chip!, "pointerdown", ALL_DAY_Y);
      pointer(chip!, "pointermove", gridY(540));
      pointer(chip!, "pointerup", gridY(540));
      expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
        schedule_start_at: at(540).toISOString(),
        schedule_end_at: at(600).toISOString(),
        all_day: false,
      }));
    });
  });

  describe("定时 → 全天", () => {
    it.each([1, 7])("%i 列：定时块拖进全天行显示虚线占位，松手写回 all_day=true 并归一到落点日 00:00", (count) => {
      const { block, cells } = render(count === 1 ? [day] : weekDaysOf(day), [timedTask]);
      expect(block).not.toBeNull();
      pointer(block!, "pointerdown", gridY(540));
      pointer(block!, "pointermove", ALL_DAY_Y);
      expect(placeholder()?.textContent).toBe("已有任务");
      expect(cells[0].contains(placeholder())).toBe(true);
      expect(cells[0].className).toContain("bg-primary/5");
      expect(ghost()).toBeNull();
      pointer(block!, "pointerup", ALL_DAY_Y);
      expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", {
        schedule_start_at: at(0).toISOString(),
        schedule_end_at: at(0).toISOString(),
        all_day: true,
        timezone: null,
        recurrence_rule: null,
      });
      expect(placeholder()).toBeNull();
      click(block!);
      expect(onTaskClick).not.toHaveBeenCalled();
    });

    it("周视图：拖到周五的全天行，占位出现在周五列并写回周五", () => {
      const { block, cells } = render(weekDaysOf(day), [timedTask]);
      pointer(block!, "pointerdown", gridY(540));
      pointer(block!, "pointermove", ALL_DAY_Y, 110);
      expect(cells[4].contains(placeholder())).toBe(true);
      pointer(block!, "pointerup", ALL_DAY_Y, 110);
      expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
        schedule_start_at: at(0, 23).toISOString(),
        schedule_end_at: at(0, 23).toISOString(),
        all_day: true,
      }));
    });

    it("拖上去再拖回原槽位：占位消失、不写回", () => {
      const { block } = render([day], [timedTask]);
      pointer(block!, "pointerdown", gridY(540));
      pointer(block!, "pointermove", ALL_DAY_Y);
      expect(placeholder()).not.toBeNull();
      pointer(block!, "pointermove", gridY(540));
      expect(placeholder()).toBeNull();
      expect(ghost()).toBeNull();
      pointer(block!, "pointerup", gridY(540));
      expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    });

    it("Esc 取消：占位消失、不写回", () => {
      const { block } = render([day], [timedTask]);
      pointer(block!, "pointerdown", gridY(540));
      pointer(block!, "pointermove", ALL_DAY_Y);
      escape();
      expect(placeholder()).toBeNull();
      pointer(block!, "pointerup", ALL_DAY_Y);
      expect(onUpdateTaskSchedule).not.toHaveBeenCalled();
    });

    it("从 resize 热区拖到全天行只是 resize，不转换", () => {
      render([day], [timedTask]);
      const handle = container.querySelector('[data-resize-edge="end"]')!;
      pointer(handle, "pointerdown", gridY(600));
      pointer(handle, "pointermove", ALL_DAY_Y);
      expect(placeholder()).toBeNull();
      pointer(handle, "pointerup", ALL_DAY_Y);
      expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
        schedule_start_at: at(540).toISOString(),
        schedule_end_at: at(555).toISOString(),
        all_day: false,
      }));
    });
  });

  describe("同区拖拽不回归", () => {
    it("全天芯片改日：目标列出现占位，写回 all_day=true 且时长不变", () => {
      const { chip, cells } = render(weekDaysOf(day), [allDayTask]);
      pointer(chip!, "pointerdown", ALL_DAY_Y);
      pointer(chip!, "pointermove", ALL_DAY_Y, 110);
      expect(cells[4].contains(placeholder())).toBe(true);
      expect(ghost()).toBeNull();
      pointer(chip!, "pointerup", ALL_DAY_Y, 110);
      expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
        schedule_start_at: at(0, 23).toISOString(),
        schedule_end_at: at(0, 23).toISOString(),
        all_day: true,
      }));
    });

    it("定时块改槽位：保持时长、all_day=false，不出现全天占位", () => {
      const { block } = render([day], [timedTask]);
      pointer(block!, "pointerdown", gridY(540));
      pointer(block!, "pointermove", gridY(630));
      expect(ghost()?.textContent).toContain("10:30 – 11:30");
      expect(placeholder()).toBeNull();
      pointer(block!, "pointerup", gridY(630));
      expect(onUpdateTaskSchedule).toHaveBeenCalledExactlyOnceWith("task", expect.objectContaining({
        schedule_start_at: at(630).toISOString(),
        schedule_end_at: at(690).toISOString(),
        all_day: false,
      }));
    });
  });
});
