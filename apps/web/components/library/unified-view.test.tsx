// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/tags/use-tags", () => ({ useAllTags: () => ({ tags: [] }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("./library-card", () => ({
  LibraryCard: ({ item }: { item: { title: string } }) => createElement("div", { "data-testid": "card" }, item.title),
}));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));

import { UnifiedView } from "./unified-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
type Pending = { url: string; resolve: (body: unknown, ok?: boolean) => void };
let pending: Pending[];

function page(title: string) {
  return { items: [{ id: title, source_type: "reading", title }], nextCursor: null };
}

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  globalThis.fetch = vi.fn((url: string) => new Promise((resolve) => {
    pending.push({
      url,
      resolve: (body, ok = true) => resolve({ ok, json: async () => body } as Response),
    });
  })) as unknown as typeof fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const mainRequests = () => pending.filter((p) => !p.url.includes("view=memo"));
const cards = () => Array.from(container.querySelectorAll("[data-testid=card]")).map((n) => n.textContent);

describe("UnifiedView", () => {
  it("ignores a stale response that resolves after the search changed", async () => {
    await act(async () => root.render(createElement(UnifiedView, { search: "", refreshTick: 0 })));
    await act(async () => { vi.advanceTimersByTime(300); });
    const first = mainRequests()[0];
    // search changes; stale request resolves during the debounce window
    await act(async () => root.render(createElement(UnifiedView, { search: "new", refreshTick: 0 })));
    await act(async () => { first.resolve(page("stale")); });
    expect(cards()).not.toContain("stale");
    await act(async () => { vi.advanceTimersByTime(300); });
    const second = mainRequests()[1];
    expect(second.url).toContain("q=new");
    await act(async () => { second.resolve(page("fresh")); });
    expect(cards()).toEqual(["fresh"]);
  });

  it("shows an error with retry instead of an empty library when the first load fails", async () => {
    await act(async () => root.render(createElement(UnifiedView, { search: "", refreshTick: 0 })));
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { mainRequests()[0].resolve({ error: "boom" }, false); });
    expect(container.textContent).toContain("资料库加载失败");
    expect(container.textContent).not.toContain("还没有待读的文章");
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "重试")!;
    await act(async () => { retry.click(); });
    await act(async () => { mainRequests()[1].resolve(page("ok")); });
    expect(cards()).toEqual(["ok"]);
    expect(container.textContent).not.toContain("资料库加载失败");
  });
});
