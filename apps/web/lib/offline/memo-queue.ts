/**
 * 速记离线创建队列（F02）：localStorage 持久化，断网时新建速记
 * 先入队并乐观上屏（客户端 UUID 即最终 id），联网后按序回放。
 *
 * 幂等设计：与任务/笔记队列同一约定——id 由客户端 crypto.randomUUID() 生成，
 * 服务端主键唯一约束天然去重（回放遇 23505 视为「已应用」，POST /api/memos
 * 对显式 id 冲突返回既有行）。按 user_id 隔离 key，退出后不回放别人的操作。
 *
 * 自动重试说明：服务端幂等合同（显式 id）落地后本队列才启用联网回放；
 * 更新/删除暂不入队（编辑、删除失败直接报错保留原状），范围刻意收窄。
 */

import { isNetworkSaveError } from "./note-sync";

const STORAGE_KEY_PREFIX = "organize:offline:memo-creates:v1:";

export function memoCreatesStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

export interface PendingMemoCreate {
  op_id: string;
  /** 完整创建载荷：{ id, content }（user_id 由服务端会话决定，不入载荷） */
  memo: { id: string; content: string };
  created_at: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readMemoCreates(storage: StorageLike, userId: string): PendingMemoCreate[] {
  try {
    const raw = storage.getItem(memoCreatesStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingMemoCreate[]) : [];
  } catch {
    return [];
  }
}

function writeMemoCreates(
  storage: StorageLike,
  userId: string,
  ops: PendingMemoCreate[]
): boolean {
  try {
    storage.setItem(memoCreatesStorageKey(userId), JSON.stringify(ops));
    return true;
  } catch {
    return false;
  }
}

export function enqueueMemoCreate(
  storage: StorageLike,
  userId: string,
  op: PendingMemoCreate
): { ops: PendingMemoCreate[]; persisted: boolean } {
  const ops = readMemoCreates(storage, userId);
  // 同 memo id 只保留一条（重复入队以最新载荷为准）
  const index = ops.findIndex((item) => item.memo.id === op.memo.id);
  if (index >= 0) ops[index] = op;
  else ops.push(op);
  return { ops, persisted: writeMemoCreates(storage, userId, ops) };
}

export function removeMemoCreate(
  storage: StorageLike,
  userId: string,
  memoId: string
): PendingMemoCreate[] {
  const ops = readMemoCreates(storage, userId).filter((item) => item.memo.id !== memoId);
  try {
    storage.setItem(memoCreatesStorageKey(userId), JSON.stringify(ops));
  } catch {
    // 忽略：回放成功但持久化失败，下次回放命中幂等合同，无副作用
  }
  return ops;
}

export function memoCreatesCount(storage: StorageLike, userId: string): number {
  return readMemoCreates(storage, userId).length;
}

export function makeMemoCreateOp(content: string): PendingMemoCreate {
  return {
    op_id: crypto.randomUUID(),
    memo: { id: crypto.randomUUID(), content },
    created_at: Date.now(),
  };
}

/** 回放依赖的最小提交接口（fetch /api/memos 的适配，便于测试注入） */
export interface MemoCreateSubmitter {
  /** retryable：服务端临时故障（5xx），保留在队列等下次回放；其余非 2xx 视为业务拒绝 */
  createMemo(memo: { id: string; content: string }): Promise<{ ok: boolean; retryable?: boolean }>;
}

export interface MemoReplayResult {
  /** 成功应用的操作数（含幂等命中的创建） */
  applied: number;
  /** 因业务错误（4xx / 无 code 服务端错）被丢弃的操作数 */
  rejected: number;
  /** 剩余（网络错误或 5xx 中止） */
  remaining: number;
}

/**
 * 按序回放；网络错误或 5xx 中止（等下次 online），业务拒绝丢弃该条并继续
 * （与 note-queue / task-queue 的失败分类一致）。
 */
export async function replayMemoCreates(
  submitter: MemoCreateSubmitter,
  userId: string,
  storage: StorageLike
): Promise<MemoReplayResult> {
  let applied = 0;
  let rejected = 0;
  for (const op of readMemoCreates(storage, userId)) {
    try {
      const { ok, retryable } = await submitter.createMemo(op.memo);
      if (ok) {
        applied += 1;
        removeMemoCreate(storage, userId, op.memo.id);
      } else if (retryable) {
        break;
      } else {
        rejected += 1;
        removeMemoCreate(storage, userId, op.memo.id);
      }
    } catch (error) {
      if (isNetworkSaveError(error)) {
        break;
      }
      rejected += 1;
      removeMemoCreate(storage, userId, op.memo.id);
    }
  }
  return { applied, rejected, remaining: readMemoCreates(storage, userId).length };
}
