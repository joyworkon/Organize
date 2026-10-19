// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "./page";
import { layoutDayTimedEvents } from "@/components/tasks/task-month-view";
import type { TaskWithTags } from "@organize/shared";

const mocks = vi.hoisted(() => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn().mockResolvedValue({ data: [], error: null }), insert };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    insert, supabase: { from: vi.fn().mockReturnValue(query), auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u" } } }) } },
    refetch: vi.fn(), params: new URLSearchParams(), tasks: [],
    clickDate: undefined as ((start: Date, end?: Date) => void) | undefined,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => mocks.params }));
vi.mock("@/lib/tasks/workspace", () => ({
  useTaskWorkspaceData: () => ({ tasks: mocks.tasks, loading: false, refetch: mocks.refetch, supabase: mocks.supabase }),
  filterTasksByScope: (tasks: unknown[]) => tasks,
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/tasks/task-month-view", async (original) => ({
  ...await original<typeof import("@/components/tasks/task-month-view")>(),
  TaskMonthView: ({ onDateClick }: { onDateClick: typeof mocks.clickDate }) => {
    mocks.clickDate = onDateClick;
    return null;
  },
}));

const at = (minutes: number) => new Date(2026, 9, 19, 0, minutes);

describe("日历添加起止表单", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.insert.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(CalendarPage)));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const dialog = () => document.querySelector('[role="dialog"]')!;
  const inputs = () => Array.from(dialog().querySelectorAll<HTMLInputElement>('input[type="time"]'));
  function button(text: string) {
    return Array.from(dialog().querySelectorAll("button")).find((item) => item.textContent === text)!;
  }
  function change(input: HTMLInputElement, value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function open(start: Date, end?: Date) {
    await act(async () => mocks.clickDate!(start, end));
    change(dialog().querySelector('input:not([type="time"])')!, "拖选任务");
  }

  it.each([[540, 630], [0, 15], [1425, 1440]])("预填 %i–%i，保存精确起止并按时长布局", async (start, end) => {
    await open(at(start), at(end));
    const clock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    expect(inputs().map((input) => input.value)).toEqual([clock(start), clock(end)]);
    if (end === 1440) expect(dialog().textContent).toContain("结束（次日）");
    await act(async () => button("添加").click());
    const payload = mocks.insert.mock.calls[0][0];
    expect(payload).toMatchObject({ schedule_start_at: at(start).toISOString(), schedule_end_at: at(end).toISOString(), due_date: at(start).toISOString(), all_day: false });
    expect(layoutDayTimedEvents([payload as TaskWithTags], at(0))).toMatchObject([{ startMin: start, endMin: end }]);
  });
  it("普通日期入口默认 09:00–10:00，重复与 tab 使用共享可访问控件", async () => {
    await open(at(0));
    expect(inputs().map((input) => input.value)).toEqual(["09:00", "10:00"]);
    expect(button("任务").getAttribute("aria-pressed")).toBe("true");
    expect(button("倒数日").getAttribute("aria-pressed")).toBe("false");
    expect(dialog().querySelector('[role="combobox"]')?.className).toContain("border-input");
  });
  it.each(["09:00", "08:45", ""])("结束 %s 不可提交，修复后可添加", async (value) => {
    await open(at(540), at(630));
    change(inputs()[1], value);
    expect(button("添加").disabled).toBe(true);
    expect(inputs()[1].getAttribute("aria-invalid")).toBe("true");
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(value ? "结束时间需晚于开始时间" : "请填写开始和结束时间");
    await act(async () => button("添加").click());
    expect(mocks.insert).not.toHaveBeenCalled();
    change(inputs()[1], "10:30");
    expect(button("添加").disabled).toBe(false);
  });
  it("全天忽略时间错误，仍保存零点开始和 null 结束", async () => {
    await open(at(540), at(630));
    change(inputs()[1], "08:00");
    act(() => (dialog().querySelector('[role="checkbox"]') as HTMLButtonElement).click());
    expect(inputs()).toHaveLength(0);
    await act(async () => button("添加").click());
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ schedule_start_at: at(0).toISOString(), schedule_end_at: null, due_date: at(0).toISOString(), all_day: true }));
  });
  it("倒数日切换保留原保存合同，不受任务时间校验影响", async () => {
    await open(at(540), at(630));
    change(inputs()[1], "08:00");
    act(() => button("倒数日").click());
    expect(button("倒数日").getAttribute("aria-pressed")).toBe("true");
    expect(button("任务").getAttribute("aria-pressed")).toBe("false");
    await act(async () => button("添加").click());
    expect(mocks.insert).toHaveBeenCalledWith({ user_id: "u", title: "拖选任务", target_date: "2026-10-19", repeat_annually: false });
  });
});
