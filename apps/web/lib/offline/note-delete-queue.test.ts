// @vitest-environment jsdom
/**
 * X1——笔记离线删除队列测试：
 * - read/write：坏数据回退空队列；
 * - enqueue：同 note id 去重，不同 id 按序追加；
 * - 账号隔离：存储 key 按 user_id 区分，换号后互不可见；
 *   旧版全局 key 的存量整体迁给首个读取的账号；
 * - replay：成功应用、业务错误丢弃、网络错误中止并保留剩余。
 */
import { describe, expect, it } from "vitest";
import {
  enqueueNoteDelete,
  makeNoteDeleteOp,
  noteDeletesCount,
  noteDeletesStorageKey,
  readNoteDeletes,
  replayNoteDeletes,
  writeNoteDeletes,
  type NoteDeleteWriter,
  type PendingNoteDelete,
} from "./note-delete-queue";

/** 按 key 区分的内存存储：单格存储看不出 key 是否按账号区分 */
function memoryStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, next: string) => { map.set(key, next); },
    raw: (key: string) => map.get(key) ?? null,
  };
}

/** 旧版本（不分账号）用的全局 key */
const LEGACY_KEY = "organize:offline:note-deletes:v1";
const A = "user-a";
const B = "user-b";

function deleteOp(noteId: string): PendingNoteDelete {
  return { op_id: `op-${noteId}`, id: noteId, created_at: Date.now() };
}

const ids = (ops: PendingNoteDelete[]) => ops.map((op) => op.id);
const storedIds = (raw: string | null) => (JSON.parse(raw ?? "[]") as PendingNoteDelete[]).map((op) => op.id);

const NETWORK_ERR = { message: "Failed to fetch" };
const PG_CHECK = { code: "23514", message: "check constraint violated" };

describe("read/write：持久化读写", () => {
  it("空存储读为空队列，写入后可读回", () => {
    const storage = memoryStorage();
    expect(readNoteDeletes(storage, A)).toEqual([]);
    writeNoteDeletes(storage, A, [deleteOp("a")]);
    expect(readNoteDeletes(storage, A)).toHaveLength(1);
    expect(noteDeletesCount(storage, A)).toBe(1);
  });

  it("坏 JSON / 非数组回退空队列", () => {
    expect(readNoteDeletes(memoryStorage({ [noteDeletesStorageKey(A)]: "{oops" }), A)).toEqual([]);
    expect(readNoteDeletes(memoryStorage({ [noteDeletesStorageKey(A)]: '{"a":1}' }), A)).toEqual([]);
  });
});

describe("enqueueNoteDelete：入队与去重", () => {
  it("不同 note id 按序追加", () => {
    const storage = memoryStorage();
    enqueueNoteDelete(storage, A, "a");
    const ops = enqueueNoteDelete(storage, A, "b");
    expect(ids(ops)).toEqual(["a", "b"]);
  });

  it("同 note id 重复入队只保留一条", () => {
    const storage = memoryStorage();
    enqueueNoteDelete(storage, A, "a");
    const ops = enqueueNoteDelete(storage, A, "a");
    expect(ops).toHaveLength(1);
  });

  it("makeNoteDeleteOp 生成合法操作且 op_id 唯一", () => {
    const a = makeNoteDeleteOp("x");
    const b = makeNoteDeleteOp("x");
    expect(a.id).toBe("x");
    expect(a.op_id).not.toBe(b.op_id);
  });
});

describe("账号隔离：存储 key 按 user_id 区分", () => {
  it("key = 固定前缀 + user_id", () => {
    expect(noteDeletesStorageKey(A)).toBe(`organize:offline:note-deletes:v1:${A}`);
    expect(noteDeletesStorageKey(A)).not.toBe(noteDeletesStorageKey(B));
  });

  it("换号后新账号读不到上一位的离线删除，各自的队列互不影响", () => {
    const storage = memoryStorage();
    enqueueNoteDelete(storage, A, "a1");

    // 上一位的删除若被新账号回放：mutate_trash 按新账号执行，更新 0 行且不报错，
    // 会被当成「已应用」出队——上一位离线删掉的笔记就再也删不掉了
    expect(readNoteDeletes(storage, B)).toEqual([]);
    expect(noteDeletesCount(storage, B)).toBe(0);

    enqueueNoteDelete(storage, B, "b1");
    expect(ids(readNoteDeletes(storage, A))).toEqual(["a1"]);
    expect(ids(readNoteDeletes(storage, B))).toEqual(["b1"]);
  });

  it("旧版全局 key：整体迁给首个读取的账号，旧 key 清空，不会被后续账号重复接手", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: JSON.stringify([deleteOp("d1")]) });

    expect(ids(readNoteDeletes(storage, A))).toEqual(["d1"]);
    expect(storedIds(storage.raw(noteDeletesStorageKey(A)))).toEqual(["d1"]);
    expect(JSON.parse(storage.raw(LEGACY_KEY) ?? "null")).toEqual([]);

    expect(readNoteDeletes(storage, B)).toEqual([]);
  });

  it("旧版全局 key：当前账号已有队列时不再读旧 key", () => {
    const storage = memoryStorage({
      [noteDeletesStorageKey(A)]: JSON.stringify([deleteOp("a1")]),
      [LEGACY_KEY]: JSON.stringify([deleteOp("d9")]),
    });

    expect(ids(readNoteDeletes(storage, A))).toEqual(["a1"]);
    expect(storedIds(storage.raw(LEGACY_KEY))).toEqual(["d9"]);
  });

  it("旧版全局 key 里的坏数据按空队列处理", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: "{oops" });

    expect(readNoteDeletes(storage, A)).toEqual([]);
    expect(storage.raw(noteDeletesStorageKey(A))).toBe("[]");
    expect(storage.raw(LEGACY_KEY)).toBe("[]");
  });

  it("存储不可用时读取与迁移都不抛错", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => readNoteDeletes(throwing, A)).not.toThrow();
    expect(readNoteDeletes(throwing, A)).toEqual([]);
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
    expect(ids(result.remaining)).toEqual(["a", "b", "c"]);
  });
});
