// @vitest-environment jsdom
/**
 * X1 第二阶段 B——笔记离线创建队列测试：
 * - read/write：坏数据回退空队列；
 * - enqueue：同 note id 去重（最新载荷为准），不同 id 按序追加；
 * - find/remove：按 note id 定位与移除；
 * - 账号隔离：存储 key 按 user_id 区分，换号后互不可见、互不影响；
 *   旧版全局 key 的存量在各自属主首次读取时迁走；
 * - replay：成功应用、23505 幂等命中、业务错误丢弃、网络错误中止并保留剩余、
 *   不属于本人的操作不发送也不丢弃。
 */
import { describe, expect, it } from "vitest";
import {
  enqueueNoteCreate,
  findNoteCreate,
  makeNoteCreateOp,
  noteCreatesCount,
  noteCreatesStorageKey,
  readNoteCreates,
  removeNoteCreate,
  replayNoteCreates,
  writeNoteCreates,
  type NoteCreateWriter,
  type PendingNoteCreate,
} from "./note-queue";

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
const LEGACY_KEY = "organize:offline:note-creates:v1";
const A = "user-a";
const B = "user-b";

function createOp(noteId: string, userId = A, extra?: Record<string, unknown>): PendingNoteCreate {
  return {
    op_id: `op-${noteId}-${Math.random().toString(36).slice(2, 8)}`,
    note: { id: noteId, user_id: userId, title: "无标题笔记", ...extra },
    created_at: Date.now(),
  };
}

const ids = (ops: PendingNoteCreate[]) => ops.map((op) => op.note.id);
const storedIds = (raw: string | null) => (JSON.parse(raw ?? "[]") as PendingNoteCreate[]).map((op) => op.note.id);

const NETWORK_ERR = { message: "Failed to fetch" };
const PG_UNIQUE = { code: "23505", message: "duplicate key value" };
const PG_CHECK = { code: "23514", message: "check constraint violated" };
/** notes 的插入策略拒绝「不是自己的行」时 PostgREST 返回的错误 */
const RLS_DENIED = { code: "42501", message: 'new row violates row-level security policy for table "notes"' };

describe("read/write：持久化读写", () => {
  it("空存储读为空队列，写入后可读回", () => {
    const storage = memoryStorage();
    expect(readNoteCreates(storage, A)).toEqual([]);
    writeNoteCreates(storage, A, [createOp("a")]);
    expect(readNoteCreates(storage, A)).toHaveLength(1);
    expect(noteCreatesCount(storage, A)).toBe(1);
  });

  it("坏 JSON / 非数组回退空队列", () => {
    expect(readNoteCreates(memoryStorage({ [noteCreatesStorageKey(A)]: "{oops" }), A)).toEqual([]);
    expect(readNoteCreates(memoryStorage({ [noteCreatesStorageKey(A)]: '{"a":1}' }), A)).toEqual([]);
  });
});

describe("enqueue/find/remove：队列维护", () => {
  it("不同 note id 按序追加", () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, A, createOp("a"));
    const { ops } = enqueueNoteCreate(storage, A, createOp("b"));
    expect(ids(ops)).toEqual(["a", "b"]);
  });

  it("同 note id 重复入队以最新载荷为准（不重复插入）", () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, A, createOp("a", A, { title: "旧" }));
    const { ops } = enqueueNoteCreate(storage, A, createOp("a", A, { title: "新" }));
    expect(ops).toHaveLength(1);
    expect(ops[0].note.title).toBe("新");
  });

  it("enqueue 返回 persisted（持久化失败调用方可知）", () => {
    const okStorage = memoryStorage();
    expect(enqueueNoteCreate(okStorage, A, createOp("a")).persisted).toBe(true);
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(enqueueNoteCreate(throwingStorage, A, createOp("a")).persisted).toBe(false);
  });

  it("findNoteCreate 按 note id 定位", () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, A, createOp("a"));
    expect(findNoteCreate(storage, A, "a")?.note.id).toBe("a");
    expect(findNoteCreate(storage, A, "zzz")).toBeNull();
  });

  it("removeNoteCreate 按 note id 移除", () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, A, createOp("a"));
    enqueueNoteCreate(storage, A, createOp("b"));
    const ops = removeNoteCreate(storage, A, "a");
    expect(ids(ops)).toEqual(["b"]);
  });

  it("makeNoteCreateOp 生成合法操作且 op_id 唯一", () => {
    const a = makeNoteCreateOp({ id: "x" });
    const b = makeNoteCreateOp({ id: "x" });
    expect(a.note.id).toBe("x");
    expect(a.op_id).not.toBe(b.op_id);
  });
});

