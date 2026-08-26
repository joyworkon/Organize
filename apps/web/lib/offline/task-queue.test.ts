// @vitest-environment jsdom
/**
 * X1 第二阶段——任务离线操作队列测试：
 * - read/write：坏数据回退空队列；
 * - enqueue：update 合入同 id 的 create / update，其余按时间序追加；
 * - replay：成功应用、23505 幂等命中、业务错误丢弃、网络错误中止并保留剩余。
 */
import { describe, expect, it } from "vitest";
import {
  enqueueTaskOp,
  makeTaskCreateOp,
  makeTaskUpdateOp,
  readTaskOps,
  removeTaskOp,
  replayTaskOps,
  taskOpsCount,
  writeTaskOps,
  type PendingTaskCreate,
  type PendingTaskOp,
  type PendingTaskUpdate,
  type TaskQueueWriter,
} from "./task-queue";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  } as Pick<Storage, "getItem" | "setItem">;
}

function createOp(id: string, extra?: Record<string, unknown>): PendingTaskCreate {
  return { op_id: `op-${id}`, type: "create", task: { id, title: `任务${id}`, ...extra }, created_at: Date.now() };
}

function updateOp(id: string, patch: Record<string, unknown>, opSuffix = ""): PendingTaskUpdate {
  return { op_id: `op-u-${id}${opSuffix}`, type: "update", id, patch, created_at: Date.now() };
}

const NETWORK_ERR = { message: "Failed to fetch" };
const PG_UNIQUE = { code: "23505", message: "duplicate key value" };
const PG_CHECK = { code: "23514", message: "check constraint violated" };

describe("read/write：持久化读写", () => {
  it("空存储读为空队列，写入后可读回", () => {
    const storage = memoryStorage();
    expect(readTaskOps(storage)).toEqual([]);
    writeTaskOps(storage, [createOp("a")]);
    expect(readTaskOps(storage)).toHaveLength(1);
    expect(taskOpsCount(storage)).toBe(1);
  });

  it("坏 JSON / 非数组回退空队列", () => {
    expect(readTaskOps(memoryStorage("{oops"))).toEqual([]);
    expect(readTaskOps(memoryStorage('{"a":1}'))).toEqual([]);
  });
});

describe("enqueueTaskOp：入队与合并", () => {
  it("无冲突操作追加到队尾（保持时间序）", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, createOp("a"));
    const ops = enqueueTaskOp(storage, updateOp("b", { title: "改B" }));
    expect(ops.map((op) => op.type)).toEqual(["create", "update"]);
  });

  it("update 命中同 id 的 create → 合入创建载荷（只插一次且带最新字段）", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, createOp("a", { status: "todo" }));
    const ops = enqueueTaskOp(storage, updateOp("a", { status: "done", priority: "high" }));
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("create");
    expect((ops[0] as PendingTaskCreate).task).toMatchObject({ id: "a", status: "done", priority: "high" });
  });

  it("update 命中同 id 的 update → 合并 patch（后写覆盖同名字段）", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, updateOp("a", { title: "旧", status: "todo" }));
    const ops = enqueueTaskOp(storage, updateOp("a", { title: "新" }, "-2"));
    expect(ops).toHaveLength(1);
    expect((ops[0] as PendingTaskUpdate).patch).toEqual({ title: "新", status: "todo" });
  });

  it("不同 id 的 update 不互相合并", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, updateOp("a", { title: "A" }));
    const ops = enqueueTaskOp(storage, updateOp("b", { title: "B" }));
    expect(ops).toHaveLength(2);
  });

  it("make* 助手生成合法操作且 op_id 唯一", () => {
    const a = makeTaskCreateOp({ id: "x" });
    const b = makeTaskUpdateOp("x", { title: "t" });
    expect(a.type).toBe("create");
    expect(b.type).toBe("update");
    expect(a.op_id).not.toBe(b.op_id);
  });
});

describe("removeTaskOp：按 op_id 移除", () => {
  it("移除指定操作，其余保留", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, createOp("a"));
    enqueueTaskOp(storage, createOp("b"));
    const ops = removeTaskOp(storage, "op-a");
    expect(ops).toHaveLength(1);
    expect((ops[0] as PendingTaskCreate).task.id).toBe("b");
  });
});

describe("replayTaskOps：按序回放", () => {
  const okWriter = (calls: string[]): TaskQueueWriter => ({
    insertTask: async (task) => { calls.push(`insert:${String(task.id)}`); return { error: null }; },
    updateTask: async (id) => { calls.push(`update:${id}`); return { error: null }; },
  });

  it("全部成功：按序应用，remaining 为空", async () => {
    const calls: string[] = [];
    const ops: PendingTaskOp[] = [createOp("a"), updateOp("b", { title: "B" })];
    const result = await replayTaskOps(okWriter(calls), ops);
    expect(calls).toEqual(["insert:a", "update:b"]);
    expect(result).toMatchObject({ applied: 2, rejected: 0, stoppedOffline: false });
    expect(result.remaining).toEqual([]);
  });

  it("创建命中 23505 视为已应用（响应丢失后重放不报错）", async () => {
    const writer: TaskQueueWriter = {
      insertTask: async () => ({ error: PG_UNIQUE }),
      updateTask: async () => ({ error: null }),
    };
    const result = await replayTaskOps(writer, [createOp("a")]);
    expect(result.applied).toBe(1);
    expect(result.remaining).toEqual([]);
  });

  it("业务错误（带 code 非 23505）丢弃该条并继续后续操作", async () => {
    const calls: string[] = [];
    const writer: TaskQueueWriter = {
      insertTask: async (task) => {
        calls.push(`insert:${String(task.id)}`);
        return { error: task.id === "bad" ? PG_CHECK : null };
      },
      updateTask: async () => ({ error: null }),
    };
    const result = await replayTaskOps(writer, [createOp("bad"), createOp("good")]);
    expect(calls).toEqual(["insert:bad", "insert:good"]);
    expect(result).toMatchObject({ applied: 1, rejected: 1 });
    expect(result.remaining).toEqual([]);
  });

  it("网络错误中止回放：当前及后续操作全部滞留", async () => {
    let attempts = 0;
    const writer: TaskQueueWriter = {
      insertTask: async () => { attempts += 1; return { error: NETWORK_ERR }; },
      updateTask: async () => { attempts += 1; return { error: null }; },
    };
    const ops: PendingTaskOp[] = [createOp("a"), updateOp("b", { title: "B" }), createOp("c")];
    const result = await replayTaskOps(writer, ops);
    expect(attempts).toBe(1); // 中止后不再发起后续请求
    expect(result.stoppedOffline).toBe(true);
    expect(result.remaining.map((op) => op.op_id)).toEqual(ops.map((op) => op.op_id));
  });
});
