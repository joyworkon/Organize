// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => mocks.getSession(),
      onAuthStateChange: (l: (event: string, session: { user: { id: string } } | null) => void) => {
        mocks.listeners.add(l);
        return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(l) } } };
      },
    },
  }),
}));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));

import { LibraryAccountBoundary } from "./library-account-boundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const mounts: string[] = [];
function Child({ userId }: { userId: string }) {
  const [draft] = useState(() => { mounts.push(userId); return `draft-${mounts.length}`; });
  return createElement("span", null, `${userId}:${draft}`);
}
const emit = (id: string | null) => mocks.listeners.forEach((l) => l("SIGNED_IN", id ? { user: { id } } : null));

beforeEach(() => {
  mounts.length = 0;
  mocks.listeners.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("LibraryAccountBoundary", () => {
  it("remounts on account change but keeps state for same-account events", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "a" } } }, error: null });
    await act(async () => root.render(createElement(LibraryAccountBoundary, { children: (id: string) => createElement(Child, { userId: id }) })));
    expect(container.textContent).toBe("a:draft-1");
    await act(async () => emit("a"));
    expect(container.textContent).toBe("a:draft-1");
    await act(async () => emit("b"));
    expect(container.textContent).toBe("b:draft-2");
    expect(mounts).toEqual(["a", "b"]);
  });

  it("does not let a slow initial getSession overwrite a newer auth event", async () => {
    let resolve!: (v: unknown) => void;
    mocks.getSession.mockReturnValue(new Promise((r) => { resolve = r; }));
    await act(async () => root.render(createElement(LibraryAccountBoundary, { children: (id: string) => createElement(Child, { userId: id }) })));
    await act(async () => emit("b"));
    await act(async () => resolve({ data: { session: { user: { id: "a" } } }, error: null }));
    expect(container.textContent).toBe("b:draft-1");
  });
});
