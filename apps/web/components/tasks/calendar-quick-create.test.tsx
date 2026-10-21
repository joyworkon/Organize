// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarQuickCreate, calendarCreateAnchor, initialCalendarSchedule, calendarScheduleLabel } from "./calendar-quick-create";
import type { useTaskWorkspaceData } from "@/lib/tasks/workspace";

const at = (minutes: number) => new Date(2026, 9, 21, 0, minutes);
const mocks = vi.hoisted(() => ({ schedule: undefined as import("./task-date-picker").TaskSchedule | undefined, changeSchedule: undefined as ((schedule: import("./task-date-picker").TaskSchedule) => void) | undefined }));
vi.mock("./task-date-popover", () => ({ TaskDatePopover: ({ value, onChange, trigger }: { value: import("./task-date-picker").TaskSchedule; onChange: typeof mocks.changeSchedule; trigger: import("react").ReactNode }) => { mocks.schedule = value; mocks.changeSchedule = onChange; return trigger; } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

describe("CalendarQuickCreate", () => {
  let root: Root;
  let container: HTMLDivElement;
  let origin: HTMLButtonElement;
  const onClose = vi.fn();
  const onTaskCreated = vi.fn();
  const onCountdownCreated = vi.fn();
  const onPreviewChange = vi.fn();
  const single = vi.fn();
  const insert = vi.fn(() => ({ select: () => ({ single }) }));
  const supabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u" } } }) }, from: vi.fn(() => ({ insert })) } as unknown as ReturnType<typeof useTaskWorkspaceData>["supabase"];

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: "new", title: "会议" }, error: null });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    origin = document.createElement("button"); document.body.appendChild(origin); origin.focus();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); origin.remove(); vi.unstubAllGlobals(); });
  async function render(anchor = true) {
    await act(async () => root.render(createElement(CalendarQuickCreate, {
      range: { start: at(840), end: at(930), anchor: anchor ? calendarCreateAnchor(origin, new DOMRect(1200, 800, 150, 80)) : undefined },
      supabase, lists: [], defaultListId: "list", onClose, onTaskCreated, onCountdownCreated, onPreviewChange,
    })));
  }
  function change(value: string) {
    const input = document.querySelector<HTMLInputElement>('[data-calendar-quick-create] input')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    return input;
  }
  const button = (text: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === text)!;

  it("桌面使用虚拟锚点，缺失时降级视口中央并自动聚焦标题", async () => {
    await render(false);
    expect(document.querySelector('[data-calendar-create-placement="center"]')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-calendar-quick-create] input'));
    expect(calendarCreateAnchor(origin, new DOMRect(12, 34, 56, 78))).toEqual({ focusTarget: origin, rect: { x: 12, y: 34, width: 56, height: 78 } });
  });
  it("Enter 保存精确范围，输入实时更新占位；重复 Enter 不重复插入", async () => {
    await render();
    const input = change("会议");
    expect(onPreviewChange).toHaveBeenLastCalledWith({ start: at(840), end: at(930), allDay: false, title: "会议" });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ list_id: "list", schedule_start_at: at(840).toISOString(), schedule_end_at: at(930).toISOString() }));
    expect(onTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }), false);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("保存失败不插入本地事件，保留标题/时间和错误，重试可用", async () => {
    single.mockResolvedValueOnce({ data: null, error: { message: "网络失败" } });
    await render(); const input = change("会议");
    await act(async () => button("添加").click());
    expect(onTaskCreated).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    expect(input.value).toBe("会议"); expect(document.querySelector('[role="alert"]')?.textContent).toBe("网络失败");
    expect(mocks.schedule?.schedule_start_at).toBe(at(840).toISOString());
    await act(async () => button("添加").click());
    expect(onTaskCreated).toHaveBeenCalledOnce();
  });
  it("更多选项仅在保存成功后打开详情", async () => {
    await render(); change("会议");
    await act(async () => button("更多选项").click());
    expect(onTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }), true);
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])("IME Enter 不提交：%j", async (options) => {
    await render(); const input = change("会议");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...options })));
    expect(insert).not.toHaveBeenCalled();
  });
  it("Esc 关闭后恢复原格子的焦点", async () => {
    await render();
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(document.activeElement).toBe(origin);
  });
  it("接受日期编辑后占位跟随，结束早于开始不能保存", async () => {
    await render(); change("会议");
    act(() => mocks.changeSchedule!({ ...mocks.schedule!, schedule_end_at: at(830).toISOString() }));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("结束时间需晚于开始时间");
    expect(button("添加").disabled).toBe(true);
    act(() => mocks.changeSchedule!({ ...mocks.schedule!, schedule_start_at: at(900).toISOString(), schedule_end_at: at(990).toISOString() }));
    expect(onPreviewChange).toHaveBeenLastCalledWith({ start: at(900), end: at(990), allDay: false, title: "会议" });
    expect(button("添加").disabled).toBe(false);
  });
  it("手机使用底部 Dialog，安全区和可用高度受限", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    await render();
    const dialog = document.querySelector<HTMLElement>('.organize-dialog-content')!;
    expect(dialog.style.bottom).toBe("0px"); expect(dialog.style.top).toBe("auto"); expect(dialog.style.transform).toBe("none");
  });
  it("月格默认全天；显式午夜范围和次日结束不丢失", () => {
    expect(initialCalendarSchedule({ start: at(0) }).all_day).toBe(true);
    expect(initialCalendarSchedule({ start: at(0), end: at(15) }).all_day).toBe(false);
    expect(calendarScheduleLabel(initialCalendarSchedule({ start: at(1425), end: at(1440) }))).toContain("10月22日 00:00");
  });
});
