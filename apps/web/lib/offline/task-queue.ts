/**
 * 任务离线操作队列（X1 第二阶段）：localStorage 持久化，断网时的任务创建/字段更新
 * 先入队并乐观更新 UI，联网后按序回放。
 *
 * 幂等设计：
 * - 创建：id 由客户端 crypto.randomUUID() 生成，服务端主键唯一约束天然去重
 *   （回放遇 23505 视为「已应用」）；同一任务的后续离线更新会合入创建载荷。
 * - 更新：按任务 id 合并（后写的字段覆盖先写的），回放为普通 update（与在线行为一致）。
 *
 * 失败分类复用 note-sync：网络错误中止回放等下次 online；带 code 的服务端错误
 * 丢弃该条（rejected）并继续后续操作。
 */

import { isNetworkSaveError } from "./note-sync";

const STORAGE_KEY = "organize:offline:task-ops:v1";

export interface PendingTaskCreate {
  op_id: string;
  type: "create";
  /** 完整插入载荷（含客户端生成的 id 与 user_id） */
  task: Record<string, unknown>;
  created_at: number;
}

export interface PendingTaskUpdate {
  op_id: string;
  type: "update";
  id: string;
  patch: Record<string, unknown>;
  created_at: number;
}

export type PendingTaskOp = PendingTaskCreate | PendingTaskUpdate;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readTaskOps(storage: StorageLike): PendingTaskOp[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingTaskOp[]) : [];
  } catch {
    return [];
  }
}

export function writeTaskOps(storage: StorageLike, ops: PendingTaskOp[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(ops));
  } catch { /* 存储满/不可用：放弃持久化，内存流程继续 */ }
}

/**
 * 入队并合并：
 * - update 命中同 id 的 create → 合入创建载荷（保证回放时先建后改且只插一次）；
 * - update 命中同 id 的 update → 合并 patch（后者覆盖同名字段）；
 * - 其余追加到队尾（保持时间序）。
 */
export function enqueueTaskOp(storage: StorageLike, op: PendingTaskOp): PendingTaskOp[] {
  const ops = readTaskOps(storage);
  if (op.type === "update") {
    const createIndex = ops.findIndex((item) => item.type === "create" && item.task.id === op.id);
    if (createIndex >= 0) {
      const create = ops[createIndex] as PendingTaskCreate;
      ops[createIndex] = { ...create, task: { ...create.task, ...op.patch } };
      writeTaskOps(storage, ops);
      return ops;
    }
    const updateIndex = ops.findIndex((item) => item.type === "update" && item.id === op.id);
    if (updateIndex >= 0) {
      const existing = ops[updateIndex] as PendingTaskUpdate;
      ops[updateIndex] = { ...existing, patch: { ...existing.patch, ...op.patch } };
      writeTaskOps(storage, ops);
      return ops;
    }
  }
  ops.push(op);
  writeTaskOps(storage, ops);
  return ops;
}

export function removeTaskOp(storage: StorageLike, opId: string): PendingTaskOp[] {
  const ops = readTaskOps(storage).filter((item) => item.op_id !== opId);
  writeTaskOps(storage, ops);
  return ops;
}

export function taskOpsCount(storage: StorageLike): number {
  return readTaskOps(storage).length;
}

export function makeTaskCreateOp(task: Record<string, unknown>): PendingTaskCreate {
  return { op_id: crypto.randomUUID(), type: "create", task, created_at: Date.now() };
}

export function makeTaskUpdateOp(id: string, patch: Record<string, unknown>): PendingTaskUpdate {
  return { op_id: crypto.randomUUID(), type: "update", id, patch, created_at: Date.now() };
}

/** 回放依赖的最小写入接口（由 supabase client 适配而来，便于测试注入） */
export interface TaskQueueWriter {
  insertTask(task: Record<string, unknown>): Promise<{ error: unknown }>;
  updateTask(id: string, patch: Record<string, unknown>): Promise<{ error: unknown }>;
}

export interface ReplayResult {
  /** 成功应用的操作数（含幂等命中 23505 的创建） */
  applied: number;
  /** 被服务端拒绝而丢弃的操作数（带 code 的非网络错误） */
  rejected: number;
  /** 因网络错误中止后仍滞留的操作 */
  remaining: PendingTaskOp[];
  /** 是否因网络错误中止 */
  stoppedOffline: boolean;
}

/** 按序回放操作（纯逻辑，不写存储；调用方负责落盘剩余队列） */
export async function replayTaskOps(
  writer: TaskQueueWriter,
  ops: PendingTaskOp[]
): Promise<ReplayResult> {
  let applied = 0;
  let rejected = 0;
  const remaining: PendingTaskOp[] = [];
  let stoppedOffline = false;

  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (stoppedOffline) {
      remaining.push(op);
      continue;
    }
    const { error } = op.type === "create"
      ? await writer.insertTask(op.task)
      : await writer.updateTask(op.id, op.patch);

    if (!error) {
      applied += 1;
      continue;
    }
    // 创建幂等命中：主键冲突说明此前已应用（如响应丢失后的重放）
    const code = (error as { code?: unknown })?.code;
    if (op.type === "create" && code === "23505") {
      applied += 1;
      continue;
    }
    if (isNetworkSaveError(error)) {
      stoppedOffline = true;
      remaining.push(op);
      continue;
    }
    // 带 code 的服务端业务错误：按协议不重试，丢弃并继续后续操作
    rejected += 1;
  }

  return { applied, rejected, remaining, stoppedOffline };
}
