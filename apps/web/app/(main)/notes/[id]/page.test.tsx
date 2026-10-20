// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  noteId: "A", userId: "user-1", getSession: vi.fn(), readNote: vi.fn(),
  listeners: [] as ((event: string, session: { user: { id: string } } | null) => void)[],
  save: vi.fn(),
}));
const tocSpy = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: state.noteId }),
  usePathname: () => `/notes/${state.noteId}`,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => {
  const query = () => {
    const result = { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "insert"]) chain[method] = () => chain;
    chain.order = () => Promise.resolve(result);
    chain.maybeSingle = () => state.readNote();
    chain.then = (callback: (value: unknown) => unknown) => Promise.resolve(result).then(callback);
    return chain;
  };
  const client = {
    auth: {
      getSession: () => state.getSession(),
      getUser: async () => ({ data: { user: { id: state.userId } } }),
      onAuthStateChange: (callback: typeof state.listeners[number]) => {
        state.listeners.push(callback);
        return { data: { subscription: { unsubscribe: () => { state.listeners = state.listeners.filter((listener) => listener !== callback); } } } };
      },
    },
    from: query,
    rpc: (...args: unknown[]) => { state.save(...args); return Promise.resolve({ data: { status: "ok", note_revision: 1 }, error: null }); },
  };
  return { createClient: () => client };
});
vi.mock("@/components/editor/tiptap-editor", () => ({ TipTapEditor: ({ noteTitle }: { noteTitle: string }) => <div data-editor>{noteTitle}</div> }));
vi.mock("@/components/tags/use-tags", () => ({ useAllTags: () => ({ tags: [], refresh: vi.fn() }), useResourceTags: () => ({ tags: [], addTag: vi.fn(), removeTag: vi.fn() }) }));
vi.mock("@/hooks/use-note-collab", () => ({ useNoteCollab: () => ({ peers: [], resolved: true }), colorFromUserId: () => "gray" }));
vi.mock("@/hooks/use-linked-task-sync", () => ({ useLinkedTaskSync: () => {} }));
vi.mock("@/lib/hooks/use-hotkey", () => ({ useHotkey: () => {} }));
vi.mock('@/components/editor/note-attachments-panel', () => ({ AttachmentsPanel: () => null }));
vi.mock('@/components/notes/note-page-menu', () => ({ NotePageMenu: () => null }));
vi.mock('@/components/notes/backlinks', () => ({ Backlinks: () => null }));
vi.mock('@/components/notes/note-page-visuals', () => ({ NotePageVisuals: () => null }));
vi.mock('@/components/notes/note-page-comments', () => ({ NotePageComments: () => null }));
vi.mock('@/components/notes/note-tabs-bar', () => ({ MobileNoteTabsButton: () => null }));
vi.mock('@/components/notes/note-hierarchy-bar', () => ({ NoteHierarchyBar: () => null }));
vi.mock('@/components/notes/linked-task-banner', () => ({ LinkedTaskBanner: () => null }));
vi.mock('@/components/notes/note-child-pages', () => ({ NoteChildPages: () => null }));
vi.mock('@/components/notes/note-move-dialog', () => ({ NoteMoveDialog: () => null }));
vi.mock('@/components/toc/toc-minimap', () => ({
  TocMinimap: (props: { mobileSheet?: boolean }) => {
    tocSpy(props);
    return null;
  },
}));
vi.mock('@/components/favorite-button', () => ({ FavoriteButton: () => null }));
vi.mock('@/components/tags/tag-selector', () => ({ TagSelector: () => null }));
vi.mock('@/components/tags/tag-badge', () => ({ TagBadge: () => null }));
vi.mock('@/components/share/resource-share-dialog', () => ({ ResourceShareDialog: () => null }));
vi.mock('@/components/notes/note-presence-bar', () => ({ NotePresenceBar: () => null }));
vi.mock('@/components/notes/note-history-panel', () => ({ NoteHistoryPanel: () => null }));
vi.mock('@/components/notes/note-history-preview', () => ({ NoteHistoryPreview: () => null }));
vi.mock('@/components/layout/mobile-navigation', () => ({ CollectionBackLink: () => null }));
import NoteEditorPage from "./page";

const note = (id: string) => ({ id, user_id: state.userId, title: `Title ${id}`, content: { type: "doc", content: [{ type: "paragraph" }] }, content_revision: 0 });

describe("note page load reliability", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    state.noteId = "A";
    state.userId = "user-1";
    state.listeners = [];
    state.save.mockClear();
    tocSpy.mockClear();
    state.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: state.userId } } } });
    state.readNote.mockReset().mockImplementation(async () => ({ data: note(state.noteId), error: null }));
    localStorage.clear();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const render = async () => { await act(async () => root.render(<NoteEditorPage />)); };

  it("online query error keeps the tab and exposes retry; retry loads the note", async () => {
    state.readNote.mockResolvedValueOnce({ data: null, error: { message: "temporary failure" } });
    const removed = vi.fn();
    window.addEventListener("organize:note-tab-remove", removed);
    try {
      await render();
      expect(container.textContent).toContain("笔记加载失败");
      expect(removed).not.toHaveBeenCalled();
      const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "重试")!;
      await act(async () => retry.click());
      expect(container.querySelector("textarea")?.value).toBe("Title A");
    } finally { window.removeEventListener("organize:note-tab-remove", removed); }
  });

  it("late auth lookup from A cannot replace the already loaded B note", async () => {
    let resolveAuth!: (value: unknown) => void;
    state.getSession.mockImplementationOnce(() => new Promise((resolve) => { resolveAuth = resolve; }));
    await render();
    state.noteId = "B";
    await render();
    expect(container.querySelector("textarea")?.value).toBe("Title B");
    await act(async () => resolveAuth({ data: { session: { user: { id: "old-user" } } } }));
    expect(container.querySelector("textarea")?.value).toBe("Title B");
    expect(state.readNote).toHaveBeenCalledTimes(1);
  });

  it("initial auth event preserves the editor; changing account replaces it", async () => {
    await render();
    const originalTitle = container.querySelector("textarea");
    await act(async () => { state.listeners.forEach((listener) => listener("INITIAL_SESSION", { user: { id: "user-1" } })); });
    expect(container.querySelector("textarea")).toBe(originalTitle);
    state.userId = "user-2";
    state.getSession.mockResolvedValue({ data: { session: { user: { id: state.userId } } } });
    await act(async () => { state.listeners.forEach((listener) => listener("SIGNED_IN", { user: { id: "user-2" } })); });
    expect(container.querySelector("textarea")).not.toBe(originalTitle);
  });

  it("passes mobileSheet so a narrow note page can open the contents drawer", async () => {
    await render();
    expect(tocSpy).toHaveBeenCalled();
    expect(tocSpy.mock.calls.at(-1)?.[0]).toMatchObject({ mobileSheet: true });
  });
});
