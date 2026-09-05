// @vitest-environment jsdom

import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncedBlock } from "./synced-block";
import {
  SYNCED_REMOTE_META,
  classifyConflict,
  clearSyncedPending,
  createSyncSessionId,
  fetchSyncedBlock,
  patchSyncedBlock,
  readSyncedPending,
  replaceSyncedBlockContent,
  shouldAcceptSyncMessage,
  syncedBlockNeedsSync,
  writeSyncedPending,
  type StoredSyncedPending,
  type SyncMessage,
} from "./synced-block-sync";

const syncedId = "11111111-1111-4111-8111-111111111111";

function createEditor(content: JSONContent) {
  return new Editor({
    extensions: [StarterKit, SyncedBlock],
    content,
  });
}

const blockDoc = (text: string): JSONContent => ({
  type: "doc",
  content: [
    { type: "syncedBlock", attrs: { syncedId, hydrated: true }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  ],
});

describe("syncedBlockNeedsSync：事务过滤", () => {
  it("光标/选区移动（无 docChanged）不需要同步", () => {
    const editor = createEditor(blockDoc("内容"));
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)
    );
    expect(syncedBlockNeedsSync(tr, 0)).toEqual({ changed: false });
    editor.destroy();
  });

  it("编辑块内文字需要同步", () => {
    const editor = createEditor(blockDoc("内容甲"));
    // 块内段落文字起点为 pos 2（0=块前，1=段落前）
    const tr = editor.state.tr.insertText("X", 2);
    expect(syncedBlockNeedsSync(tr, 0)).toEqual({ changed: true });
    editor.destroy();
  });

  it("编辑其它块不触发本块同步（位置映射后内容一致）", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前面的独立段落" }] },
        { type: "syncedBlock", attrs: { syncedId, hydrated: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "块内容" }] }] },
      ],
    });
    const blockPos = editor.state.doc.nodeAt(0) ? 1 : 1; // paragraph 后块位置
    // 在第一个段落追加文字（块位置因此后移）
    const tr = editor.state.tr.insertText("X", 1);
    // 新文档里块的位置 = 原 1 + 1
    expect(syncedBlockNeedsSync(tr, blockPos + 1)).toEqual({ changed: false });
    editor.destroy();
  });

  it("仅属性变化（hydrated 标记）不算内容同步", () => {
    const editor = createEditor(blockDoc("内容"));
    const tr = editor.state.tr.setNodeMarkup(0, undefined, { syncedId, hydrated: true });
    expect(syncedBlockNeedsSync(tr, 0)).toEqual({ changed: false });
    editor.destroy();
  });

  it("带远端 meta 的回写事务不算需要同步（杜绝回声）", () => {
    const editor = createEditor(blockDoc("旧内容"));
    const tr = editor.state.tr
      .setMeta(SYNCED_REMOTE_META, { syncedId })
      .replaceWith(1, 3, editor.schema.nodeFromJSON({ type: "paragraph", content: [{ type: "text", text: "新内容" }] }));
    expect(syncedBlockNeedsSync(tr, 0)).toEqual({ changed: false });
    editor.destroy();
  });
});

describe("replaceSyncedBlockContent：远端替换", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("替换内容并带远端 meta 与 addToHistory=false", () => {
    const editor = createEditor(blockDoc("旧内容"));
    const dispatched: string[] = [];
    const originalDispatch = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (tr) => {
      dispatched.push(String(tr.getMeta(SYNCED_REMOTE_META)));
      return originalDispatch(tr);
    };
    const ok = replaceSyncedBlockContent(editor, 0, [{ type: "paragraph", content: [{ type: "text", text: "远端内容" }] }], syncedId);
    expect(ok).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).not.toBe("undefined");
    const block = editor.getJSON().content?.[0];
    expect(JSON.stringify(block?.content)).toContain("远端内容");
    editor.destroy();
  });
});

