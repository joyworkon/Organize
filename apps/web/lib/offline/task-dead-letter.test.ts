// @vitest-environment jsdom
/**
 * 任务离线 dead-letter 测试（P1-03）：拒绝入账、同 op_id 去重、按 userId 隔离、
 * 移除、重试重置（expected 置 null）、写盘失败上报。
 */
import { describe, expect, it } from "vitest";
import {
  addTaskDeadLetterEntry,
  readTaskDeadLetter,
  removeTaskDeadLetterEntry,
  resetOpForRetry,
  taskDeadLetterCount,
  writeTaskDeadLetter,
} from "./task-dead-letter";
import { makeTaskUpdateOp } from "./task-queue";

const USER_A = "user-aaaa";
const USER_B = "user-bbbb";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, next: string) => { map.set(key, next); },
  } as Pick<Storage, "getItem" | "setItem">;
}

const CONFLICT = { code: "TASK_SYNC_CONFLICT", message: "任务已在其他设备被修改" };

describe("task dead-letter（P1-03）", () => {
  it("拒绝的操作入账并保留 code/message", () => {
    const storage = memoryStorage();
    const op = makeTaskUpdateOp("t1", { title: "离线改" }, 5);
    const { persisted } = addTaskDeadLetterEntry(storage, USER_A, { op, error: CONFLICT });
    expect(persisted).toBe(true);
    const entries = readTaskDeadLetter(storage, USER_A);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      op_id: op.op_id,
      code: "TASK_SYNC_CONFLICT",
      message: "任务已在其他设备被修改",
    });
    expect(entries[0].op.type).toBe("update");
  });

  it("同 op_id 重复入账去重（重试风暴不膨胀）", () => {
    const storage = memoryStorage();
    const op = makeTaskUpdateOp("t1", { title: "x" }, 5);
    addTaskDeadLetterEntry(storage, USER_A, { op, error: CONFLICT });
    addTaskDeadLetterEntry(storage, USER_A, { op, error: CONFLICT });
    expect(taskDeadLetterCount(storage, USER_A)).toBe(1);
  });

  it("按 userId 隔离：退出后另一账号登录看不到别人的失败记录", () => {
    const storage = memoryStorage();
    addTaskDeadLetterEntry(storage, USER_A, {
      op: makeTaskUpdateOp("t1", { title: "A 的" }, 1),
      error: CONFLICT,
    });
    expect(taskDeadLetterCount(storage, USER_B)).toBe(0);
    expect(readTaskDeadLetter(storage, USER_B)).toEqual([]);
    expect(taskDeadLetterCount(storage, USER_A)).toBe(1);
  });

  it("移除指定条目（人工丢弃）", () => {
    const storage = memoryStorage();
    const op = makeTaskUpdateOp("t1", { title: "x" }, 1);
    addTaskDeadLetterEntry(storage, USER_A, { op, error: CONFLICT });
    const rest = removeTaskDeadLetterEntry(storage, USER_A, op.op_id);
    expect(rest).toEqual([]);
  });

  it("重试重置：update 的 expected 版本置 null（以服务端当前状态重放），op_id 保持幂等链", () => {
    const op = makeTaskUpdateOp("t1", { title: "x" }, 5);
    const retried = resetOpForRetry(op);
    expect(retried).toMatchObject({ op_id: op.op_id, expected_sync_version: null });
    // 非 update 操作原样返回
    const createLike = { op_id: "c1", type: "checklist_update" as const, id: "c", patch: {}, created_at: 0 };
    expect(resetOpForRetry(createLike)).toBe(createLike);
  });

  it("写盘失败上报 persisted=false", () => {
    const broken = {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
    } as Pick<Storage, "getItem" | "setItem">;
    const result = addTaskDeadLetterEntry(broken, USER_A, {
      op: makeTaskUpdateOp("t1", { title: "x" }, 1),
      error: CONFLICT,
    });
    expect(result.persisted).toBe(false);
    // writeTaskDeadLetter 直接失败同样上报
    expect(writeTaskDeadLetter(broken, USER_A, [])).toBe(false);
  });
});