describe("账号隔离：存储 key 按 user_id 区分", () => {
  it("key = 固定前缀 + user_id", () => {
    expect(noteCreatesStorageKey(A)).toBe(`organize:offline:note-creates:v1:${A}`);
    expect(noteCreatesStorageKey(A)).not.toBe(noteCreatesStorageKey(B));
  });

  it("换号后新账号看不到、也动不了上一位的离线笔记", () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, A, createOp("a1"));

    expect(readNoteCreates(storage, B)).toEqual([]);
    expect(noteCreatesCount(storage, B)).toBe(0);
    expect(findNoteCreate(storage, B, "a1")).toBeNull();
    removeNoteCreate(storage, B, "a1");
    expect(ids(readNoteCreates(storage, A))).toEqual(["a1"]);

    enqueueNoteCreate(storage, B, createOp("b1", B));
    expect(ids(readNoteCreates(storage, A))).toEqual(["a1"]);
    expect(ids(readNoteCreates(storage, B))).toEqual(["b1"]);
  });

  it("旧版全局 key：各属主首次读取时迁走自己的条目，其余原样保留", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: JSON.stringify([createOp("a1", A), createOp("b1", B)]) });

    expect(ids(readNoteCreates(storage, A))).toEqual(["a1"]);
    expect(storedIds(storage.raw(LEGACY_KEY))).toEqual(["b1"]);
    expect(storedIds(storage.raw(noteCreatesStorageKey(A)))).toEqual(["a1"]);

    expect(ids(readNoteCreates(storage, B))).toEqual(["b1"]);
    expect(JSON.parse(storage.raw(LEGACY_KEY) ?? "null")).toEqual([]);
  });

  it("旧版全局 key：本人一条都没有也记为迁移完成，之后的入队不再触碰旧 key", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: JSON.stringify([createOp("b1", B)]) });

    expect(readNoteCreates(storage, A)).toEqual([]);
    enqueueNoteCreate(storage, A, createOp("a2"));

    expect(storedIds(storage.raw(noteCreatesStorageKey(A)))).toEqual(["a2"]);
    expect(storedIds(storage.raw(LEGACY_KEY))).toEqual(["b1"]);
  });

  it("旧版全局 key：没有属主信息的条目留在旧 key 里，不会安到任何人头上", () => {
    const ownerless = { op_id: "junk", note: { id: "no-owner" }, created_at: 1 };
    const storage = memoryStorage({ [LEGACY_KEY]: JSON.stringify([createOp("a1", A), ownerless]) });

    expect(ids(readNoteCreates(storage, A))).toEqual(["a1"]);
    expect(storedIds(storage.raw(LEGACY_KEY))).toEqual(["no-owner"]);
    expect(readNoteCreates(storage, B)).toEqual([]);
  });

  it("旧版全局 key：当前账号已迁移过就不再读旧 key", () => {
    const storage = memoryStorage({
      [noteCreatesStorageKey(A)]: JSON.stringify([createOp("a1")]),
      [LEGACY_KEY]: JSON.stringify([createOp("a9")]),
    });

    expect(ids(readNoteCreates(storage, A))).toEqual(["a1"]);
    expect(storedIds(storage.raw(LEGACY_KEY))).toEqual(["a9"]);
  });

  it("旧版全局 key 里的坏数据按空队列处理，不影响当前账号", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: "{oops" });

    expect(readNoteCreates(storage, A)).toEqual([]);
    expect(storage.raw(noteCreatesStorageKey(A))).toBe("[]");
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
    expect(() => readNoteCreates(throwing, A)).not.toThrow();
    expect(readNoteCreates(throwing, A)).toEqual([]);
  });
});

