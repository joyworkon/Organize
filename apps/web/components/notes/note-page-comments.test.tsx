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
interface UpdateCall {
  table: string;
  payload: Record<string, unknown>;
  filters: Record<string, unknown>;
  deferred: Deferred;
}
interface DeleteCall {
  table: string;
  filters: Record<string, unknown>;
  deferred: Deferred;
}

function createFakeSupabase() {
  const threadSelects: ThreadSelect[] = [];
  const commentSelects: CommentSelect[] = [];
  const inserts: InsertCall[] = [];
  const updates: UpdateCall[] = [];
  const deletes: DeleteCall[] = [];

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
        update(payload: Record<string, unknown>) {
          deferred = makeDeferred();
          updates.push({ table, payload, filters, deferred });
          return builder;
        },
        delete() {
          deferred = makeDeferred();
          deletes.push({ table, filters, deferred });
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
  return { client, threadSelects, commentSelects, inserts, updates, deletes };
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

describe("NotePageComments 空状态与可访问性", () => {
  it("加载中隐藏空态，加载完成且无评论时显示空态，输入框仍可用", async () => {
    render("note-a");
    expect(container.textContent).toContain("加载评论...");
    expect(container.textContent).not.toContain("还没有评论");

    await flushLoad(state.supabase.threadSelects[0], []);

    expect(container.textContent).toContain("还没有评论");
    expect(container.textContent).not.toContain("加载评论...");
    const textarea = container.querySelector("textarea")!;
    expect(textarea.getAttribute("aria-label")).toBe("写下评论");
    expect(textarea.placeholder).toBe("写下评论...");
    expect(textarea.disabled).toBe(false);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, "第一条评论");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea.value).toBe("第一条评论");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="发送评论"]')!.disabled).toBe(false);
  });

  it("已有评论时显示评论内容而非空态", async () => {
    render("note-a");
    await flushLoad(
      state.supabase.threadSelects[0],
      [threadRow("t-a", "note-a")],
      [commentRow("c-a", "t-a", "已有评论")],
    );

    expect(container.textContent).toContain("已有评论");
    expect(container.textContent).not.toContain("还没有评论");
  });
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
    expect(container.textContent).not.toContain("还没有评论");

    const retry = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("重试"),
    );
    expect(retry).toBeTruthy();

    await act(async () => {
      retry!.click();
    });
    expect(container.textContent).toContain("加载评论...");
    expect(container.textContent).not.toContain("还没有评论");
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

describe("NotePageComments 解决/删除写诚实性", () => {
  function findAction(text: string): HTMLButtonElement {
    return [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(text),
    )! as HTMLButtonElement;
  }

  async function renderWithThread() {
    render("note-a");
    await flushLoad(
      state.supabase.threadSelects[0],
      [threadRow("t-a", "note-a")],
      [commentRow("c-a", "t-a", "评论A")],
    );
  }

  it("解决返回 0 行（RLS 拒绝/行不存在）时显示失败文案，不重新加载", async () => {
    await renderWithThread();

    const resolveButton = findAction("解决");
    await act(async () => {
      resolveButton.click();
    });

    // 进行中：该线程按钮禁用，请求结束后恢复
    expect(resolveButton.disabled).toBe(true);
    const update = state.supabase.updates[0];
    expect(update?.table).toBe("note_comment_threads");
    expect(update?.filters).toMatchObject({ id: "t-a", note_id: "note-a" });
    expect(typeof update?.payload.resolved_at).toBe("string");

    await act(async () => {
      update!.deferred.resolve({ data: [], error: null });
    });

    expect(container.textContent).toContain("评论状态更新失败");
    expect(container.textContent).toContain("评论A");
    // 没有触发重新加载（仍是首次那次）
    expect(state.supabase.threadSelects).toHaveLength(1);
    expect(findAction("解决").disabled).toBe(false);
  });

  it("删除返回 0 行时显示失败文案，不重新加载", async () => {
    await renderWithThread();

    await act(async () => {
      findAction("删除").click();
    });
    const deletion = state.supabase.deletes[0];
    expect(deletion?.table).toBe("note_comment_threads");
    expect(deletion?.filters).toMatchObject({ id: "t-a", note_id: "note-a" });

    await act(async () => {
      deletion!.deferred.resolve({ data: [], error: null });
    });

    expect(container.textContent).toContain("删除评论失败");
    expect(container.textContent).toContain("评论A");
    expect(state.supabase.threadSelects).toHaveLength(1);
  });

  it("解决请求抛异常时显示失败文案，不产生未处理 rejection", async () => {
    await renderWithThread();

    await act(async () => {
      findAction("解决").click();
    });
    await act(async () => {
      state.supabase.updates[0].deferred.reject(new Error("network down"));
    });

    expect(container.textContent).toContain("评论状态更新失败");
    expect(container.textContent).toContain("评论A");
    expect(state.supabase.threadSelects).toHaveLength(1);
    expect(findAction("解决").disabled).toBe(false);
  });

  it("解决成功后重新加载并展示最新状态", async () => {
    await renderWithThread();

    await act(async () => {
      findAction("解决").click();
    });
    await act(async () => {
      state.supabase.updates[0].deferred.resolve({ data: [{ id: "t-a" }], error: null });
    });

    // 成功 → 触发新一轮加载
    expect(state.supabase.threadSelects).toHaveLength(2);
    expect(container.textContent).not.toContain("评论状态更新失败");
    await flushLoad(
      state.supabase.threadSelects[1],
      [{ ...threadRow("t-a", "note-a"), resolved_at: "2026-10-19T01:00:00Z" }],
      [commentRow("c-a", "t-a", "评论A")],
    );
    expect(container.textContent).toContain("重新打开");
    expect(findAction("重新打开").disabled).toBe(false);
  });
});

