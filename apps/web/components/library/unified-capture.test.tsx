// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collect: vi.fn(),
  submitMemo: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-a" } } } }) },
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/memos/save-memo", () => ({ submitMemo: mocks.submitMemo }));
vi.mock("@/lib/reading/collect", () => ({
  collectReadingItem: mocks.collect,
  collectResultToast: (r: { status: string }) => ({ title: r.status }),
}));

import { UnifiedCapture } from "./unified-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(UnifiedCapture)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function type(value: string) {
  const textarea = container.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
}
async function submit(textarea: HTMLTextAreaElement) {
  await act(async () => {
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

describe("UnifiedCapture save failures keep the draft", () => {
  it("keeps the whole input when one of several links fails", async () => {
    mocks.collect
      .mockResolvedValueOnce({ status: "saved" })
      .mockResolvedValueOnce({ status: "error", message: "boom" });
    const raw = "https://a.example/1\nhttps://b.example/2";
    const textarea = await type(raw);
    await submit(textarea);
    expect(mocks.collect).toHaveBeenCalledTimes(2);
    expect(mocks.collect).toHaveBeenCalledWith("https://a.example/1", { expectedUserId: "user-a" });
    expect(textarea.value).toBe(raw);
  });

  it("clears the input when all links succeed or are duplicates", async () => {
    mocks.collect.mockResolvedValueOnce({ status: "saved" }).mockResolvedValueOnce({ status: "duplicate" });
    const textarea = await type("https://a.example/1\nhttps://b.example/2");
    await submit(textarea);
    expect(textarea.value).toBe("");
  });

  it("keeps the input and reports failure when an offline memo is not persisted", async () => {
    mocks.submitMemo.mockResolvedValueOnce({ status: "queued", persisted: false });
    const onCaptured = vi.fn();
    await act(async () => root.render(createElement(UnifiedCapture, { onCaptured })));
    const textarea = await type("just a short memo");
    await submit(textarea);
    expect(textarea.value).toBe("just a short memo");
    expect(onCaptured).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});