describe("replayNoteCreates：按序回放", () => {
  it("全部成功：按序应用，remaining 为空", async () => {
    const calls: string[] = [];
    const writer: NoteCreateWriter = {
      insertNote: async (note) => { calls.push(String(note.id)); return { error: null }; },
    };
    const result = await replayNoteCreates(writer, [createOp("a"), createOp("b")], A);
    expect(calls).toEqual(["a", "b"]);
    expect(result).toMatchObject({ applied: 2, rejected: 0, foreign: 0, stoppedOffline: false });
    expect(result.remaining).toEqual([]);
  });

  it("命中 23505 视为已应用（响应丢失后重放不报错）", async () => {
    const writer: NoteCreateWriter = { insertNote: async () => ({ error: PG_UNIQUE }) };
    const result = await replayNoteCreates(writer, [createOp("a")], A);
    expect(result.applied).toBe(1);
    expect(result.remaining).toEqual([]);
  });

  it("业务错误（带 code 非 23505）丢弃该条并继续后续操作", async () => {
    const calls: string[] = [];
    const writer: NoteCreateWriter = {
      insertNote: async (note) => {
        calls.push(String(note.id));
        return { error: note.id === "bad" ? PG_CHECK : null };
      },
    };
    const result = await replayNoteCreates(writer, [createOp("bad"), createOp("good")], A);
    expect(calls).toEqual(["bad", "good"]);
    expect(result).toMatchObject({ applied: 1, rejected: 1 });
    expect(result.remaining).toEqual([]);
  });

  it("网络错误中止回放：当前及后续操作全部滞留", async () => {
    let attempts = 0;
    const writer: NoteCreateWriter = {
      insertNote: async () => { attempts += 1; return { error: NETWORK_ERR }; },
    };
    const ops = [createOp("a"), createOp("b"), createOp("c")];
    const result = await replayNoteCreates(writer, ops, A);
    expect(attempts).toBe(1); // 中止后不再发起后续请求
    expect(result.stoppedOffline).toBe(true);
    expect(ids(result.remaining)).toEqual(["a", "b", "c"]);
  });

  it("不属于本人的操作不发送也不丢弃，原样留给属主", async () => {
    const calls: string[] = [];
    const writer: NoteCreateWriter = {
      insertNote: async (note) => { calls.push(String(note.id)); return { error: null }; },
    };
    const result = await replayNoteCreates(writer, [createOp("a1"), createOp("b1", B), createOp("a2")], A);

    expect(calls).toEqual(["a1", "a2"]);
    expect(result).toMatchObject({ applied: 2, rejected: 0, foreign: 1 });
    expect(ids(result.remaining)).toEqual(["b1"]);
  });

  it("网络错误中止后，本人未发送的与不属于本人的都留在 remaining", async () => {
    const writer: NoteCreateWriter = { insertNote: async () => ({ error: NETWORK_ERR }) };
    const result = await replayNoteCreates(writer, [createOp("a1"), createOp("b1", B), createOp("a2")], A);

    expect(result.stoppedOffline).toBe(true);
    expect(result.foreign).toBe(1);
    expect(ids(result.remaining)).toEqual(["a1", "b1", "a2"]);
  });

  it("换号后回放：上一位的离线创建不会被以新账号的会话发送，更不会永久丢失", async () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, A, createOp("a1"));

    // 新账号按自己的 key 读队列：上一位的条目根本读不到，没有东西可回放
    expect(readNoteCreates(storage, B)).toEqual([]);

    // 即使上一位的条目被误传进回放（例如调用方传错数组），也不能发送：
    // 以 B 的会话插入 user_id = A 的行会被 RLS 拒绝，按「服务端拒绝」丢弃就等于替 A 删了笔记
    const rejecting: NoteCreateWriter = { insertNote: async () => ({ error: RLS_DENIED }) };
    const result = await replayNoteCreates(rejecting, [createOp("a1")], B);
    writeNoteCreates(storage, B, result.remaining);

    expect(result).toMatchObject({ applied: 0, rejected: 0, foreign: 1 });
    expect(ids(readNoteCreates(storage, B))).toEqual(["a1"]);
    expect(ids(readNoteCreates(storage, A))).toEqual(["a1"]);
  });
});
