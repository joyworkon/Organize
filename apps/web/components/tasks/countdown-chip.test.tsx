// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { CountdownDay } from "@organize/shared";
import { TaskMonthView } from "./task-month-view";
import { PromptHost } from "@/components/ui/prompt-dialog";

vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));
const item: CountdownDay = { id: "c1", user_id: "u", title: "发布日", target_date: "2020-10-19", repeat_annually: true, deleted_at: null, created_at: "", updated_at: "" };

describe("日历倒数日查看、编辑、删除与指针交互", () => {
  let container: HTMLDivElement;
  let root: Root;
  const update = vi.fn().mockResolvedValue(true);
  const remove = vi.fn().mockResolvedValue(true);
  const create = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    if (!globalThis.PointerEvent) (globalThis as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    update.mockReset().mockResolvedValue(true);
    remove.mockReset().mockResolvedValue(true);
    create.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement("div", null,
      createElement(TaskMonthView, { tasks: [], countdowns: [item, { ...item, id: "c2", title: "生日" }], onUpdateCountdown: update, onDeleteCountdown: remove, onDateClick: create }), createElement(PromptHost))));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const chip = () => container.querySelector<HTMLButtonElement>('[role="gridcell"] button[aria-label="倒数日 · 发布日"]')!;
  const peek = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1)!;
  const button = (text: string, scope: ParentNode = peek()) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((el) => el.textContent === text)!;
  async function click(el: HTMLElement) { await act(async () => el.click()); }
  function change(input: HTMLInputElement, value: string) {
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  function pointer(el: HTMLElement, type: string, x: number, y: number, id = 1) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true } });
    el.dispatchEvent(event);
  }
  function layout() {
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-countdown-surface="month"] [data-countdown-date]'));
    cells.forEach((cell, i) => vi.spyOn(cell, "getBoundingClientRect").mockReturnValue(new DOMRect((i % 7) * 100, Math.floor(i / 7) * 100, 100, 100)));
    return cells;
  }
  it("点击显示天数/日期/每年重复，Escape 关闭并回焦点，不新建", async () => {
    const trigger = chip();
    trigger.focus();
    expect(trigger.tabIndex).toBe(0);
    await click(trigger);
    expect(peek().textContent).toContain("今天");
    expect(peek().textContent).toContain("2020年10月19日");
    expect(peek().textContent).toContain("本年度日期：2026年10月19日");
    expect(peek().querySelector("a")?.getAttribute("href")).toBe("/tasks/countdown");
    act(() => peek().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(create).not.toHaveBeenCalled();
  });
  it("编辑保存采用共享字段，失败保留输入，再次保存成功", async () => {
    update.mockResolvedValueOnce(false);
    await click(chip()); await click(button("编辑"));
    const inputs = Array.from(peek().querySelectorAll<HTMLInputElement>("input"));
    change(inputs[0], "新发布日"); change(inputs[1], "2028-02-29");
    await click(button("保存"));
    expect(update).toHaveBeenCalledWith("c1", { title: "新发布日", target_date: "2028-02-29", repeat_annually: true });
    expect(peek().querySelector("input")?.value).toBe("新发布日");
    await click(button("保存"));
    expect(peek().querySelector("input")).toBeNull();
  });
  it("删除弹应用内确认，取消不删除；失败仍保留查看弹层", async () => {
    await click(chip()); await click(button("删除"));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await click(button("取消"));
    expect(remove).not.toHaveBeenCalled();
    remove.mockResolvedValueOnce(false);
    await click(button("删除")); await click(button("移入垃圾箱"));
    expect(remove).toHaveBeenCalledWith("c1");
    expect(peek().textContent).toContain("发布日");
    await click(button("删除")); await click(button("移入垃圾箱"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("短距离点按仍打开；拖拽跨周命中并高亮，保留年份，吞后续点击", async () => {
    const cells = layout(); const trigger = chip();
    act(() => { pointer(trigger, "pointerdown", 50, 350); pointer(trigger, "pointerup", 52, 352); });
    await click(trigger);
    expect(update).not.toHaveBeenCalled();
    act(() => peek().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    act(() => { pointer(trigger, "pointerdown", 50, 350); pointer(trigger, "pointermove", 350, 450); });
    expect(cells.find((cell) => cell.dataset.countdownDate === "2026-10-29")?.className).toContain("ring-primary");
    await act(async () => pointer(trigger, "pointerup", 350, 450));
    expect(update).toHaveBeenCalledWith("c1", { title: "发布日", target_date: "2020-10-29", repeat_annually: true }, true);
    act(() => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it.each(["pointercancel", "lostpointercapture", "Escape"])("%s 取消，忽略其它指针并不沿用旧落点", async (type) => {
    layout(); const trigger = chip();
    act(() => { pointer(trigger, "pointerdown", 50, 350); pointer(trigger, "pointermove", 350, 450, 2); });
    expect(container.querySelector(".ring-primary")).toBeNull();
    act(() => pointer(trigger, "pointermove", 350, 450));
    act(() => type === "Escape" ? trigger.dispatchEvent(new KeyboardEvent("keydown", { key: type, bubbles: true, cancelable: true })) : pointer(trigger, type, 350, 450));
    await act(async () => pointer(trigger, "pointerup", 350, 450));
    expect(update).not.toHaveBeenCalled();
    expect(container.querySelector(".ring-primary")).toBeNull();
  });
  it("当天弹层里可再点倒数日，嵌套 Esc 只关闭查看弹层", async () => {
    await click(container.querySelector<HTMLElement>('[aria-label="查看 10月19日 全部 2 项"]')!);
    const parent = peek();
    const nested = parent.querySelector<HTMLButtonElement>('[aria-label="倒数日 · 生日"]')!;
    await click(nested);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    act(() => peek().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(nested);
  });
  it.each(["周视图（w）", "日视图（d）"])("%s 全天行能打开倒数日并拖拽", async (title) => {
    await click(container.querySelector<HTMLElement>(`button[title="${title}"]`)!);
    await click(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((el) => el.textContent === "今天")!);
    const surface = container.querySelector<HTMLElement>('[data-countdown-surface="all-day"]')!;
    const cells = Array.from(surface.querySelectorAll<HTMLElement>('[data-countdown-date]'));
    cells.forEach((cell, i) => vi.spyOn(cell, "getBoundingClientRect").mockReturnValue(new DOMRect(i * 100, 100, 100, 40)));
    const trigger = surface.querySelector<HTMLButtonElement>('[aria-label="倒数日 · 发布日"]')!;
    await click(trigger); expect(peek().textContent).toContain("今天");
    act(() => peek().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    await act(async () => { pointer(trigger, "pointerdown", 50, 120); pointer(trigger, "pointerup", 250, 220); });
    if (cells.length === 7) expect(update).toHaveBeenCalledWith("c1", expect.objectContaining({ target_date: "2020-10-21" }), true);
    else expect(update).not.toHaveBeenCalled();
  });
});
