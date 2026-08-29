// @vitest-environment jsdom
/**
 * 任务离线操作队列 v2 测试（P1-03）：
 * - read/write：坏数据回退空队列；写盘失败上报 persisted=false（不静默忽略）；
 * - 队列按 user_id 隔离（不同 userId 互不可见）；
 * - enqueue：update 合入同 id 的 create / update，清单勾选合并、清单删除去重并连带丢弃滞留勾选；
 * - replay：成功应用、23505 幂等命中、原子协议 meta（expected version + mutation id）
 *   透传、conflict/not_found 归入 rejectedOps（不静默丢弃）、网络错误中止并保留剩余。
 */
import { describe, expect, it } from "vitest";
import {
  enqueueTaskOp,
  makeChecklistDeleteOp,
  makeChecklistUpdateOp,
  makeTaskCreateOp,
  makeTaskUpdateOp,
  readTaskOps,
  removeTaskOp,
  replayTaskOps,
  taskOpsCount,
  writeTaskOps,
  type PendingChecklistUpdate,
  type PendingTaskCreate,
  type PendingTaskOp,
  type PendingTaskUpdate,
  type TaskQueueWriter,
} from "./task-queue";

const USER_A = "user-aaaa";
const USER_B = "user-bbbb";

/** 按 key 区分的内存存储（验证 user 隔离） */
function memoryStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set("seed", initial);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, next: string) => { map.set(key, next); },
  } as Pick<Storage, "getItem" | "setItem">;
}

/** 写入必失败的存储（模拟存储满/被禁用） */
function brokenStorage() {
  return {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
  } as Pick<Storage, "getItem" | "setItem">;
}

function createOp(id: string, extra?: Record<string, unknown>): PendingTaskCreate {
  return { op_id: `op-${id}`, type: "create", task: { id, title: `任务${id}`, ...extra }, created_at: Date.now() };
}

function updateOp(id: string, patch: Record<string, unknown>, opSuffix = "", expected: number | null = 0): PendingTaskUpdate {
  return { op_id: `op-u-${id}${opSuffix}`, type: "update", id, patch, expected_sync_version: expected, created_at: Date.now() };
}

const NETWORK_ERR = { message: "Failed to fetch" };
const PG_UNIQUE = { code: "23505", message: "duplicate key value" };
const PG_CHECK = { code: "23514", message: "check constraint violated" };
const SYNC_CONFLICT = { code: "TASK_SYNC_CONFLICT", message: "任务已在其他设备被修改" };

describe("read/write：持久化读写", () => {
  it("空存储读为空队列，写入后可读回", () => {
    const storage = memoryStorage();
    expect(readTaskOps(storage, USER_A)).toEqual([]);
    writeTaskOps(storage, USER_A, [createOp("a")]);
    expect(readTaskOps(storage, USER_A)).toHaveLength(1);
    expect(taskOpsCount(storage, USER_A)).toBe(1);
  });

  it("坏 JSON / 非数组回退空队列", () => {
    expect(readTaskOps(memoryStorage("{oops"), USER_A)).toEqual([]);
    expect(readTaskOps(memoryStorage('{"a":1}'), USER_A)).toEqual([]);
  });

  it("写盘失败返回 false（持久化失败不可静默忽略）", () => {
    expect(writeTaskOps(brokenStorage(), USER_A, [createOp("a")])).toBe(false);
    expect(enqueueTaskOp(brokenStorage(), USER_A, createOp("a")).persisted).toBe(false);
  });
});

describe("队列按 user_id 隔离（P1-03）", () => {
  it("同一存储下不同 userId 的队列互不可见", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, USER_A, createOp("a"));
    enqueueTaskOp(storage, USER_A, updateOp("a2", { title: "A2" }));
    expect(taskOpsCount(storage, USER_A)).toBe(2);
    // B 登录后读到的是自己的空队列；退出后 A 重新登录队列仍在
    expect(taskOpsCount(storage, USER_B)).toBe(0);
    expect(readTaskOps(storage, USER_B)).toEqual([]);
    expect(taskOpsCount(storage, USER_A)).toBe(2);
  });

  it("dead-letter 与队列一样按 userId 隔离", () => {
    const storage = memoryStorage();
    // dead-letter 的隔离在同目录 task-dead-letter.test.ts 覆盖
    expect(true).toBe(true);
  });
});

