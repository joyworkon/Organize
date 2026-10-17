// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: "a" as string | null,
  listeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
  getSession: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
  params: "",
  failOwner: null as string | null,
  delayedOwner: null as string | null,
  readGate: null as Promise<void> | null,
  taskDate: null as string | null,
  allDay: false,
  recurringRpc: { data: null as string | null, error: null as Error | null },
  toast: vi.fn(),
}));

function rows(table: string, owner: string | null, filters: Record<string, unknown>) {
  const timestamp = new Date(2026, 9, 16, 10).toISOString();
  let data: Record<string, unknown>[] = [];
  if (table === "tasks") data = [
    { id: `task-${owner}`, user_id: owner, title: `Private task ${owner}`, status: mocks.taskDate ? "todo" : "in_progress", category: "work", due_date: mocks.taskDate, all_day: mocks.allDay, completed_at: null, created_at: timestamp },
    { id: `done-${owner}`, user_id: owner, title: `Completed task ${owner}`, status: "done", category: "work", due_date: null, completed_at: timestamp, created_at: timestamp },
  ];
  if (table === "notes") data = [{ id: `note-${owner}`, user_id: owner, title: `Private note ${owner}`, created_at: timestamp, updated_at: timestamp }];
  if (table === "reading_items") data = [{ id: `article-${owner}`, user_id: owner, title: `Private article ${owner}`, reading_status: "unread", reading_progress: 0, is_pinned: false, created_at: timestamp, completed_reading_at: null, url: `https://${owner}.example/article` }];
  return data.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
}

vi.mock("@/lib/supabase/client", () => {
  const client = {
    auth: {
      getSession: () => mocks.getSession(),
      getUser: async () => ({ data: { user: mocks.owner ? { id: mocks.owner } : null }, error: null }),
      onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
        mocks.listeners.add(listener);
        return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(listener) } } };
      },
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const requestOwner = mocks.owner;
      const resolve = async () => {
        const owner = (filters.user_id as string | undefined) ?? requestOwner;
        if (owner === mocks.delayedOwner && mocks.readGate) await mocks.readGate;
        if (owner === mocks.failOwner) return { data: null, error: new Error("Read failed") };
        return { data: rows(table, owner, filters), error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        order: () => query,
        limit: () => query,
        gte: () => query,
        lte: () => query,
        range: resolve,
        then: (onfulfilled: (value: Awaited<ReturnType<typeof resolve>>) => unknown, onrejected?: (error: unknown) => unknown) => resolve().then(onfulfilled, onrejected),
      };
      return query;
    },
    rpc: (name: string) => {
      if (name === "update_task_atomic") {
        return Promise.resolve({ data: { status: "applied", sync_version: 2 }, error: null });
      }
      if (name === "complete_recurring_task") {
        return Promise.resolve(mocks.recurringRpc);
      }
      return Promise.resolve({ data: null, error: new Error(`Unexpected rpc ${name}`) });
    },
  };
  return { createClient: () => client };
});
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, usePathname: () => "/", useSearchParams: () => new URLSearchParams(mocks.params) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => createElement("a", { href, ...props }, children) }));
vi.mock("@/components/tasks/task-navigation-menu", () => ({ TaskNavigationMenu: ({ trigger }: { trigger: React.ReactNode }) => trigger }));

