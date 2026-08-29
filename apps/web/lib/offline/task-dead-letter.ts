/**
 * 任务离线队列的 dead-letter（P1-03）：回放或在线更新中被服务端拒绝（非网络失败，
 * 如双设备 conflict、任务已在别处被删、约束校验失败）的操作进入这里，UI 必须可见，
 * 用户可逐条「重试」（以服务端当前状态重放字段，expected 置 null）或「丢弃」。
 *
 * 与队列一样按 user_id 隔离（storage key 带 userId）。
 */

import type { PendingTaskOp } from "./task-queue";

const DEAD_LETTER_KEY_PREFIX = "organize:offline:task-dead-letter:v1:";

export function taskDeadLetterStorageKey(userId: string): string {
  return `${DEAD_LETTER_KEY_PREFIX}${userId}`;
}

export interface TaskDeadLetterEntry {
  /** 引用被拒操作的 op_id（重试重入队时沿用，保持 mutation 幂等链） */
  op_id: string;
  op: PendingTaskOp;
  /** 服务端拒绝原因（code/message 原样保存） */
  code: string | null;
  message: string;
  failed_at: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function serializeOp(op: PendingTaskOp): PendingTaskOp | null {
  try {
    JSON.stringify(op);
    return op;
  } catch {
    return null;
  }
}

export function readTaskDeadLetter(storage: StorageLike, userId: string): TaskDeadLetterEntry[] {
  try {
    const raw = storage.getItem(taskDeadLetterStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TaskDeadLetterEntry[]) : [];
  } catch {
    return [];
  }
}

/** 返回 false = 写盘失败（存储满/被禁用），调用方必须提示 */
export function writeTaskDeadLetter(
  storage: StorageLike,
  userId: string,
  entries: TaskDeadLetterEntry[]
): boolean {
  try {
    storage.setItem(taskDeadLetterStorageKey(userId), JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/** 拒绝入账：同 op_id 已存在时保留最早一条（避免重试风暴重复膨胀） */
export function addTaskDeadLetterEntry(
  storage: StorageLike,
  userId: string,
  entry: { op: PendingTaskOp; error: unknown }
): { entries: TaskDeadLetterEntry[]; persisted: boolean } {
  const entries = readTaskDeadLetter(storage, userId);
  if (entries.some((item) => item.op_id === entry.op.op_id)) {
    return { entries, persisted: true };
  }
  const op = serializeOp(entry.op);
  if (!op) return { entries, persisted: true };
  const err = entry.error as { code?: unknown; message?: unknown } | null | undefined;
  entries.push({
    op_id: entry.op.op_id,
    op,
    code: typeof err?.code === "string" ? err.code : null,
    message: typeof err?.message === "string" ? err.message : "同步被服务端拒绝",
    failed_at: Date.now(),
  });
  return { entries, persisted: writeTaskDeadLetter(storage, userId, entries) };
}

export function removeTaskDeadLetterEntry(storage: StorageLike, userId: string, opId: string): TaskDeadLetterEntry[] {
  const entries = readTaskDeadLetter(storage, userId).filter((item) => item.op_id !== opId);
  writeTaskDeadLetter(storage, userId, entries);
  return entries;
}

/** 人工处理「重试」：op 回到队列；expected 置 null（以服务端当前状态重放字段） */
export function resetOpForRetry(op: PendingTaskOp): PendingTaskOp {
  if (op.type === "update") {
    return { ...op, expected_sync_version: null };
  }
  return op;
}

export function taskDeadLetterCount(storage: StorageLike, userId: string): number {
  return readTaskDeadLetter(storage, userId).length;
}