describe("传输层：HTTP 状态与响应形状先行", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PATCH 500 不算成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{\"error\":\"boom\"}", { status: 500 })));
    const result = await patchSyncedBlock(syncedId, [], 1);
    expect(result).toEqual({ ok: false, reason: "http", status: 500 });
  });

  it("PATCH 200 但坏 JSON 不算成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
    const result = await patchSyncedBlock(syncedId, [], 1);
    expect(result).toEqual({ ok: false, reason: "shape" });
  });

  it("PATCH 409 返回服务端当前 revision/content（冲突路径）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "同步区块已被其他修改更新", current: { revision: 3, content: [{ type: "paragraph" }] } }),
      { status: 409 }
    )));
    const result = await patchSyncedBlock(syncedId, [], 2);
    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      currentRevision: 3,
      currentContent: [{ type: "paragraph" }],
    });
  });

  it("PATCH 200 且形状正确才算成功（带新 revision）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: syncedId, revision: 2, updated_at: "2026-09-05T00:00:00Z" }), { status: 200 })));
    const result = await patchSyncedBlock(syncedId, [{ type: "paragraph" }], 1);
    expect(result).toEqual({ ok: true, revision: 2, updatedAt: "2026-09-05T00:00:00Z" });
  });

  it("GET 401 不算成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{\"error\":\"未授权\"}", { status: 401 })));
    const result = await fetchSyncedBlock(syncedId);
    expect(result).toEqual({ ok: false, reason: "http", status: 401 });
  });

  it("GET 空数组判为 not-found（本地内容保留）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const result = await fetchSyncedBlock(syncedId);
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("GET 成功返回内容与 revision", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify([{ id: syncedId, content: [{ type: "paragraph" }], revision: 4, updated_at: "2026-09-05T01:00:00Z" }]),
      { status: 200 }
    )));
    const result = await fetchSyncedBlock(syncedId);
    expect(result).toEqual({ ok: true, content: [{ type: "paragraph" }], revision: 4, updatedAt: "2026-09-05T01:00:00Z" });
  });
});

describe("R05 冲突决策与 pending 持久化", () => {
  it("classifyConflict：内容一致 = 幂等命中，不一致 = 真实冲突", () => {
    const pending = [{ type: "paragraph", content: [{ type: "text", text: "本地" }] }];
    expect(classifyConflict(pending, pending)).toBe("idempotent-hit");
    expect(classifyConflict([{ type: "paragraph" }], pending)).toBe("conflict");
    expect(classifyConflict(null, pending)).toBe("conflict");
  });

  it("pending 持久化按 userId+syncedId 键隔离，换账号读不到", () => {
    const storage = new MemoryStorage();
    const pending: StoredSyncedPending = {
      version: 1,
      syncedId,
      userId: "user-a",
      revision: 3,
      content: [{ type: "paragraph", content: [{ type: "text", text: "离线修改" }] }],
      savedAt: "2026-09-05T00:00:00Z",
    };
    expect(writeSyncedPending(storage, pending)).toBe(true);
    expect(readSyncedPending(storage, "user-a", syncedId)?.content).toEqual(pending.content);
    // 换账号：不把别人的 pending 写进自己的块
    expect(readSyncedPending(storage, "user-b", syncedId)).toBeNull();
    clearSyncedPending(storage, "user-a", syncedId);
    expect(readSyncedPending(storage, "user-a", syncedId)).toBeNull();
  });

  it("pending 持久化损坏数据视为不存在", () => {
    const storage = new MemoryStorage();
    storage.setItem(`organize:synced-pending:user-a:${syncedId}`, "{bad");
    expect(readSyncedPending(storage, "user-a", syncedId)).toBeNull();
  });
});

class MemoryStorage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
}

describe("shouldAcceptSyncMessage：来源识别", () => {
  const makeMessage = (over: Partial<SyncMessage>): SyncMessage => ({
    syncedId,
    content: [],
    updatedAt: "2026-09-05T00:00:00Z",
    origin: "session-a",
    seq: 1,
    ...over,
  });

  it("忽略自己 origin 的消息（同页回声）", () => {
    const seen = new Map<string, number>();
    expect(shouldAcceptSyncMessage(makeMessage({ origin: "me" }), "me", seen)).toBe(false);
  });

  it("接受他人首条消息，重放/乱序（seq 不增）被忽略", () => {
    const seen = new Map<string, number>();
    expect(shouldAcceptSyncMessage(makeMessage({ seq: 1 }), "me", seen)).toBe(true);
    expect(shouldAcceptSyncMessage(makeMessage({ seq: 1 }), "me", seen)).toBe(false);
    expect(shouldAcceptSyncMessage(makeMessage({ seq: 0 }), "me", seen)).toBe(false);
    expect(shouldAcceptSyncMessage(makeMessage({ seq: 2 }), "me", seen)).toBe(true);
  });

  it("损坏消息被忽略", () => {
    const seen = new Map<string, number>();
    expect(shouldAcceptSyncMessage(null, "me", seen)).toBe(false);
    expect(shouldAcceptSyncMessage(makeMessage({ syncedId: "" }), "me", seen)).toBe(false);
    expect(shouldAcceptSyncMessage(makeMessage({ seq: Number.NaN }), "me", seen)).toBe(false);
  });
});

describe("createSyncSessionId", () => {
  it("两次生成不重复", () => {
    expect(createSyncSessionId()).not.toBe(createSyncSessionId());
  });
});
