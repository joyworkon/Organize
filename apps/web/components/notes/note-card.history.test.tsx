// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteWithTags } from "@organize/shared";
import { NoteCard, NoteFavoritesContext } from "./note-card";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/components/share/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("@/components/tags/auto-tag-dialog", () => ({ AutoTagDialog: () => null }));
vi.mock("@/components/share/export-button", () => ({ exportNoteToMarkdown: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

const note = {
  id: "note-42",
  user_id: "user-1",
  title: "周记",
  content: null,
  reading_item_id: null,
  created_at: "2026-10-20T00:00:00.000Z",
  updated_at: "2026-10-20T00:00:00.000Z",
  tags: [],
} as NoteWithTags;

describe("NoteCard 历史入口", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.push.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("更多菜单里的历史版本打开笔记页并展开版本历史", async () => {
    await act(async () => {
      root.render(createElement(
        NoteFavoritesContext.Provider,
        { value: { favoritedIds: new Set<string>(), toggleFavorite: async () => {} } },
        createElement(NoteCard, { note, view: "card" })
      ));
    });

    const trigger = container.querySelector('button[title="更多操作"]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    act(() => {
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    });

    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes("历史版本"));
    expect(item).toBeTruthy();
    await act(async () => {
      (item as HTMLElement).click();
    });
    expect(mocks.push).toHaveBeenCalledWith("/notes/note-42?panel=history");
  });
});
