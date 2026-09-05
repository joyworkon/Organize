// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { NoteDraftSnapshot } from "@/lib/notes/local-draft";
import {
  createNoteSaveSession,
  type NoteSaveSessionDeps,
  type NoteSaveTransport,
} from "./note-save-session";
import type { PendingNoteCreate } from "@/lib/offline/note-queue";
import type { TransactionSource } from "@/lib/collab/transaction-source";

const draft = (over: Partial<NoteDraftSnapshot> = {}): NoteDraftSnapshot => ({
  title: "标题",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  icon: null,
  cover_url: null,
  cover_position: 50,
  parent_note_id: null,
  full_width: false,
  font_family: "default",
  small_font: false,
  ...over,
});

function makeDeps(over?: Partial<NoteSaveSessionDeps> & { transport?: Partial<NoteSaveTransport> }) {
  const draftRef = { current: draft() };
  const uiNotifications: number[] = [];
  const savedEvents: { noteId: string; title: string }[] = [];
  const notesChanged = vi.fn();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const transport: NoteSaveTransport = {
    save: vi.fn(async () => ({ data: { status: "ok", note_revision: 1 }, error: null })),
    fetchRemoteDraft: vi.fn(async () => null),
    fetchProfileName: vi.fn(async () => null),
    findPendingCreate: vi.fn(() => null),
    removePendingCreate: vi.fn(),
    insertPendingCreate: vi.fn(async () => ({ error: null })),
    ...over?.transport,
  };
  const deps: NoteSaveSessionDeps = {
    noteId: "note-1",
    accountId: "user-1",
    draftRef,
    getRole: () => "owner",
    isCollabActive: () => false,
    isOnline: () => true,
    isTaskNoteLinkEnabled: () => true,
    transport,
    consumeSkipFlush: () => false,
    timers: {
      setTimeout: (handler, ms) => {
        const handle = setTimeout(handler, ms);
        timers.push(handle);
        return handle;
      },
      clearTimeout: (handle) => clearTimeout(handle),
    },
    randomId: () => `mut-${Math.random().toString(36).slice(2)}`,
    debounceMs: 0,
    callbacks: {
      onUiState: () => uiNotifications.push(1),
      onNotesChanged: notesChanged,
      onSaved: (info) => savedEvents.push(info),
    },
    ...over,
  };
  return { deps, draftRef, transport, savedEvents, notesChanged, uiNotifications };
}

