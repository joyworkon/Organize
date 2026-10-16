// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { NoteDraftSnapshot } from "@/lib/notes/local-draft";
import {
  createNoteSaveSession,
  type NoteSaveSessionDeps,
  type NoteSaveTransport,
} from "./note-save-session";
import { flushDraftBeforeHistoryRestore } from "./history-restore";

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

describe("flushDraftBeforeHistoryRestore：历史恢复前保全当前稿", () => {
  it("无脏稿：不触发 flush，直接放行恢复", async () => {
    const flushSaved = vi.fn(async () => true);
    const allowed = await flushDraftBeforeHistoryRestore({
      hasPendingWork: () => false,
      flushSaved,
    });
    expect(allowed).toBe(true);
    expect(flushSaved).not.toHaveBeenCalled();
  });

  it("有脏稿：先等 flush 完成才放行，恢复动作排在保存之后", async () => {
    let resolveFlush: (saved: boolean) => void = () => {};
    const flushSaved = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFlush = resolve;
        })
    );
    const restore = vi.fn(async () => true);
    const gate = flushDraftBeforeHistoryRestore({
      hasPendingWork: () => true,
      flushSaved,
    });
    const restored = gate.then((allowed) => (allowed ? restore() : null));
    // flush 尚未完成：恢复不得先行
    expect(flushSaved).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
    resolveFlush(true);
    await restored;
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("flush 失败（保存网络错误）：阻断恢复，当前稿仍完整保留在会话中", async () => {
    vi.useFakeTimers();
    try {
      const draftRef = { current: draft() };
      const transport: NoteSaveTransport = {
        save: vi.fn(async () => ({ data: null, error: new TypeError("Failed to fetch") })),
        fetchRemoteDraft: vi.fn(async () => null),
        fetchProfileName: vi.fn(async () => null),
        findPendingCreate: vi.fn(() => null),
        removePendingCreate: vi.fn(),
        insertPendingCreate: vi.fn(async () => ({ error: null })),
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
          setTimeout: (handler, ms) => setTimeout(handler, ms),
          clearTimeout: (handle) => clearTimeout(handle),
        },
        randomId: () => "mut-test",
        debounceMs: 0,
        callbacks: { onUiState: () => {}, onNotesChanged: () => {}, onSaved: () => {} },
      };
      const session = createNoteSaveSession(deps);
      const edited = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "未上传的编辑" }] },
        ],
      };
      session.setContent(edited, "user");
      expect(session.hasPendingWork()).toBe(true);

      const allowed = await flushDraftBeforeHistoryRestore({
        hasPendingWork: () => session.hasPendingWork(),
        flushSaved: () => session.flushSaved(),
      });
      expect(allowed).toBe(false);
      expect(session.isDirty()).toBe(true);
      expect(session.exportSnapshot().content).toEqual(edited);
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushSaved 抛异常：按失败阻断，不把异常抛给恢复入口", async () => {
    const allowed = await flushDraftBeforeHistoryRestore({
      hasPendingWork: () => true,
      flushSaved: () => Promise.reject(new Error("boom")),
    });
    expect(allowed).toBe(false);
  });
});
