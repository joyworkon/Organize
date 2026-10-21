// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNewNote } from "@/lib/notes/create-note";
import { PageLinkTrigger } from "./extensions/page-link-trigger";
import { createBlockKeydownHandlers } from "./block-interaction";
import { PageLinkMenu, searchLinkPages } from "./page-link-menu";

const mocks = vi.hoisted(() => ({ query: vi.fn(), ilike: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: "u" } } } }) },
  from: () => {
    const chain = { select: () => chain, is: () => chain, order: () => chain, limit: () => chain, in: () => chain, neq: () => chain,
      eq: mocks.eq, ilike: (...args: unknown[]) => { mocks.ilike(...args); return chain; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => mocks.query().then(resolve, reject),
    };
    return chain;
  },
}) }));
vi.mock("@/lib/notes/create-note", () => ({ createNewNote: vi.fn(), describeCreateNoteResult: (result: { status: string }) => result.status }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const page = { id: "target", title: "会议纪要", icon: null, parent_note_id: null };
const success = { data: [page], error: null };
let editor: Editor;
let root: Root;
let container: HTMLElement;
const flush = async (ms = 0) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); if (ms) await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
function type(text: string) { act(() => { editor.commands.insertContent(text); }); }
function key(key: string) { act(() => { editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); }); }
function option() { return document.querySelector<HTMLButtonElement>('[role="option"]')!; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
  vi.resetAllMocks();
  mocks.query.mockResolvedValue(success);
  editor = new Editor({ extensions: [StarterKit, Link, PageLinkTrigger], content: "<p></p>" });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ left: 10, right: 10, top: 30, bottom: 50 });
  document.body.appendChild(editor.view.dom);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<PageLinkMenu editor={editor} noteId="source" />); });
});
afterEach(() => { act(() => root.unmount()); editor.destroy(); document.body.innerHTML = ""; });

describe("page picker asynchronous states", () => {
  it("escapes SQL wildcards and leaves access control to RLS rather than an owner filter", async () => {
    await searchLinkPages("100%_\\", "source");
    expect(mocks.ilike).toHaveBeenCalledWith("title", "%100\\%\\_\\\\%");
    expect(mocks.eq).not.toHaveBeenCalled();
  });

  it("loads the parent title even when that parent does not match the search", async () => {
    mocks.query.mockResolvedValueOnce({ data: [{ ...page, parent_note_id: "parent" }], error: null })
      .mockResolvedValueOnce({ data: [{ id: "parent", title: "项目工作区" }], error: null });
    expect(await searchLinkPages("会议")).toEqual([{ ...page, parent_note_id: "parent", parent_title: "项目工作区" }]);
  });

  it("shows loading, retries failed searches, and inserts on mouse selection without stealing focus", async () => {
    mocks.query.mockResolvedValueOnce({ data: null, error: { message: "failed" } });
    type("[[会议");
    await flush();
    expect(document.querySelector('[role="status"]')?.textContent).toContain("正在加载");
    await flush(160);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("页面加载失败");
    expect(document.body.textContent).not.toContain("没有匹配的页面");
    const retry = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "重试")!;
    act(() => retry.click());
    await flush(160);
    expect(option().querySelector("mark")?.textContent).toBe("会议");
    act(() => option().click());
    await flush();
    expect(editor.getHTML()).toContain('href="/notes/target"');
    expect(document.querySelector(".page-link-popover")).toBeNull();
  });

  it("lets the picker handle Enter in a heading before the editor's heading shortcut", async () => {
    let open = false;
    act(() => {
      editor.commands.setContent("<h2></h2>");
      editor.setOptions({ editorProps: { handleKeyDown: createBlockKeydownHandlers({
        getEditor: () => editor, isMenuOpen: () => open,
        onOpenCommandMenu: () => {}, onOpenSearchDialog: () => {},
      }) } });
      root.render(<PageLinkMenu editor={editor} noteId="source" onOpenChange={(value) => { open = value; }} />);
    });
    type("[[会议"); await flush(160);
    expect(open).toBe(true);
    key("Enter"); await flush();
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.getHTML()).toContain('href="/notes/target"');
    expect(open).toBe(false);
  });

  it("ignores stale search responses and preserves the latest query", async () => {
    const old = deferred<typeof success>();
    mocks.query.mockReturnValueOnce(old.promise);
    type("[[旧"); await flush(160);
    type("会议"); await flush(160);
    expect(option().textContent).toContain("会议纪要");
    old.resolve({ data: [{ ...page, title: "旧结果" }], error: null }); await flush();
    expect(option().textContent).toContain("会议纪要");
    expect(document.body.textContent).not.toContain("旧结果");
  });

  it("Escape preserves typed text, does not reopen while typing, and permission loss closes", async () => {
    type("[[会议"); await flush(160);
    key("Escape");
    expect(document.querySelector(".page-link-popover")).toBeNull();
    type("更多"); await flush();
    expect(document.querySelector(".page-link-popover")).toBeNull();
    expect(editor.getText()).toBe("[[会议更多");
    act(() => { editor.commands.setContent("<p></p>"); });
    type("[[会议"); await flush(160);
    act(() => { editor.setEditable(false); }); await flush();
    expect(document.querySelector(".page-link-popover")).toBeNull();
  });

  it("ignores a nested editor's bubbling trigger", async () => {
    const nested = document.createElement("div");
    editor.view.dom.appendChild(nested);
    act(() => { nested.dispatchEvent(new CustomEvent("organize-page-link", { bubbles: true, detail: {
      type: "start", query: "会议", range: { from: 1, to: 5 }, point: { left: 10, top: 20 },
    } })); });
    await flush();
    expect(document.querySelector(".page-link-popover")).toBeNull();
  });

  it("does not reopen from a late suggestion start after the trigger has already exited", async () => {
    act(() => { editor.commands.insertContent("[[x"); editor.commands.insertContent("]]"); });
    await flush(160);
    expect(document.querySelector(".page-link-popover")).toBeNull();
  });

  it("keeps text on creation failure and retries through the shared creation service", async () => {
    mocks.query.mockResolvedValue({ data: [], error: null });
    vi.mocked(createNewNote).mockResolvedValueOnce({ status: "failed", message: "failed" }).mockResolvedValueOnce({ status: "created", noteId: "new-note" });
    type("[[新会议"); await flush(160);
    expect(document.body.textContent).toContain("没有匹配的页面");
    key("Enter"); await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("failed");
    expect(editor.getText()).toBe("[[新会议");
    key("Enter"); await flush();
    expect(createNewNote).toHaveBeenLastCalledWith(expect.anything(), { title: "新会议" });
    expect(editor.getHTML()).toContain('href="/notes/new-note"');
  });

  it("does not insert into an abandoned selection when page creation completes late", async () => {
    mocks.query.mockResolvedValue({ data: [], error: null });
    const pending = deferred<Awaited<ReturnType<typeof createNewNote>>>();
    vi.mocked(createNewNote).mockReturnValue(pending.promise);
    type("[[新会议"); await flush(160);
    key("Enter"); await flush();
    key("Escape");
    pending.resolve({ status: "created", noteId: "late" }); await flush();
    expect(editor.getText()).toBe("[[新会议");
    expect(editor.getHTML()).not.toContain('href=');
  });
});