describe("note-save-session：保存主链", () => {
  it("成功保存推进 revision、发 saved 事件、flush 返回 saved", async () => {
    const { deps, transport } = makeDeps();
    const session = createNoteSaveSession(deps);
    session.setContent({ type: "doc", content: [] }, "user");
    const result = await session.flush();
    expect(result).toEqual({ status: "saved", revision: 1 });
    expect(transport.save).toHaveBeenCalledTimes(1);
    const input = (transport.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.rpcName).toBe("save_note_with_tasks"); // owner 角色
    expect(input.pExpectedNoteRevision).toBe(0);
    expect(input.pMutationId).toMatch(/^mut-/);
    expect(session.isDirty()).toBe(false);
  });

  it("协作激活时走 v2 RPC 且 expected=null", async () => {
    const { deps, transport } = makeDeps();
    const session = createNoteSaveSession({ ...deps, isCollabActive: () => true });
    session.setContent({ type: "doc" }, "user");
    await session.flush();
    const input = (transport.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.rpcName).toBe("save_note_with_tasks_v2");
    expect(input.pExpectedNoteRevision).toBeNull();
  });

  it("viewer 不写：flush 直接 not-needed，零网络请求", async () => {
    const { deps, transport } = makeDeps();
    const session = createNoteSaveSession({ ...deps, getRole: () => "viewer" });
    session.setContent({ type: "doc" }, "user");
    const result = await session.flush();
    expect(result.status).toBe("not-needed");
    expect(transport.save).not.toHaveBeenCalled();
  });

  it("保存中继续输入：同一 flush 的排空循环串行处理，前一次响应不清掉后一次 dirty", async () => {
    const { deps, transport } = makeDeps();
    let resolveFirst: (v: { data: { status: string; note_revision: number } | null; error: unknown }) => void = () => {};
    (transport.save as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(async () => ({ data: { status: "ok", note_revision: 2 }, error: null }));
    const session = createNoteSaveSession(deps);
    session.setContent({ type: "doc", content: [{ type: "text" }] }, "user");
    const flushPromise = session.flush();
    // 第一轮在途时继续编辑：排空循环必须再跑一轮，不能把后一次编辑丢掉
    session.setContent({ type: "doc", content: [{ type: "text" }, { type: "text" }] }, "user");
    resolveFirst({ data: { status: "ok", note_revision: 1 }, error: null });
    const result = await flushPromise;
    expect(result.status).toBe("saved");
    expect(transport.save).toHaveBeenCalledTimes(2);
    // 第二轮保存的是完整的新内容，且以第一轮返回的 revision 为基准
    const secondCall = (transport.save as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect((secondCall.pContent as { content: unknown[] }).content).toHaveLength(2);
    expect(secondCall.pExpectedNoteRevision).toBe(1);
    expect(session.isDirty()).toBe(false);
  });

  it("网络响应丢失：重试复用同一 mutationId（幂等键），不会多建版本", async () => {
    vi.useFakeTimers();
    const ids: string[] = [];
    const { deps, transport } = makeDeps();
    (transport.save as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () => ({ data: null, error: new TypeError("Failed to fetch: network reset") }))
      .mockImplementationOnce(async (input) => {
        ids.push(input.pMutationId);
        return { data: { status: "ok", note_revision: 1 }, error: null };
      });
    const session = createNoteSaveSession(deps);
    session.setContent({ type: "doc" }, "user");
    const first = await session.flush();
    expect(first.status).toBe("error");
    // 退避定时器到点自动重试；内容未变 → 复用同一 mutation id
    await vi.runAllTimersAsync();
    expect(transport.save).toHaveBeenCalledTimes(2);
    const retryInput = (transport.save as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(retryInput.pMutationId).toBe(
      (transport.save as ReturnType<typeof vi.fn>).mock.calls[0][0].pMutationId
    );
    vi.useRealTimers();
  });

  it("hydrate / remote-sync 来源不提取任务 mutation，user 来源提取", async () => {
    const { deps, transport } = makeDeps();
    const session = createNoteSaveSession(deps);
    const content = {
      type: "doc",
      content: [
        { type: "taskItem", attrs: { checked: false, id: "b1", taskId: "task-9" }, content: [{ type: "paragraph", content: [{ type: "text", text: "任务甲" }] }] },
      ],
    };
    session.setContent(content, "hydrate");
    await session.flush();
    expect((transport.save as ReturnType<typeof vi.fn>).mock.calls[0][0].pTaskMutations).toBeNull();

    session.setContent(content, "user");
    await session.flush();
    const mutations = (transport.save as ReturnType<typeof vi.fn>).mock.calls[1][0].pTaskMutations;
    expect(Array.isArray(mutations)).toBe(true);
    expect((mutations as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("note-save-session：冲突", () => {
  async function enterConflict() {
    const { deps, transport } = makeDeps();
    (transport.save as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { status: "conflict_note", current_revision: 7 },
      error: null,
    });
    (transport.fetchRemoteDraft as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      draft: draft({ title: "远端标题" }),
      lastEditBy: "user-1",
      contentRevision: 7,
      updatedAt: "2026-09-05T00:00:00Z",
    });
    const session = createNoteSaveSession(deps);
    session.setContent({ type: "doc" }, "user");
    const result = await session.flush();
    return { session, result, deps, transport };
  }

  it("冲突不自动覆盖：停在 conflict 状态，归因为自己其他设备", async () => {
    const { session, result, transport } = await enterConflict();
    expect(result.status).toBe("conflict");
    expect(transport.save).toHaveBeenCalledTimes(1);
    const ui = session.getUiState();
    expect(ui.conflict?.actor).toEqual({ kind: "self", name: null });
    expect(ui.conflict?.currentRevision).toBe(7);
    expect(ui.conflict?.remoteDraft?.title).toBe("远端标题");
  });

  it("用本地覆盖：以服务端 currentRevision 为基准重新保存", async () => {
    const { session, transport } = await enterConflict();
    (transport.save as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { status: "ok", note_revision: 8 },
      error: null,
    });
    session.resolveConflictOverwriteRemote();
    await vi.waitFor(() => {
      expect(transport.save).toHaveBeenCalledTimes(2);
    });
    const input = (transport.save as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(input.pExpectedNoteRevision).toBe(7);
    expect(input.rpcName).toBe("save_note_with_tasks");
    expect(session.getRevision()).toBe(8);
  });

  it("采用远端：清 dirty 与本地草稿、清冲突（页面随后自行重载内容）", async () => {
    const { session } = await enterConflict();
    session.resolveConflictReloadRemote();
    expect(session.isDirty()).toBe(false);
    expect(session.getUiState().conflict).toBeNull();
  });
});

describe("note-save-session：离线与离线创建", () => {
  it("离线：保留 dirty 并报 offline-pending，不发起请求", async () => {
    const { deps, transport } = makeDeps();
    const session = createNoteSaveSession({ ...deps, isOnline: () => false });
    session.setContent({ type: "doc" }, "user");
    const result = await session.flush();
    expect(result.status).toBe("offline-pending");
    expect(transport.save).not.toHaveBeenCalled();
    expect(session.isDirty()).toBe(true);
    expect(session.getUiState().offlinePending).toBe(true);
  });

  it("离线创建滞留队列：先落创建再保存；23505 主键冲突视为已创建继续保存", async () => {
    const { deps, transport } = makeDeps();
    const pending: PendingNoteCreate = {
      op_id: "op-1",
      note: { title: "离线新建", content: { type: "doc" } },
      created_at: Date.now(),
    };
    (transport.findPendingCreate as ReturnType<typeof vi.fn>).mockReturnValue(pending);
    (transport.insertPendingCreate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: { code: "23505" },
    });
    const session = createNoteSaveSession(deps);
    session.setContent({ type: "doc" }, "user");
    const result = await session.flush();
    expect(result.status).toBe("saved");
    expect(transport.insertPendingCreate).toHaveBeenCalledTimes(1);
    expect(transport.removePendingCreate).toHaveBeenCalledTimes(1);
    expect(transport.save).toHaveBeenCalledTimes(1);
  });
});

describe("note-save-session：历史恢复与生命周期", () => {
  it("恢复历史后：skip-flush 被消费，flush 不把旧草稿写回", async () => {
    let flag = true;
    const { deps, transport } = makeDeps({
      consumeSkipFlush: () => {
        const value = flag;
        flag = false;
        return value;
      },
    });
    const session = createNoteSaveSession(deps);
    session.setContent({ type: "doc" }, "user");
    const result = await session.flush();
    expect(result.status).toBe("not-needed");
    expect(transport.save).not.toHaveBeenCalled();
    expect(session.isDirty()).toBe(false);
  });

  it("会话销毁后：在途保存回调不产生事件、不写状态（A/B 切换隔离）", async () => {
    const { deps, transport, savedEvents } = makeDeps();
    let resolveSave: (v: { data: { status: string; note_revision: number } | null; error: unknown }) => void = () => {};
    (transport.save as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; })
    );
    const session = createNoteSaveSession(deps);
    session.setContent({ type: "doc" }, "user");
    const inFlight = session.flush();
    // 切换到笔记 B：旧会话销毁
    session.destroy();
    resolveSave({ data: { status: "ok", note_revision: 1 }, error: null });
    const result = await inFlight;
    expect(result.status).toBe("superseded");
    expect(savedEvents).toHaveLength(0);
    expect(session.getRevision()).toBe(0);
  });

  it("destroy 清理重试定时器：销毁后退避重试不再发起", async () => {
    vi.useFakeTimers();
    const { deps, transport } = makeDeps();
    (transport.save as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: new TypeError("Failed to fetch") });
    const session = createNoteSaveSession(deps);
    session.setContent({ type: "doc" }, "user");
    await session.flush();
    session.destroy();
    await vi.runAllTimersAsync();
    expect(transport.save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("queueSave 防抖：多次编辑只排一次 flush", async () => {
    vi.useFakeTimers();
    const { deps, transport } = makeDeps();
    const session = createNoteSaveSession(deps);
    session.queueSave();
    session.queueSave();
    session.queueSave();
    await vi.advanceTimersByTimeAsync(900);
    expect(transport.save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("本机草稿写入失败如实上报（quota 注入），写入恢复后回到 ok", async () => {
    const quotaError = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const { deps } = makeDeps();
    const session = createNoteSaveSession(deps);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError;
    });
    try {
      session.queueSave();
      expect(session.getUiState().localPersistence).toBe("failed");
    } finally {
      spy.mockRestore();
    }
    session.queueSave();
    expect(session.getUiState().localPersistence).toBe("ok");
  });
});
