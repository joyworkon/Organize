// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureDraftStorageKey } from "@/lib/dashboard/capture-draft";

const mocks = vi.hoisted(() => ({
  authChanged: null as null | ((_event: string, session: { user: { id: string } }) => void),
  createTask: vi.fn(), toast: vi.fn(),
  client: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("@/lib/tasks/quick-create", () => ({ createQuickTask: mocks.createTask }));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/reading/collect", () => ({ collectReadingItem: vi.fn(), collectResultToast: vi.fn() }));
const { DashboardCapture } = await import("./dashboard-capture");
let root: Root;
let container: HTMLDivElement;
function input() { return container.querySelector("textarea")!; }
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function submit() {
  act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); vi.clearAllMocks();
  mocks.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "a" } } }, error: null });
  mocks.client.auth.onAuthStateChange.mockImplementation((listener) => {
    mocks.authChanged = listener;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("DashboardCapture pending saves", () => {
  it("keeps the new account draft and ignores the old account completion", async () => {
    const onAdded = vi.fn(); const pending = deferred<unknown>();
    mocks.createTask.mockReturnValue(pending.promise);
    await act(async () => root.render(createElement(DashboardCapture, { onAdded })));
    type("待办：同一段文字"); submit();
    expect(mocks.createTask).toHaveBeenCalledWith(mocks.client, { title: "同一段文字", expectedUserId: "a" });
    localStorage.setItem(captureDraftStorageKey("b"), "待办：同一段文字");
    act(() => mocks.authChanged!("SIGNED_IN", { user: { id: "b" } }));
    await act(async () => pending.resolve({ status: "created", task: { id: "old-task", user_id: "a" } }));
    expect(input().value).toBe("待办：同一段文字");
    expect(localStorage.getItem(captureDraftStorageKey("b"))).toBe("待办：同一段文字");
    expect(onAdded).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled();
    expect(container.querySelector("button:last-child")?.hasAttribute("disabled")).toBe(false);
  });
  it("keeps later typing when an earlier save completes", async () => {
    const onAdded = vi.fn(); const pending = deferred<unknown>();
    mocks.createTask.mockReturnValue(pending.promise);
    await act(async () => root.render(createElement(DashboardCapture, { onAdded })));
    type("待办：第一条"); submit(); type("待办：第二条");
    await act(async () => pending.resolve({ status: "created", task: { id: "task-a", user_id: "a" } }));
    expect(input().value).toBe("待办：第二条"); expect(onAdded).toHaveBeenCalledOnce();
  });
  it("preserves text and reports a rejected memo request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("连接失败")));
    await act(async () => root.render(createElement(DashboardCapture, { onAdded: vi.fn() })));
    type("没有提交成功的想法"); await act(async () => submit());
    expect(input().value).toBe("没有提交成功的想法");
    expect(mocks.toast).toHaveBeenCalledWith({ title: "连接失败", variant: "destructive" });
  });
});