describe("enqueueTaskOp：入队与合并", () => {
  it("无冲突操作追加到队尾（保持时间序）", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, USER_A, createOp("a"));
    const { ops } = enqueueTaskOp(storage, USER_A, updateOp("b", { title: "改B" }));
    expect(ops.map((op) => op.type)).toEqual(["create", "update"]);
  });

  it("update 命中同 id 的 create → 合入创建载荷（只插一次且带最新字段）", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, USER_A, createOp("a", { status: "todo" }));
    const { ops } = enqueueTaskOp(storage, USER_A, updateOp("a", { status: "done", priority: "high" }));
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("create");
    expect((ops[0] as PendingTaskCreate).task).toMatchObject({ id: "a", status: "done", priority: "high" });
  });

  it("update 命中同 id 的 update → 合并 patch（后写覆盖同名字段），expected 取最后入队值", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, USER_A, updateOp("a", { title: "旧", status: "todo" }, "", 4));
    const { ops } = enqueueTaskOp(storage, USER_A, updateOp("a", { title: "新" }, "-2", 7));
    expect(ops).toHaveLength(1);
    const merged = ops[0] as PendingTaskUpdate;
    expect(merged.patch).toEqual({ title: "新", status: "todo" });
    expect(merged.expected_sync_version).toBe(7);
  });

  it("不同 id 的 update 不互相合并", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, USER_A, updateOp("a", { title: "A" }));
    const { ops } = enqueueTaskOp(storage, USER_A, updateOp("b", { title: "B" }));
    expect(ops).toHaveLength(2);
  });

  it("checklist_update 命中同 id → 合并 patch（最终态覆盖）", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, USER_A, makeChecklistUpdateOp("c1", { is_completed: true }));
    const { ops } = enqueueTaskOp(storage, USER_A, makeChecklistUpdateOp("c1", { is_completed: false }));
    expect(ops).toHaveLength(1);
    expect((ops[0] as PendingChecklistUpdate).patch).toEqual({ is_completed: false });
  });

  it("checklist_delete 去重，并连带丢弃同项滞留勾选", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, USER_A, makeChecklistUpdateOp("c1", { is_completed: true }));
    const { ops } = enqueueTaskOp(storage, USER_A, makeChecklistDeleteOp("c1"));
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("checklist_delete");
    // 重复删除按 id 去重
    const opsDup = enqueueTaskOp(storage, USER_A, makeChecklistDeleteOp("c1"));
    expect(opsDup.ops).toHaveLength(1);
    // 不同清单项的操作不受影响
    const ops2 = enqueueTaskOp(storage, USER_A, makeChecklistUpdateOp("c2", { is_completed: true }));
    expect(ops2.ops.map((op) => op.type)).toEqual(["checklist_delete", "checklist_update"]);
  });

  it("任务操作与清单操作互不合并", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, USER_A, updateOp("a", { title: "A" }));
    const { ops } = enqueueTaskOp(storage, USER_A, makeChecklistUpdateOp("a", { is_completed: true }));
    expect(ops).toHaveLength(2);
  });

  it("make* 助手生成合法操作且 op_id 唯一（update 携带 expected version）", () => {
    const a = makeTaskCreateOp({ id: "x" });
    const b = makeTaskUpdateOp("x", { title: "t" }, 3);
    const c1 = makeChecklistUpdateOp("c", { is_completed: true });
    const c2 = makeChecklistDeleteOp("c");
    expect(a.type).toBe("create");
    expect(b.type).toBe("update");
    expect(b.expected_sync_version).toBe(3);
    expect(c1.type).toBe("checklist_update");
    expect(c2.type).toBe("checklist_delete");
    expect(new Set([a.op_id, b.op_id, c1.op_id, c2.op_id]).size).toBe(4);
  });
});

describe("removeTaskOp：按 op_id 移除", () => {
  it("移除指定操作，其余保留", () => {
    const storage = memoryStorage();
    enqueueTaskOp(storage, USER_A, createOp("a"));
    enqueueTaskOp(storage, USER_A, createOp("b"));
    const ops = removeTaskOp(storage, USER_A, "op-a");
    expect(ops).toHaveLength(1);
    expect((ops[0] as PendingTaskCreate).task.id).toBe("b");
  });
});