describe("NotePageComments 发送回滚诚实性", () => {
  /** 建楼成功、首条评论 insert 失败，进入回滚分支前的公共前置 */
  async function startFailingSubmit(body: string) {
    render("note-a");
    await flushLoad(state.supabase.threadSelects[0], []);

    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, body);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="发送评论"]')!.click();
    });

    const threadInsert = state.supabase.inserts.find((i) => i.table === "note_comment_threads");
    await act(async () => {
      threadInsert!.deferred.resolve({ data: threadRow("t-new", "note-a"), error: null });
    });
    const commentInsert = state.supabase.inserts.find((i) => i.table === "note_comments");
    expect(commentInsert?.payload.body).toBe(body);
    await act(async () => {
      commentInsert!.deferred.resolve({ data: null, error: { message: "insert failed" } });
    });
  }

  it("评论写入失败且回滚成功：通用失败文案、草稿保留、不重新加载", async () => {
    await startFailingSubmit("保留的草稿");

    const rollback = state.supabase.deletes[0];
    expect(rollback?.table).toBe("note_comment_threads");
    expect(rollback?.filters).toMatchObject({ id: "t-new", note_id: "note-a" });
    await act(async () => {
      rollback!.deferred.resolve({ data: [{ id: "t-new" }], error: null });
    });

    expect(container.textContent).toContain("评论发送失败，请稍后重试");
    expect(container.textContent).not.toContain("空评论未能撤回");
    expect(container.querySelector("textarea")!.value).toBe("保留的草稿");
    // 回滚成功：不触发重新加载（仍是首次那次）
    expect(state.supabase.threadSelects).toHaveLength(1);
  });

  it("回滚删除返回 0 行（RLS 拒绝）：具体文案、刷新列表、草稿保留", async () => {
    await startFailingSubmit("保留的草稿");

    await act(async () => {
      state.supabase.deletes[0].deferred.resolve({ data: [], error: null });
    });
    // 回滚失败 → 触发新一轮加载反映残留的空线程
    expect(state.supabase.threadSelects).toHaveLength(2);
    await flushLoad(state.supabase.threadSelects[1], [threadRow("t-new", "note-a")], []);

    expect(container.textContent).toContain("评论发送失败，且空评论未能撤回，请刷新后处理");
    expect(container.querySelector("textarea")!.value).toBe("保留的草稿");
  });

  it("回滚删除抛异常：具体文案、无未处理 rejection、原错误不被回滚异常掩盖", async () => {
    await startFailingSubmit("保留的草稿");

    await act(async () => {
      state.supabase.deletes[0].deferred.reject(new Error("network down"));
    });
    expect(state.supabase.threadSelects).toHaveLength(2);
    await flushLoad(state.supabase.threadSelects[1], [threadRow("t-new", "note-a")], []);

    expect(container.textContent).toContain("评论发送失败，且空评论未能撤回，请刷新后处理");
    expect(container.querySelector("textarea")!.value).toBe("保留的草稿");
  });
});
