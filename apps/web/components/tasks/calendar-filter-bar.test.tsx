// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tag } from "@organize/shared";
import { DEFAULT_CALENDAR_TASK_FILTER, type CalendarTaskFilter } from "@/lib/tasks/calendar-filters";
import { CalendarFilterButton, CalendarFilterChips, CalendarFilterEmptyHint } from "./calendar-filter-bar";

/** 筛选按钮弹层 / 条件 chip 行 / 空结果轻提示的展示与变更上报（状态由页面层持有）。 */
describe("CalendarFilterBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn();
  const onClear = vi.fn();

  const tags: Pick<Tag, "id" | "name" | "color">[] = [
    { id: "tag-1", name: "技术", color: "blue" },
    { id: "tag-2", name: "产品", color: "orange" },
  ];

  function filter(patch: Partial<CalendarTaskFilter> = {}): CalendarTaskFilter {
    return { ...DEFAULT_CALENDAR_TASK_FILTER, ...patch };
  }

  function render(node: ReturnType<typeof createElement>) {
    act(() => {
      root.render(node);
    });
  }

  beforeEach(() => {
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
    onChange.mockReset();
    onClear.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("空筛选：按钮无徽标；有条件时显示条数徽标", () => {
    render(createElement(CalendarFilterButton, { filter: filter(), tags, onChange }));
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="筛选日历任务"]')!;
    expect(button).toBeTruthy();
    expect(button.textContent).not.toMatch(/\d/);

    render(createElement(CalendarFilterButton, { filter: filter({ tagIds: ["tag-1"], priorities: ["high"], query: "x" }), tags, onChange }));
    expect(button.textContent).toContain("3");
  });

  it("弹层：关键词输入 / 优先级切换 / 标签多选都上报 onChange", () => {
    render(createElement(CalendarFilterButton, { filter: filter(), tags, onChange }));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="筛选日历任务"]')!;
    act(() => {
      trigger.click();
    });

    const keyword = document.body.querySelector<HTMLInputElement>('input[aria-label="按关键词筛选"]')!;
    expect(keyword).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(keyword, "周报");
      keyword.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith(filter({ query: "周报" }));

    const priorityGroup = document.body.querySelector('[role="group"][aria-label="按优先级筛选"]')!;
    const high = Array.from(priorityGroup.querySelectorAll("button")).find((item) => item.textContent === "高")!;
    act(() => {
      high.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(filter({ priorities: ["high"] }));
    expect(high.getAttribute("aria-pressed")).toBe("false");

    const tagGroup = document.body.querySelector('[role="group"][aria-label="按标签筛选"]')!;
    const tech = Array.from(tagGroup.querySelectorAll("button")).find((item) => item.textContent?.includes("技术"))!;
    act(() => {
      tech.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(filter({ tagIds: ["tag-1"] }));
  });

  it("弹层内「清除筛选」回到默认；无条件时禁用", () => {
    render(createElement(CalendarFilterButton, { filter: filter({ tagIds: ["tag-1"] }), tags, onChange }));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="筛选日历任务"]')!;
    act(() => {
      trigger.click();
    });
    const clear = Array.from(document.body.querySelectorAll("button")).find((item) => item.textContent === "清除筛选")!;
    expect(clear.disabled).toBe(false);
    act(() => {
      clear.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_CALENDAR_TASK_FILTER);
  });

  it("chips：空筛选不渲染；生效时逐条件渲染并可 × 移除", () => {
    render(createElement(CalendarFilterChips, { filter: filter(), tags, onChange, onClear }));
    expect(container.querySelector('[aria-label="当前筛选条件"]')).toBeNull();

    const activeFilter = filter({ tagIds: ["tag-1", "tag-2"], priorities: ["high"], query: " 周报 " });
    render(createElement(CalendarFilterChips, { filter: activeFilter, tags, onChange, onClear }));
    const group = container.querySelector('[aria-label="当前筛选条件"]')!;
    expect(group.textContent).toContain("技术");
    expect(group.textContent).toContain("产品");
    expect(group.textContent).toContain("优先级：高");
    expect(group.textContent).toContain("关键词：周报");

    act(() => {
      group.querySelector<HTMLButtonElement>('button[aria-label="移除筛选条件：标签 技术"]')!.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(filter({ ...activeFilter, tagIds: ["tag-2"] }));

    act(() => {
      group.querySelector<HTMLButtonElement>('button[aria-label="移除筛选条件：优先级 高"]')!.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(filter({ ...activeFilter, priorities: [] }));

    act(() => {
      group.querySelector<HTMLButtonElement>('button[aria-label="移除筛选条件：关键词 周报"]')!.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(filter({ ...activeFilter, query: "" }));

    act(() => {
      Array.from(group.querySelectorAll("button")).find((item) => item.textContent === "清除筛选")!.click();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("已删除标签不渲染 chip（页面层剔除前的兜底）", () => {
    render(createElement(CalendarFilterChips, { filter: filter({ tagIds: ["gone"] }), tags, onChange, onClear }));
    const group = container.querySelector('[aria-label="当前筛选条件"]')!;
    expect(group.textContent).not.toContain("gone");
  });

  it("空结果轻提示：文案与清除动作", () => {
    render(createElement(CalendarFilterEmptyHint, { onClear }));
    const hint = container.querySelector('[role="status"]')!;
    expect(hint.textContent).toContain("当前筛选下没有任务");
    act(() => {
      hint.querySelector("button")!.click();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