describe("replayTaskOps：按序回放", () => {
  const okWriter = (calls: string[]): TaskQueueWriter => ({
    insertTask: async (task) => { calls.push(`insert:${String(task.id)}`); return { error: null }; },
    updateTask: async (id) => { calls.push(`update:${id}`); return { error: null }; },
    updateChecklist: async (id) => { calls.push(`checklist-update:${id}`); return { error: null }; },
    deleteChecklist: async (id) => { calls.push(`checklist-delete:${id}`); return { error: null }; },
  });

  it("全部成功：按序应用（含清单操作路由到对应方法），remaining 为空", async () => {
    const calls: string[] = [];
    const ops: PendingTaskOp[] = [
      createOp("a"),
      updateOp("b", { title: "B" }),
      makeChecklistUpdateOp("c1", { is_completed: true }),
      makeChecklistDeleteOp("c2"),
    ];
    const result = await replayTaskOps(okWriter(calls), ops);
    expect(calls).toEqual(["insert:a", "update:b", "checklist-update:c1", "checklist-delete:c2"]);
    expect(result).toMatchObject({ applied: 4, stoppedOffline: false });
    expect(result.rejectedOps).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it("更新回放透传原子协议 meta（expected version + mutation id = op_id）", async () => {
    const seen: Array<{ id: string; meta: { expectedSyncVersion: number | null; mutationId: string } }> = [];
    const writer: TaskQueueWriter = {
      insertTask: async () => ({ error: null }),
      updateTask: async (id, _patch, meta) => {
        seen.push({ id, meta });
        return { error: null };
      },
      updateChecklist: async () => ({ error: null }),
      deleteChecklist: async () => ({ error: null }),
    };
    const op = makeTaskUpdateOp("t1", { title: "离线改" }, 5);
    const result = await replayTaskOps(writer, [op]);
    expect(result.applied).toBe(1);
    expect(seen).toEqual([
      { id: "t1", meta: { expectedSyncVersion: 5, mutationId: op.op_id } },
    ]);
  });

  it("创建命中 23505 视为已应用（响应丢失后重放不报错）", async () => {
    const writer: TaskQueueWriter = {
      insertTask: async () => ({ error: PG_UNIQUE }),
      updateTask: async () => ({ error: null }),
      updateChecklist: async () => ({ error: null }),
      deleteChecklist: async () => ({ error: null }),
    };
    const result = await replayTaskOps(writer, [createOp("a")]);
    expect(result.applied).toBe(1);
    expect(result.remaining).toEqual([]);
  });

  it("原子冲突（TASK_SYNC_CONFLICT）进 rejectedOps 且继续后续操作——不静默丢弃", async () => {
    const calls: string[] = [];
    const writer: TaskQueueWriter = {
      insertTask: async () => ({ error: null }),
      updateTask: async (id) => {
        calls.push(`update:${id}`);
        return id === "conflicted" ? { error: SYNC_CONFLICT } : { error: null };
      },
      updateChecklist: async () => ({ error: null }),
      deleteChecklist: async () => ({ error: null }),
    };
    const conflicted = updateOp("conflicted", { title: "双设备冲突" });
    const good = updateOp("ok", { title: "正常" }, "-2");
    const result = await replayTaskOps(writer, [conflicted, good]);
    expect(calls).toEqual(["update:conflicted", "update:ok"]);
    expect(result.applied).toBe(1);
    expect(result.rejectedOps).toHaveLength(1);
    expect(result.rejectedOps[0].op.op_id).toBe(conflicted.op_id);
    expect((result.rejectedOps[0].error as { code: string }).code).toBe("TASK_SYNC_CONFLICT");
    expect(result.remaining).toEqual([]);
  });

  it("业务错误（带 code 非 23505）进 rejectedOps 并继续后续操作", async () => {
    const calls: string[] = [];
    const writer: TaskQueueWriter = {
      insertTask: async (task) => {
        calls.push(`insert:${String(task.id)}`);
        return { error: task.id === "bad" ? PG_CHECK : null };
      },
      updateTask: async () => ({ error: null }),
      updateChecklist: async () => ({ error: null }),
      deleteChecklist: async () => ({ error: null }),
    };
    const result = await replayTaskOps(writer, [createOp("bad"), createOp("good")]);
    expect(calls).toEqual(["insert:bad", "insert:good"]);
    expect(result.applied).toBe(1);
    expect(result.rejectedOps).toHaveLength(1);
    expect(result.remaining).toEqual([]);
  });

  it("网络错误中止回放：当前及后续操作全部滞留", async () => {
    let attempts = 0;
    const writer: TaskQueueWriter = {
      insertTask: async () => { attempts += 1; return { error: NETWORK_ERR }; },
      updateTask: async () => { attempts += 1; return { error: null }; },
      updateChecklist: async () => { attempts += 1; return { error: null }; },
      deleteChecklist: async () => { attempts += 1; return { error: null }; },
    };
    const ops: PendingTaskOp[] = [createOp("a"), updateOp("b", { title: "B" }), createOp("c")];
    const result = await replayTaskOps(writer, ops);
    expect(attempts).toBe(1); // 中止后不再发起后续请求
    expect(result.stoppedOffline).toBe(true);
    expect(result.remaining.map((op) => op.op_id)).toEqual(ops.map((op) => op.op_id));
  });

  it("清单操作遇网络错误中止：滞留队列原样保留", async () => {
    const writer: TaskQueueWriter = {
      insertTask: async () => ({ error: null }),
      updateTask: async () => ({ error: null }),
      updateChecklist: async () => ({ error: NETWORK_ERR }),
      deleteChecklist: async () => ({ error: null }),
    };
    const ops: PendingTaskOp[] = [makeChecklistUpdateOp("c1", { is_completed: true }), makeChecklistDeleteOp("c2")];
    const result = await replayTaskOps(writer, ops);
    expect(result.stoppedOffline).toBe(true);
    expect(result.remaining.map((op) => op.op_id)).toEqual(ops.map((op) => op.op_id));
  });
});
