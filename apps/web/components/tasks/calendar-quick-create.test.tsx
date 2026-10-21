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
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ list_id: "list", schedule_start_at: at(840).toISOString(), schedule_end_at: at(930).toISOString(), due_date: at(930).toISOString() }));
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
  it("拖选显式 allDay：跨日归一到首日零点与末日 23:59，同日 end=null，不再建成定时", () => {
    const spanning = initialCalendarSchedule({ start: at(0), end: at(2 * 1440), allDay: true });
    expect(spanning).toMatchObject({ all_day: true, schedule_start_at: at(0).toISOString(), schedule_end_at: at(3 * 1440 - 1).toISOString() });
    expect(calendarScheduleLabel(spanning)).toBe("10月21日 – 10月23日 全天");
    // 拖选起点若带时刻也按日历日归一；反向顺序已由调用方排好，这里只认日期。
    expect(initialCalendarSchedule({ start: at(600), end: at(1440 + 30), allDay: true })).toMatchObject({ all_day: true, schedule_start_at: at(0).toISOString(), schedule_end_at: at(2 * 1440 - 1).toISOString() });
    expect(initialCalendarSchedule({ start: at(0), end: at(0), allDay: true })).toMatchObject({ all_day: true, schedule_end_at: null });
    expect(initialCalendarSchedule({ start: at(0), allDay: true })).toMatchObject({ all_day: true, schedule_end_at: null });
    // 显式 allDay=false 可覆盖「零点无 end ⇒ 全天」的格子约定。
    expect(initialCalendarSchedule({ start: at(0), allDay: false })).toMatchObject({ all_day: false, schedule_start_at: at(0).toISOString(), schedule_end_at: at(60).toISOString() });
  });
  it("拖选跨天全天区间打开后预览与保存直接沿用区间", async () => {
    await act(async () => root.render(createElement(CalendarQuickCreate, {
      range: { start: at(0), end: at(2 * 1440), allDay: true, anchor: calendarCreateAnchor(origin, new DOMRect(1200, 800, 150, 80)) },
      supabase, lists: [], defaultListId: null, onClose, onTaskCreated, onCountdownCreated, onPreviewChange,
    })));
    expect(calendarScheduleLabel(mocks.schedule!)).toBe("10月21日 – 10月23日 全天");
    expect(button("10月21日 – 10月23日 全天").getAttribute("aria-label")).toBe("修改日期和时间");
    expect(document.querySelector<HTMLButtonElement>('[data-calendar-quick-create] [role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
    change("出差");
    expect(onPreviewChange).toHaveBeenLastCalledWith({ start: at(0), end: at(3 * 1440 - 1), allDay: true, title: "出差" });
    await act(async () => button("添加").click());
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ all_day: true, schedule_start_at: at(0).toISOString(), schedule_end_at: at(3 * 1440 - 1).toISOString(), due_date: at(3 * 1440 - 1).toISOString() }));
  });
  it("全天区间显示首尾日期，预览与保存归一到本地零点和结束日 23:59；失败保留区间", async () => {
    single.mockResolvedValueOnce({ data: null, error: { message: "网络失败" } });
    await render(); change("出差");
    act(() => mocks.changeSchedule!({ ...mocks.schedule!, all_day: true, schedule_end_at: at(2 * 1440 + 600).toISOString() }));
    expect(calendarScheduleLabel(mocks.schedule!)).toBe("10月21日 – 10月23日 全天");
    expect(onPreviewChange).toHaveBeenLastCalledWith({ start: at(0), end: at(3 * 1440 - 1), allDay: true, title: "出差" });
    await act(async () => button("添加").click());
    const payload = expect.objectContaining({ all_day: true, schedule_start_at: at(0).toISOString(), schedule_end_at: at(3 * 1440 - 1).toISOString(), due_date: at(3 * 1440 - 1).toISOString() });
    expect(insert).toHaveBeenLastCalledWith(payload);
    expect(onClose).not.toHaveBeenCalled();
    expect(calendarScheduleLabel(mocks.schedule!)).toBe("10月21日 – 10月23日 全天");
    await act(async () => button("添加").click());
    expect(insert).toHaveBeenLastCalledWith(payload);
    expect(onTaskCreated).toHaveBeenCalledOnce();
  });
  it.each([null, at(900).toISOString()])("同日全天保存 end=null：%s", async (end) => {
    await render(); change("全天任务");
    act(() => mocks.changeSchedule!({ ...mocks.schedule!, all_day: true, schedule_end_at: end }));
    expect(calendarScheduleLabel(mocks.schedule!)).toBe("10月21日 全天");
    await act(async () => button("添加").click());
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ all_day: true, schedule_start_at: at(0).toISOString(), schedule_end_at: null, due_date: at(0).toISOString() }));
  });
  it("勾选全天归一跨日首尾，取消时保留有效结束；单日取消补一小时", async () => {
    await render();
    const checkbox = () => document.querySelector<HTMLButtonElement>('[data-calendar-quick-create] [role="checkbox"]')!;
    act(() => mocks.changeSchedule!({ ...mocks.schedule!, schedule_end_at: at(2 * 1440 + 600).toISOString() }));
    act(() => checkbox().click());
    expect(mocks.schedule).toMatchObject({ all_day: true, schedule_start_at: at(0).toISOString(), schedule_end_at: at(3 * 1440 - 1).toISOString() });
    act(() => checkbox().click());
    expect(mocks.schedule).toMatchObject({ all_day: false, schedule_end_at: at(3 * 1440 - 1).toISOString() });
    act(() => mocks.changeSchedule!({ ...mocks.schedule!, schedule_start_at: at(840).toISOString(), schedule_end_at: at(930).toISOString() }));
    act(() => checkbox().click());
    expect(mocks.schedule).toMatchObject({ all_day: true, schedule_start_at: at(0).toISOString(), schedule_end_at: null });
    act(() => checkbox().click());
    expect(mocks.schedule).toMatchObject({ all_day: false, schedule_start_at: at(0).toISOString(), schedule_end_at: at(60).toISOString() });
    // 日期弹层同日区间会返回 23:59；取消全天时仍按单日默认时长处理。
    act(() => mocks.changeSchedule!({ ...mocks.schedule!, all_day: true, schedule_end_at: at(1439).toISOString() }));
    act(() => checkbox().click());
    expect(mocks.schedule).toMatchObject({ all_day: false, schedule_end_at: at(60).toISOString() });
  });
  it("全天结束日早于开始禁用添加和更多选项，Enter 也不写入；同日时刻更早有效", async () => {
    await render(); const input = change("出差");
    act(() => mocks.changeSchedule!({ ...mocks.schedule!, all_day: true, schedule_end_at: at(-1).toISOString() }));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("结束日期不能早于开始日期");
    expect(button("添加").disabled).toBe(true);
    expect(button("更多选项").disabled).toBe(true);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(insert).not.toHaveBeenCalled();
    act(() => mocks.changeSchedule!({ ...mocks.schedule!, schedule_end_at: at(1).toISOString() }));
    expect(button("添加").disabled).toBe(false);
  });
});
