// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 假 supabase 客户端：查询（threads/comments select）与 insert 挂起在外部
 * 可控的 deferred 上，用来复现「慢请求晚到」的切换竞态。
 */
interface Deferred {
  promise: Promise<{ data: unknown; error: unknown }>;
  resolve: (value: { data: unknown; error: unknown }) => void;
  reject: (reason?: unknown) => void;
}

function makeDeferred(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const promise = new Promise<{ data: unknown; error: unknown }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface ThreadSelect {
  noteId: string;
  deferred: Deferred;
}
interface CommentSelect {
  threadIds: unknown;
  deferred: Deferred;
}
interface InsertCall {
  table: string;
  payload: Record<string, unknown>;
  deferred: Deferred;
}

function createFakeSupabase() {
  const threadSelects: ThreadSelect[] = [];
  const commentSelects: CommentSelect[] = [];
  const inserts: InsertCall[] = [];

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let deferred: Deferred | null = null;
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        in(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        order() {
          deferred = makeDeferred();
          if (table === "note_comment_threads") {
            threadSelects.push({ noteId: String(filters.note_id), deferred });
          } else {
            commentSelects.push({ threadIds: filters.thread_id, deferred });
          }
          return deferred.promise;
        },
        insert(payload: Record<string, unknown>) {
          deferred = makeDeferred();
          inserts.push({ table, payload, deferred });
          return builder;
        },
        async single() {
          return deferred!.promise;
        },
        then(
          onFulfilled?: (value: { data: unknown; error: unknown }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return deferred!.promise.then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
  return { client, threadSelects, commentSelects, inserts };
}

const state = vi.hoisted(() => ({ supabase: createFakeSupabase() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => state.supabase.client,
}));

import { NotePageComments } from "./note-page-comments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ThreadRow {
  id: string;
  note_id: string;
  resolved_at: string | null;
  created_at: string;
}
interface CommentRow {
  id: string;
  thread_id: string;
  body: string;
  created_at: string;
}

function threadRow(id: string, noteId: string): ThreadRow {
  return { id, note_id: noteId, resolved_at: null, created_at: "2026-10-16T00:00:00Z" };
}
function commentRow(id: string, threadId: string, body: string): CommentRow {
  return { id, thread_id: threadId, body, created_at: "2026-10-16T00:00:00Z" };
}

/** 放行一组完整的加载响应：threads → comments（有 id 时） */
async function flushLoad(
  select: ThreadSelect,
  threads: ThreadRow[],
  comments: CommentRow[] = [],
) {
  await act(async () => {
    select.deferred.resolve({ data: threads, error: null });
  });
  const commentSelect = state.supabase.commentSelects.at(-1);
  if (commentSelect) {
    await act(async () => {
      commentSelect.deferred.resolve({ data: comments, error: null });
    });
  }
}

let container: HTMLDivElement;
let root: Root;
const onCountChange = vi.fn();

function render(noteId: string) {
  act(() => {
    root.render(createElement(NotePageComments, { noteId, onCountChange }));
  });
}

beforeEach(() => {
  state.supabase = createFakeSupabase();
  onCountChange.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  try {
    act(() => root.unmount());
  } catch {
    /* 已卸载 */
  }
  container.remove();
});

describe("NotePageComments 切笔记隔离", () => {
  it("笔记 A 的晚到响应不得覆盖笔记 B 的列表与计数", async () => {
    render("note-a");
    const loadA = state.supabase.threadSelects[0];
    expect(loadA?.noteId).toBe("note-a");

    // A 的请求还挂着，就切到 B
    render("note-b");
    expect(state.supabase.threadSelects[1]?.noteId).toBe("note-b");
    expect(onCountChange).toHaveBeenCalledWith(0);

    // B 先返回
    await flushLoad(
      state.supabase.threadSelects[1],
      [threadRow("t-b", "note-b")],
      [commentRow("c-b", "t-b", "评论B")],
    );
    expect(container.textContent).toContain("评论B");
    expect(onCountChange).toHaveBeenLastCalledWith(1);

    // A 的慢响应现在才到：应被丢弃
    await flushLoad(
      loadA,
      [threadRow("t-a", "note-a")],
      [commentRow("c-a", "t-a", "评论A")],
    );
    expect(container.textContent).toContain("评论B");
    expect(container.textContent).not.toContain("评论A");
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  it("切换笔记立即清空上一篇的草稿与回复目标，不带入下一篇", async () => {
    render("note-a");
    await flushLoad(
      state.supabase.threadSelects[0],
      [threadRow("t-a", "note-a")],
      [commentRow("c-a", "t-a", "评论A")],
    );

    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, "上一篇的草稿");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".note-page-comment button")!.click();
    });
    expect(textarea.value).toBe("上一篇的草稿");
    expect(container.textContent).toContain("正在回复评论");

    // 切到 B：草稿、回复目标立刻清空（B 的加载仍挂着）
    render("note-b");
    expect(textarea.value).toBe("");
    expect(container.textContent).not.toContain("正在回复评论");
    // 旧评论列表也不再闪现
    expect(container.textContent).not.toContain("评论A");
  });

  it("加载失败显示错误与重试；重试成功后清错误", async () => {
    render("note-a");
    await act(async () => {
      state.supabase.threadSelects[0].deferred.reject(new Error("network down"));
    });
    expect(container.textContent).toContain("评论加载失败");

    const retry = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("重试"),
    );
    expect(retry).toBeTruthy();

    await act(async () => {
      retry!.click();
    });
    await flushLoad(
      state.supabase.threadSelects[1],
      [threadRow("t-a", "note-a")],
      [commentRow("c-a", "t-a", "评论A")],
    );
    expect(container.textContent).not.toContain("评论加载失败");
    expect(container.textContent).toContain("评论A");
  });

  it("发送评论绑定发起时的笔记；切走后不把结果写回当前视图", async () => {
    render("note-a");
    await flushLoad(
      state.supabase.threadSelects[0],
      [threadRow("t-a", "note-a")],
      [commentRow("c-a", "t-a", "评论A")],
    );

    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, "给A的评论");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="发送评论"]')!.click();
    });

    // 建楼请求挂起期间切到 B（草稿被重置清空）
    render("note-b");
    expect(textarea.value).toBe("");

    const threadInsert = state.supabase.inserts.find((i) => i.table === "note_comment_threads");
    expect(threadInsert?.payload.note_id).toBe("note-a");
    await act(async () => {
      threadInsert!.deferred.resolve({
        data: threadRow("t-new", "note-a"),
        error: null,
      });
    });
    const commentInsert = state.supabase.inserts.find((i) => i.table === "note_comments");
    expect(commentInsert?.payload.body).toBe("给A的评论");
    await act(async () => {
      commentInsert!.deferred.resolve({ data: null, error: null });
    });

    // B 的视图不被污染：不出现「给A的评论」，也不触发 B 的额外加载
    expect(container.textContent).not.toContain("给A的评论");
    expect(textarea.value).toBe("");
    // B 的加载仍是唯一在途请求（A 的收尾没有为 B 发起新一轮）
    expect(state.supabase.threadSelects.filter((s) => s.noteId === "note-b")).toHaveLength(1);
  });
});
