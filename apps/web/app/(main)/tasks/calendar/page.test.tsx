// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "./page";
import { layoutDayTimedEvents } from "@/components/tasks/task-month-view";
import type { CountdownDay, TaskWithTags } from "@organize/shared";

const mocks = vi.hoisted(() => {
  const updateResult = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateResult });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn().mockResolvedValue({ data: [], error: null }), insert, update };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    insert, update, updateResult, query,
    countdowns: [] as import("@organize/shared").CountdownDay[],
    onUpdateCountdown: undefined as ((id: string, patch: import("@/lib/tasks/countdown").CountdownFormValue, optimistic?: boolean) => Promise<boolean>) | undefined,
    onDeleteCountdown: undefined as ((id: string) => Promise<boolean>) | undefined,
    supabase: {
      from: vi.fn().mockReturnValue(query),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u" } } }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "u" } } } }),
      },
    },
    refetch: vi.fn(),
    setTasks: vi.fn(),
    params: new URLSearchParams(),
    tasks: [] as import("@organize/shared").TaskWithTags[],
    push: vi.fn(),
    replace: vi.fn(),
    updateTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    clickDate: undefined as ((start: Date, end?: Date) => void) | undefined,
    onTaskClick: undefined as ((task: { id: string }) => void) | undefined,
    onReschedule: undefined as ((taskId: string, date: Date) => Promise<void>) | undefined,
    onUpdateSchedule: undefined as ((taskId: string, schedule: unknown) => Promise<void>) | undefined,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/tasks/calendar",
  useSearchParams: () => mocks.params,
}));
vi.mock("@/lib/tasks/workspace", () => ({
  useTaskWorkspaceData: () => ({
    tasks: mocks.tasks,
    lists: [],
    dependencies: [],
    loading: false,
    refetch: mocks.refetch,
    setTasks: mocks.setTasks,
    supabase: mocks.supabase,
  }),
  filterTasksByScope: (tasks: unknown[]) => tasks,
}));
vi.mock("@/lib/tasks/use-task-mutations", () => ({
  useTaskMutations: () => ({
    updateTask: mocks.updateTask,
    deleteTask: mocks.deleteTask,
    clearTaskVersions: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/tasks/task-inline-detail", async () => {
  const { createElement } = await import("react");
  return {
    TaskInlineDetail: ({
      task,
      onUpdate,
      onDelete,
      onClose,
      onOpenFullPage,
    }: {
      task: { id: string; title: string };
      onUpdate: (id: string, patch: Record<string, unknown>) => void;
      onDelete: (id: string) => void;
      onClose: () => void;
      onOpenFullPage?: (id: string) => void;
    }) => createElement(
      "aside",
      { className: "organize-task-detail", "aria-label": "任务详情" },
      createElement("h1", null, task.title),
      createElement("button", { type: "button", onClick: onClose }, "关闭"),
      createElement("button", { type: "button", onClick: () => onUpdate(task.id, { title: "新标题" }) }, "改标题"),
      createElement("button", { type: "button", onClick: () => onDelete(task.id) }, "删除"),
      onOpenFullPage ? createElement("button", { type: "button", onClick: () => onOpenFullPage(task.id) }, "打开完整页面") : null,
    ),
  };
});
vi.mock("@/components/tasks/task-month-view", async (original) => ({
  ...await original<typeof import("@/components/tasks/task-month-view")>(),
  TaskMonthView: ({
    onDateClick,
    onTaskClick,
    onRescheduleTask,
    onUpdateTaskSchedule,
    countdowns, onUpdateCountdown, onDeleteCountdown,
  }: {
    countdowns: CountdownDay[];
    onUpdateCountdown: typeof mocks.onUpdateCountdown;
    onDeleteCountdown: typeof mocks.onDeleteCountdown;
    onDateClick: typeof mocks.clickDate;
    onTaskClick?: typeof mocks.onTaskClick;
    onRescheduleTask?: typeof mocks.onReschedule;
    onUpdateTaskSchedule?: typeof mocks.onUpdateSchedule;
  }) => {
    mocks.countdowns = countdowns;
    mocks.onUpdateCountdown = onUpdateCountdown;
    mocks.onDeleteCountdown = onDeleteCountdown;
    mocks.clickDate = onDateClick;
    mocks.onTaskClick = onTaskClick;
    mocks.onReschedule = onRescheduleTask;
    mocks.onUpdateSchedule = onUpdateTaskSchedule;
    return null;
  },
}));

const at = (minutes: number) => new Date(2026, 9, 19, 0, minutes);

describe("日历添加起止表单", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.params = new URLSearchParams();
    mocks.tasks = [];
    mocks.insert.mockClear();
    mocks.push.mockClear();
    mocks.replace.mockClear();
    mocks.updateTask.mockClear();
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

const peekTask = {
  id: "t1",
  user_id: "u",
  title: "周报",
  description: null,
  status: "todo",
  priority: "medium",
  category: "work",
  due_date: new Date(2026, 9, 19, 9).toISOString(),
  estimated_minutes: null,
  actual_minutes: null,
  reading_item_id: null,
  note_id: null,
  is_pinned: false,
  sort_order: 0,
  completed_at: null,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
  sync_version: 3,
  schedule_start_at: new Date(2026, 9, 19, 9).toISOString(),
  schedule_end_at: new Date(2026, 9, 19, 10).toISOString(),
  deleted_at: null,
  tags: [],
} as TaskWithTags;

describe("日历任务详情面板", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.params = new URLSearchParams();
    mocks.tasks = [];
    mocks.push.mockClear();
    mocks.replace.mockClear();
    mocks.updateTask.mockClear();
    mocks.deleteTask.mockClear();
    mocks.supabase.from.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderPage() {
    await act(async () => { root.render(createElement(CalendarPage)); });
  }

  function replacedUrl() {
    return String(mocks.replace.mock.calls.at(-1)?.[0] ?? "");
  }

  it("点任务写入 ?task= 并打开面板，不跳走", async () => {
    mocks.tasks = [peekTask];
    mocks.params = new URLSearchParams("scope=list&list=abc");
    await renderPage();
    expect(document.querySelector('[aria-label="任务详情"]')).toBeNull();
    await act(async () => { mocks.onTaskClick?.(peekTask); });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(replacedUrl()).toBe("/tasks/calendar?scope=list&list=abc&task=t1");
    mocks.params = new URLSearchParams("scope=list&list=abc&task=t1");
    await renderPage();
    expect(document.querySelector('[aria-label="任务详情"] h1')?.textContent).toBe("周报");
  });

  it("带 ?task= 刷新直接打开，关闭、空白和 Esc 清掉参数", async () => {
    mocks.tasks = [peekTask];
    mocks.params = new URLSearchParams("scope=all&task=t1");
    await renderPage();
    expect(document.querySelector('[aria-label="任务详情"]')).not.toBeNull();

    const close = [...document.querySelectorAll("button")].find((button) => button.textContent === "关闭")!;
    await act(async () => { close.click(); });
    expect(replacedUrl()).toBe("/tasks/calendar?scope=all");

    mocks.replace.mockClear();
    await act(async () => { mocks.clickDate?.(new Date(2026, 9, 20)); });
    expect(replacedUrl()).toBe("/tasks/calendar?scope=all");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    mocks.replace.mockClear();
    const typed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    await act(async () => { window.dispatchEvent(typed); });
    expect(replacedUrl()).toBe("/tasks/calendar?scope=all");

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    mocks.replace.mockClear();
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(mocks.replace).not.toHaveBeenCalled();
    input.remove();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    mocks.replace.mockClear();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(mocks.replace).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("面板里的修改和拖拽改期都走 useTaskMutations", async () => {
    mocks.tasks = [peekTask];
    mocks.params = new URLSearchParams("task=t1");
    await renderPage();
    const rename = [...document.querySelectorAll("button")].find((button) => button.textContent === "改标题")!;
    await act(async () => { rename.click(); });
    expect(mocks.updateTask).toHaveBeenCalledWith("t1", { title: "新标题" });

    await act(async () => { mocks.onReschedule?.("t1", new Date(2026, 9, 21, 9)); });
    expect(mocks.updateTask).toHaveBeenCalledWith("t1", {
      schedule_start_at: new Date(2026, 9, 21, 9).toISOString(),
      schedule_end_at: new Date(2026, 9, 21, 10).toISOString(),
    });
    await act(async () => {
      mocks.onUpdateSchedule?.("t1", {
        schedule_start_at: "2026-10-22T01:00:00.000Z",
        schedule_end_at: "2026-10-22T02:00:00.000Z",
        all_day: false,
        timezone: "Asia/Shanghai",
        recurrence_rule: null,
      });
    });
    expect(mocks.updateTask).toHaveBeenCalledWith("t1", {
      schedule_start_at: "2026-10-22T01:00:00.000Z",
      schedule_end_at: "2026-10-22T02:00:00.000Z",
      all_day: false,
      timezone: "Asia/Shanghai",
      recurrence_rule: null,
    });
    expect(mocks.supabase.from).not.toHaveBeenCalledWith("tasks");

    const openFull = [...document.querySelectorAll("button")].find((button) => button.textContent === "打开完整页面")!;
    await act(async () => { openFull.click(); });
    expect(mocks.push).toHaveBeenCalledWith("/tasks/t1");

    const remove = [...document.querySelectorAll("button")].find((button) => button.textContent === "删除")!;
    await act(async () => { remove.click(); });
    expect(mocks.deleteTask).toHaveBeenCalledWith("t1");
  });
});


describe("日历倒数日持久化与乐观回滚", () => {
  let container: HTMLDivElement;
  let root: Root;
  const original: CountdownDay = { id: "c1", user_id: "u", title: "生日", target_date: "2020-10-19", repeat_annually: true, deleted_at: null, created_at: "", updated_at: "" };
  beforeEach(async () => {
    mocks.params = new URLSearchParams();
    mocks.tasks = [];
    mocks.query.is.mockResolvedValue({ data: [original], error: null });
    mocks.updateResult.mockReset().mockResolvedValue({ error: null });
    mocks.update.mockClear();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(createElement(CalendarPage)));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); mocks.query.is.mockResolvedValue({ data: [], error: null }); });
  it("拖拽立刻改期，失败恢复原日，并广播重载", async () => {
    let finish!: (result: { error: unknown }) => void;
    mocks.updateResult.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const changed = vi.fn(); window.addEventListener("organize:countdown-changed", changed);
    let pending!: Promise<boolean>;
    act(() => { pending = mocks.onUpdateCountdown!("c1", { ...original, target_date: "2020-10-22" }, true); });
    expect(mocks.countdowns[0].target_date).toBe("2020-10-22");
    let duplicate!: boolean;
    await act(async () => { duplicate = await mocks.onUpdateCountdown!("c1", { ...original, target_date: "2020-10-25" }, true); });
    expect(duplicate).toBe(false);
    await act(async () => { finish({ error: { message: "网络故障" } }); expect(await pending).toBe(false); });
    expect(mocks.countdowns).toEqual([original]);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener("organize:countdown-changed", changed);
  });
  it("旧查询不能盖住正在保存的改期；成功后重载最终数据", async () => {
    let finish!: (result: { error: unknown }) => void;
    mocks.updateResult.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const patch = { title: "新生日", target_date: "2020-10-22", repeat_annually: true };
    let pending!: Promise<boolean>;
    act(() => { pending = mocks.onUpdateCountdown!("c1", patch, true); });
    await act(async () => window.dispatchEvent(new CustomEvent("organize:countdown-changed")));
    expect(mocks.countdowns[0]).toMatchObject(patch);
    mocks.query.is.mockResolvedValue({ data: [{ ...original, ...patch }], error: null });
    await act(async () => { finish({ error: null }); expect(await pending).toBe(true); });
    expect(mocks.countdowns[0]).toMatchObject(patch);
    expect(mocks.update).toHaveBeenCalledWith(patch);
  });
  it("真实删除沿用 trash API；失败不移除，成功标签消失", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_BACKEND", "false");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "拒绝删除" }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, affected: 1 })));
    vi.stubGlobal("fetch", fetcher);
    try {
      await act(async () => { expect(await mocks.onDeleteCountdown!("c1")).toBe(false); });
      expect(mocks.countdowns).toEqual([original]);
      mocks.query.is.mockResolvedValue({ data: [], error: null });
      await act(async () => { expect(await mocks.onDeleteCountdown!("c1")).toBe(true); });
      expect(mocks.countdowns).toEqual([]);
      expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: "soft_delete", resource_type: "countdown", ids: ["c1"] });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it("mock 删除更新 deleted_at 并广播，不调用 trash API", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_BACKEND", "true");
    mocks.query.is.mockResolvedValue({ data: [], error: null });
    try {
      await act(async () => { expect(await mocks.onDeleteCountdown!("c1")).toBe(true); });
      expect(mocks.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
      expect(mocks.countdowns).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  });
  it("就地编辑失败前保持原标签，表单可以留在原锚点", async () => {
    let finish!: (result: { error: unknown }) => void;
    mocks.updateResult.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<boolean>;
    act(() => { pending = mocks.onUpdateCountdown!("c1", { ...original, target_date: "2020-10-22" }); });
    expect(mocks.countdowns).toEqual([original]);
    await act(async () => { finish({ error: { message: "失败" } }); await pending; });
    expect(mocks.countdowns).toEqual([original]);
  });
});
