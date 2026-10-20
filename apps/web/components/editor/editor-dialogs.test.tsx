// @vitest-environment jsdom

import type { Editor, JSONContent } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorBlockTarget, EditorDialog } from "./types";
import { EditorDialogs } from "./editor-dialogs";

const supabaseState = vi.hoisted(() => ({
  fail: false,
  notes: [] as Array<{ id: string; title: string; icon: string | null; updated_at: string }>,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from() {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        neq() { return chain; },
        is() { return chain; },
        order: async () => supabaseState.fail
          ? { data: null, error: { message: "fail" } }
          : { data: supabaseState.notes, error: null },
      };
      return chain;
    },
  }),
}));

const block: EditorBlockTarget = {
  pos: 4,
  id: "block-1",
  type: "paragraph",
  text: "原文",
  json: { type: "paragraph", content: [{ type: "text", text: "原文" }] },
};

function json(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body };
}

function button(name: string): HTMLButtonElement {
  const nodes = Array.from(document.body.querySelectorAll("button"));
  const exact = nodes.find((node) => {
    if (node.getAttribute("aria-label") === name) return true;
    return (node.textContent || "").replace(/\s+/g, "") === name.replace(/\s+/g, "");
  });
  const found = exact ?? nodes.filter((node) => (node.textContent || "").includes(name)).length === 1
    ? (exact ?? nodes.filter((node) => (node.textContent || "").includes(name))[0])
    : undefined;
  if (!found) {
    const names = nodes.map((node) => node.getAttribute("aria-label") || node.textContent);
    throw new Error(`Missing button: ${name}. Have: ${names.join(" | ")}`);
  }
  return found as HTMLButtonElement;
}