const { DashboardHub } = await import("./dashboard-hub");
let root: Root;
let container: HTMLDivElement;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function session(owner: string | null) { return { data: { session: owner ? { user: { id: owner } } : null }, error: null }; }
function render() { return act(async () => root.render(createElement(DashboardHub))); }
function auth(event: string, owner: string | null) {
  return act(async () => {
    mocks.owner = owner;
    for (const listener of [...mocks.listeners]) listener(event, owner ? { user: { id: owner } } : null);
  });
}
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.owner = "a"; mocks.params = ""; mocks.failOwner = null; mocks.delayedOwner = null; mocks.readGate = null; mocks.taskDate = null; mocks.allDay = false;
  mocks.recurringRpc = { data: null, error: null };
  mocks.listeners.clear(); localStorage.clear();
  mocks.getSession.mockReset().mockImplementation(async () => session(mocks.owner));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("DashboardHub account boundary with real workbench views", () => {
  it("hides private views until initial identity is confirmed", async () => {
    const initial = deferred<ReturnType<typeof session>>(); mocks.getSession.mockReturnValueOnce(initial.promise);
    await render();
    expect(container.textContent).toContain("正在确认账户");
    expect(container.querySelector(".dashboard-hub")).toBeNull();
    await act(async () => initial.resolve(session("a")));
    expect(container.textContent).toContain("Private task a");
  });
  it("replaces A rows and capture draft with B, and clears A search", async () => {
    localStorage.setItem("organize:dashboard-capture:b", "B draft");
    await render();
    expect(container.textContent).toContain("Private task a");
    type(container.querySelector<HTMLInputElement>('input[aria-label="搜索已加载内容（标题 / 标签）"]')!, "Private");
    type(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="快速记录"]')!, "A draft");
    await auth("SIGNED_IN", "b");
    expect(container.textContent).not.toContain("Private task a");
    expect(container.textContent).not.toContain("Private note a");
    expect(container.textContent).toContain("Private task b");
    expect((container.querySelector<HTMLInputElement>('input[aria-label="搜索已加载内容（标题 / 标签）"]') as HTMLInputElement).value).toBe("");
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("B draft");
    expect(localStorage.getItem("organize:dashboard-capture:a")).toBe("A draft");
  });
  it("clears all private content immediately on signout", async () => {
    await render(); await auth("SIGNED_OUT", null);
    expect(container.textContent).toContain("登录后查看你的工作台");
    expect(container.textContent).not.toContain("Private task a");
    expect(container.querySelector("textarea")).toBeNull();
  });
  it("preserves the same capture element, unsaved draft and search across same-account events", async () => {
    await render();
    const capture = container.querySelector("textarea")!;
    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索已加载内容（标题 / 标签）"]')!;
    type(capture, "still writing"); type(search, "Private");
    await auth("TOKEN_REFRESHED", "a"); await auth("SIGNED_IN", "a");
    expect(container.querySelector("textarea")).toBe(capture);
    expect(capture.value).toBe("still writing"); expect((search as HTMLInputElement).value).toBe("Private");
  });
  it("does not retain A rows when B's first load fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await render(); mocks.failOwner = "b"; await auth("SIGNED_IN", "b");
    expect(container.textContent).not.toContain("Private task a"); expect(container.textContent).not.toContain("Private note a");
    expect(container.textContent).toContain("部分内容暂时无法加载"); log.mockRestore();
  });
  it("ignores an old initial session read after a newer sign-in event", async () => {
    const initial = deferred<ReturnType<typeof session>>(); mocks.getSession.mockReturnValueOnce(initial.promise);
    await render(); await auth("SIGNED_IN", "b");
    expect(container.textContent).toContain("Private task b");
    await act(async () => initial.resolve(session("a")));
    expect(container.textContent).toContain("Private task b"); expect(container.textContent).not.toContain("Private task a");
  });
  it("ignores a late initial session rejection after a newer sign-in", async () => {
    const initial = deferred<ReturnType<typeof session>>(); mocks.getSession.mockReturnValueOnce(initial.promise);
    await render(); await auth("SIGNED_IN", "b");
    await act(async () => initial.reject(new Error("Old session failed")));
    expect(container.textContent).toContain("Private task b"); expect(container.textContent).not.toContain("暂时无法确认账户");
  });
  it("treats a resolved session error as retryable rather than signed out", async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error("Session unavailable") });
    await render(); expect(container.textContent).toContain("暂时无法确认账户");
    expect(container.textContent).not.toContain("登录后查看你的工作台");
  });
  it("exposes retry after initial session failure and can load the account", async () => {
    mocks.getSession.mockRejectedValueOnce(new Error("Session unavailable")); await render();
    expect(container.textContent).toContain("暂时无法确认账户"); expect(container.querySelector(".dashboard-hub")).toBeNull();
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "重试")!.click());
    expect(container.textContent).toContain("Private task a");
  });
  it.each(["today", "review", "stats"])("late A reads cannot repopulate the new %s view", async (view) => {
    mocks.params = view === "today" ? "" : `view=${view}&reviewDate=2026-10-16`;
    const gate = deferred<void>(); mocks.delayedOwner = "a"; mocks.readGate = gate.promise;
    await render(); await auth("SIGNED_IN", "b");
    expect(container.textContent).not.toContain("Private task a");
    if (view === "stats") expect(container.textContent).toContain("b.example");
    else expect(container.textContent).toContain(view === "review" ? "Completed task b" : "Private task b");
    await act(async () => gate.resolve());
    expect(container.textContent).not.toContain("Private task a"); expect(container.textContent).not.toContain("a.example");
    if (view === "stats") expect(container.textContent).toContain("b.example");
    else expect(container.textContent).toContain(view === "review" ? "Completed task b" : "Private task b");
  });
});

describe("Today due labels use the existing all-day contract", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 16, 12)); });
  it("keeps today's all-day task due today instead of expired at midnight", async () => {
    mocks.taskDate = new Date(2026, 9, 16, 0).toISOString(); mocks.allDay = true;
    await render(); expect(container.textContent).toContain("今天到期"); expect(container.textContent).not.toContain("已过期");
  });
  it("retains expired timed deadlines and explicit future times", async () => {
    mocks.taskDate = new Date(2026, 9, 16, 10).toISOString(); await render(); expect(container.textContent).toContain("已过期");
    act(() => root.unmount()); root = createRoot(container); mocks.taskDate = new Date(2026, 9, 16, 16).toISOString();
    await render(); expect(container.textContent).toContain("今天 16:00");
  });
});

describe("Today recurring next-instance honesty", () => {
  async function completeFirstTask() {
    const complete = container.querySelector<HTMLButtonElement>('button[aria-label="标记完成"]');
    expect(complete).not.toBeNull();
    await act(async () => complete!.click());
  }
  it("toasts a destructive failure when the next recurring instance cannot be generated", async () => {
    mocks.recurringRpc = { data: null, error: new Error("boom") };
    await render();
    await completeFirstTask();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "任务已完成，但下一次重复任务生成失败",
      description: "boom",
      variant: "destructive",
    }));
  });
  it("stays silent when no next instance is needed", async () => {
    await render();
    await completeFirstTask();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
