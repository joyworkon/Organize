// @vitest-environment jsdom
/**
 * X1 第二阶段 B——笔记离线创建队列测试：
 * - read/write：坏数据回退空队列；
 * - enqueue：同 note id 去重（最新载荷为准），不同 id 按序追加；
 * - find/remove：按 note id 定位与移除；
 * - replay：成功应用、23505 幂等命中、业务错误丢弃、网络错误中止并保留剩余。
 */
import { describe, expect, it } from "vitest";
import {
  enqueueNoteCreate,
  findNoteCreate,
  makeNoteCreateOp,
  noteCreatesCount,
  readNoteCreates,
  removeNoteCreate,
  replayNoteCreates,
  writeNoteCreates,
  type NoteCreateWriter,
  type PendingNoteCreate,
} from "./note-queue";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  } as Pick<Storage, "getItem" | "setItem">;
}

function createOp(noteId: string, extra?: Record<string, unknown>): PendingNoteCreate {
  return {
    op_id: `op-${noteId}-${Math.random().toString(36).slice(2, 8)}`,
    note: { id: noteId, title: "无标题笔记", ...extra },
    created_at: Date.now(),
  };
}

const NETWORK_ERR = { message: "Failed to fetch" };
const PG_UNIQUE = { code: "23505", message: "duplicate key value" };
const PG_CHECK = { code: "23514", message: "check constraint violated" };

describe("read/write：持久化读写", () => {
  it("空存储读为空队列，写入后可读回", () => {
    const storage = memoryStorage();
    expect(readNoteCreates(storage)).toEqual([]);
    writeNoteCreates(storage, [createOp("a")]);
    expect(readNoteCreates(storage)).toHaveLength(1);
    expect(noteCreatesCount(storage)).toBe(1);
  });

  it("坏 JSON / 非数组回退空队列", () => {
    expect(readNoteCreates(memoryStorage("{oops"))).toEqual([]);
    expect(readNoteCreates(memoryStorage('{"a":1}'))).toEqual([]);
  });
});

describe("enqueue/find/remove：队列维护", () => {
  it("不同 note id 按序追加", () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, createOp("a"));
    const ops = enqueueNoteCreate(storage, createOp("b"));
    expect(ops.map((op) => op.note.id)).toEqual(["a", "b"]);
  });

  it("同 note id 重复入队以最新载荷为准（不重复插入）", () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, createOp("a", { title: "旧" }));
    const ops = enqueueNoteCreate(storage, createOp("a", { title: "新" }));
    expect(ops).toHaveLength(1);
    expect(ops[0].note.title).toBe("新");
  });

  it("findNoteCreate 按 note id 定位", () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, createOp("a"));
    expect(findNoteCreate(storage, "a")?.note.id).toBe("a");
    expect(findNoteCreate(storage, "zzz")).toBeNull();
  });

  it("removeNoteCreate 按 note id 移除", () => {
    const storage = memoryStorage();
    enqueueNoteCreate(storage, createOp("a"));
    enqueueNoteCreate(storage, createOp("b"));
    const ops = removeNoteCreate(storage, "a");
    expect(ops.map((op) => op.note.id)).toEqual(["b"]);
  });

  it("makeNoteCreateOp 生成合法操作且 op_id 唯一", () => {
    const a = makeNoteCreateOp({ id: "x" });
    const b = makeNoteCreateOp({ id: "x" });
    expect(a.note.id).toBe("x");
    expect(a.op_id).not.toBe(b.op_id);
  });
});

describe("replayNoteCreates：按序回放", () => {
  it("全部成功：按序应用，remaining 为空", async () => {
    const calls: string[] = [];
    const writer: NoteCreateWriter = {
      insertNote: async (note) => { calls.push(String(note.id)); return { error: null }; },
    };
    const result = await replayNoteCreates(writer, [createOp("a"), createOp("b")]);
    expect(calls).toEqual(["a", "b"]);
    expect(result).toMatchObject({ applied: 2, rejected: 0, stoppedOffline: false });
    expect(result.remaining).toEqual([]);
  });

  it("命中 23505 视为已应用（响应丢失后重放不报错）", async () => {
    const writer: NoteCreateWriter = { insertNote: async () => ({ error: PG_UNIQUE }) };
    const result = await replayNoteCreates(writer, [createOp("a")]);
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
    const result = await replayNoteCreates(writer, [createOp("bad"), createOp("good")]);
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
    const result = await replayNoteCreates(writer, ops);
    expect(attempts).toBe(1); // 中止后不再发起后续请求
    expect(result.stoppedOffline).toBe(true);
    expect(result.remaining.map((op) => op.note.id)).toEqual(["a", "b", "c"]);
  });
});