function setTextArea(value: string, index = 0) {
  const textarea = document.body.querySelectorAll("textarea")[index] as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("EditorDialogs chrome", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn<() => void>>;
  const fetchMock = vi.fn();

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function show(dialog: EditorDialog, editor: Editor = {} as Editor) {
    await act(async () => {
      root.render(<EditorDialogs editor={editor} noteId="note-1" dialog={dialog} onClose={onClose} />);
    });
    await settle();
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const proto = HTMLElement.prototype;
    if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
    if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
    if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
    if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
    supabaseState.fail = false;
    supabaseState.notes = [];
    onClose = vi.fn<() => void>();
    fetchMock.mockReset().mockResolvedValue(json([]));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens block comments in the shared dialog and keeps the empty state", async () => {
    await show({ type: "comment", target: block });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toBe("区块评论");
    expect(dialog?.className).toContain("max-w-[640px]");
    expect(dialog?.className).not.toContain("max-w-lg");
    expect(document.body.querySelector(".editor-dialog-backdrop")).toBeNull();
    expect(document.body.textContent).toContain("还没有评论");
    const send = button("发送");
    expect(send.disabled).toBe(true);
    expect(send.classList.contains("bg-primary")).toBe(true);
    expect(send.classList.contains("focus-visible:ring-2")).toBe(true);
    for (const node of document.body.querySelectorAll("button")) {
      expect(node.classList.contains("focus-visible:ring-2")).toBe(true);
    }
    act(() => button("关闭").click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes the shared dialog from Escape", async () => {
    await show({ type: "ai-notes", pos: 1 });
    expect(document.body.textContent).toContain("AI 速记");
    expect(button("开始录音").classList.contains("bg-primary")).toBe(true);
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("posts a block comment with the same payload and reloads the thread", async () => {
    const thread = {
      id: "thread-1",
      note_id: "note-1",
      block_id: "block-1",
      user_id: "user-1",
      resolved_at: null,
      created_at: "2026-10-20T00:00:00.000Z",
      updated_at: "2026-10-20T00:00:00.000Z",
      comments: [{
        id: "comment-1",
        thread_id: "thread-1",
        user_id: "user-1",
        body: "你好",
        created_at: "2026-10-20T00:00:00.000Z",
        updated_at: "2026-10-20T00:00:00.000Z",
      }],
    };
    let loads = 0;
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return json({ id: "comment-1" });
      loads += 1;
      return json(loads > 1 ? [thread] : []);
    });
    await show({ type: "comment", target: block });
    await act(async () => setTextArea("你好"));
    expect(button("发送").disabled).toBe(false);
    await act(async () => { button("发送").click(); });
    await settle();
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect(post?.[0]).toBe("/api/notes/note-1/comments");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ blockId: "block-1", body: "你好", threadId: null });
    expect(document.body.textContent).toContain("你好");
    expect(button("删除评论线程").classList.contains("text-destructive")).toBe(true);
    expect(button("删除评论线程").classList.contains("focus-visible:ring-2")).toBe(true);
    expect(button("解决").classList.contains("focus-visible:ring-2")).toBe(true);
  });

  it("keeps suggestion save disabled until the draft changes, and refuses a stale accept", async () => {
    const current = { type: "paragraph", content: [{ type: "text", text: "已改" }] };
    const proposed = { type: "paragraph", content: [{ type: "text", text: "建议稿" }] };
    const insertContentAt = vi.fn();
    const editor = {
      state: {
        doc: {
          descendants(visit: (node: { attrs: { id: string }; toJSON: () => JSONContent; nodeSize: number }, pos: number) => boolean) {
            visit({ attrs: { id: "block-1" }, toJSON: () => current, nodeSize: 4 }, 2);
          },
        },
      },
      chain: () => ({ focus: () => ({ insertContentAt: () => ({ run: insertContentAt }) }) }),
    } as unknown as Editor;
    fetchMock.mockResolvedValue(json([{
      id: "sug-1",
      note_id: "note-1",
      block_id: "block-1",
      user_id: "user-1",
      original_block: block.json,
      proposed_block: proposed,
      status: "pending",
      created_at: "2026-10-20T00:00:00.000Z",
      updated_at: "2026-10-20T00:00:00.000Z",
    }]));
    await show({ type: "suggestion", target: block }, editor);
    expect(document.body.textContent).not.toContain("还没有编辑建议");
    expect(document.body.textContent).toContain("建议稿");
    const save = button("保存建议");
    expect(save.disabled).toBe(true);
    expect(save.classList.contains("bg-primary")).toBe(true);
    expect(save.classList.contains("focus-visible:ring-2")).toBe(true);
    expect(button("接受").classList.contains("bg-primary")).toBe(true);
    expect(button("拒绝").classList.contains("bg-primary")).toBe(false);
    expect(button("拒绝").classList.contains("focus-visible:ring-2")).toBe(true);
    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => { button("接受").click(); });
    await settle();
    expect(document.body.textContent).toContain("区块自创建建议后已经变化");
    expect(insertContentAt).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.slice(callsBefore).some((call) => call[1]?.method === "PATCH")).toBe(false);
  });

  it("tells the user when a block cannot take a text suggestion", async () => {
    await show({ type: "suggestion", target: { ...block, type: "image", text: "" } });
    expect(document.body.textContent).toContain("该类型区块暂不支持文本建议");
    expect(document.body.textContent).toContain("还没有编辑建议");
    expect(document.body.textContent).not.toContain("保存建议");
  });

  it("asks AI with a shared primary action and inserts by replacing the block", async () => {
    const run = vi.fn();
    const insertContentAt = vi.fn().mockReturnValue({ run });
    const editor = {
      chain: () => ({ focus: () => ({ insertContentAt }) }),
      state: { doc: { nodeAt: () => ({ nodeSize: 5 }) } },
    } as unknown as Editor;
    fetchMock.mockResolvedValue(json({ text: "润色结果" }));
    await show({ type: "ask-ai", target: block }, editor);
    const generate = button("生成");
    expect(generate.disabled).toBe(false);
    expect(generate.classList.contains("bg-primary")).toBe(true);
    expect(generate.classList.contains("focus-visible:ring-2")).toBe(true);
    await act(async () => setTextArea(""));
    expect(button("生成").disabled).toBe(true);
    await act(async () => setTextArea("整理并润色这段内容"));
    expect(button("生成").disabled).toBe(false);
    await act(async () => { button("生成").click(); });
    await settle();
    expect(button("替换原区块").classList.contains("bg-primary")).toBe(true);
    expect(button("插入到下方").classList.contains("bg-primary")).toBe(false);
    expect(button("插入到下方").classList.contains("border")).toBe(true);
    expect(button("插入到下方").classList.contains("focus-visible:ring-2")).toBe(true);
    await act(async () => { button("替换原区块").click(); });
    expect(insertContentAt).toHaveBeenCalledWith({ from: 4, to: 9 }, expect.any(Array));
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("moves a block to the picked note and shows retry when the list fails", async () => {
    const dispatch = vi.fn();
    const tr = { doc: { childCount: 1 }, delete() { return this; }, insert() { return this; } };
    const editor = {
      state: { doc: { nodeAt: () => ({ nodeSize: 3 }) }, tr },
      view: { dispatch },
      schema: { nodes: { paragraph: { create: () => ({}) } } },
    } as unknown as Editor;
    supabaseState.notes = [{ id: "note-2", title: "目标笔记", icon: null, updated_at: "2026-10-20T00:00:00.000Z" }];
    fetchMock.mockResolvedValue(json({ ok: true }));
    await show({ type: "move", target: block }, editor);
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("移动到");
    expect(dialog?.className).toContain("max-w-[480px]");
    expect(document.body.textContent).toContain("目标笔记");
    await act(async () => { button("目标笔记").click(); });
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("/api/notes/note-1/move-block", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ targetNoteId: "note-2", blockId: "block-1" });
    expect(dispatch).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a shared retry button when the move list fails to load", async () => {
    supabaseState.fail = true;
    await show({ type: "move", target: block });
    expect(document.body.textContent).toContain("无法加载笔记");
    expect(button("重试").classList.contains("focus-visible:ring-2")).toBe(true);
    expect(button("重试").classList.contains("border")).toBe(true);
    supabaseState.fail = false;
    await act(async () => { button("重试").click(); });
    await settle();
    expect(document.body.textContent).toContain("没有可移动到的笔记");
  });

  it("uses a destructive stop control while recording and a primary action when the take is ready", async () => {
    const stopTrack = vi.fn();
    class FakeMediaRecorder {
      state = "inactive";
      mimeType = "audio/webm";
      onstop: (() => void) | null = null;
      static isTypeSupported() { return false; }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.onstop?.(); }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
    });
    await show({ type: "ai-notes", pos: 1 });
    expect(document.body.querySelector(".recording-pulse")).not.toBeNull();
    await act(async () => { button("开始录音").click(); });
    await settle();
    const stop = button("停止录音");
    expect(stop.classList.contains("bg-destructive")).toBe(true);
    expect(stop.classList.contains("focus-visible:ring-2")).toBe(true);
    await act(async () => { stop.click(); });
    await settle();
    expect(stopTrack).toHaveBeenCalled();
    expect(button("生成速记").classList.contains("bg-primary")).toBe(true);
    expect(button("重新录制").classList.contains("border")).toBe(true);
    expect(button("重新录制").classList.contains("focus-visible:ring-2")).toBe(true);
  });
});
