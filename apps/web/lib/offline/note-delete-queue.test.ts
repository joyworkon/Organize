// @vitest-environment jsdom
/**
 * X1——笔记离线删除队列测试：
 * - read/write：坏数据回退空队列；
 * - enqueue：同 note id 去重，不同 id 按序追加；
 * - replay：成功应用、业务错误丢弃、网络错误中止并保留剩余。
 */
import { describe, expect, it } from "vitest";
import {
  enqueueNoteDelete,
  makeNoteDeleteOp,
  noteDeletesCount,
  readNoteDeletes,
  replayNoteDeletes,
  writeNoteDeletes,
  type NoteDeleteWriter,
  type PendingNoteDelete,
} from "./note-delete-queue";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  } as Pick<Storage, "getItem" | "setItem">;
}

function deleteOp(noteId: string): PendingNoteDelete {
  return { op_id: `op-${noteId}`, id: noteId, created_at: Date.now() };
}

const NETWORK_ERR = { message: "Failed to fetch" };
const PG_CHECK = { code: "23514", message: "check constraint violated" };

describe("read/write：持久化读写", () => {
  it("空存储读为空队列，写入后可读回", () => {
    const storage = memoryStorage();
    expect(readNoteDeletes(storage)).toEqual([]);
    writeNoteDeletes(storage, [deleteOp("a")]);
    expect(readNoteDeletes(storage)).toHaveLength(1);
    expect(noteDeletesCount(storage)).toBe(1);
  });

  it("坏 JSON / 非数组回退空队列", () => {
    expect(readNoteDeletes(memoryStorage("{oops"))).toEqual([]);
    expect(readNoteDeletes(memoryStorage('{"a":1}'))).toEqual([]);
  });
});

describe("enqueueNoteDelete：入队与去重", () => {
  it("不同 note id 按序追加", () => {
    const storage = memoryStorage();
    enqueueNoteDelete(storage, "a");
    const ops = enqueueNoteDelete(storage, "b");
    expect(ops.map((op) => op.id)).toEqual(["a", "b"]);
  });

  it("同 note id 重复入队只保留一条", () => {
    const storage = memoryStorage();
    enqueueNoteDelete(storage, "a");
    const ops = enqueueNoteDelete(storage, "a");
    expect(ops).toHaveLength(1);
  });

  it("makeNoteDeleteOp 生成合法操作且 op_id 唯一", () => {
    const a = makeNoteDeleteOp("x");
    const b = makeNoteDeleteOp("x");
    expect(a.id).toBe("x");
    expect(a.op_id).not.toBe(b.op_id);
  });
});

describe("replayNoteDeletes：按序回放", () => {
  it("全部成功：按序应用，remaining 为空", async () => {
    const calls: string[] = [];
    const writer: NoteDeleteWriter = {
      softDeleteNote: async (id) => { calls.push(id); return { error: null }; },
    };
    const result = await replayNoteDeletes(writer, [deleteOp("a"), deleteOp("b")]);
    expect(calls).toEqual(["a", "b"]);
    expect(result).toMatchObject({ applied: 2, rejected: 0, stoppedOffline: false });
    expect(result.remaining).toEqual([]);
  });

  it("业务错误（带 code）丢弃该条并继续后续操作", async () => {
    const calls: string[] = [];
    const writer: NoteDeleteWriter = {
      softDeleteNote: async (id) => {
        calls.push(id);
        return { error: id === "bad" ? PG_CHECK : null };
      },
    };
    const result = await replayNoteDeletes(writer, [deleteOp("bad"), deleteOp("good")]);
    expect(calls).toEqual(["bad", "good"]);
    expect(result).toMatchObject({ applied: 1, rejected: 1 });
    expect(result.remaining).toEqual([]);
  });

  it("网络错误中止回放：当前及后续操作全部滞留", async () => {
    let attempts = 0;
    const writer: NoteDeleteWriter = {
      softDeleteNote: async () => { attempts += 1; return { error: NETWORK_ERR }; },
    };
    const result = await replayNoteDeletes(writer, [deleteOp("a"), deleteOp("b"), deleteOp("c")]);
    expect(attempts).toBe(1); // 中止后不再发起后续请求
    expect(result.stoppedOffline).toBe(true);
    expect(result.remaining.map((op) => op.id)).toEqual(["a", "b", "c"]);
  });
});
