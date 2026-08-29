/**
 * 任务离线操作队列 v2（P1-03）：localStorage 持久化，断网时的任务创建/字段更新/软删除、
 * 子任务增删改（子任务即带 parent_task_id 的任务行，走同一套 create/update）、清单项勾选/删除。
 * 先入队并乐观更新 UI，联网后按序回放。
 *
 * v2 变更（P1-03）：
 * - 队列按 user_id 隔离（storage key 带 userId）：退出后另一账号登录不会看到/回放
 *   别人的操作。v1 全局 key（organize:offline:task-ops:v1）无法安全迁移（无法判定
 *   归属），弃用不清除，历史离线操作一次性失效。
 * - 持久化失败不再静默吞掉：write 返回 false，enqueue 返回 {ops, persisted}，
 *   调用方必须提示「本地存储不可用，离线更改可能丢失」。
 * - update 操作携带 expected_sync_version（入队时本地已知的服务端版本）与
 *   mutation id（即 op_id）：回放与在线更新共用 update_task_atomic 原子协议，
 *   双设备冲突 → conflict（进 dead-letter 人工处理），重放 → already_applied。
 *
 * 幂等设计：
 * - 创建：id 由客户端 crypto.randomUUID() 生成，服务端主键唯一约束天然去重
 *   （回放遇 23505 视为「已应用」）；同一任务的后续离线更新会合入创建载荷。
 * - 更新：按任务 id 合并（后写的字段覆盖先写的，expected_sync_version 取最后一次
 *   入队时已知值）；回放走原子 RPC。
 * - 删除（本质是带 deleted_at 的 update 补丁）：命中同 id 的 create 时合入创建载荷
 *   （回放为「插入即软删」，依赖 migration 049 放宽 INSERT 策略）；独立 update 补丁
 *   由调用方的 writer 路由到 mutate_trash RPC——直写 deleted_at 会被 RLS 拒绝。
 * - 清单勾选：按清单项 id 合并（最终态覆盖）；清单删除：按 id 去重，并连带丢弃
 *   同一项的滞留勾选。清单行直写 task_checklists 表（与在线行为一致）。
 *
 * 失败分类复用 note-sync：网络错误中止回放等下次 online；非网络失败不丢弃，
 * 由调用方写入 per-user dead-letter（UI 可见，支持重试/丢弃）。
 */

import { isNetworkSaveError } from "./note-sync";

const STORAGE_KEY_PREFIX = "organize:offline:task-ops:v2:";

export function taskOpsStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

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
  /** 入队时本地已知的任务 sync_version；null 表示人工冲突处理后重放（跳过版本校验） */
  expected_sync_version: number | null;
  created_at: number;
}

export interface PendingChecklistUpdate {
  op_id: string;
  type: "checklist_update";
  /** task_checklists 行 id */
  id: string;
  patch: Record<string, unknown>;
  created_at: number;
}

export interface PendingChecklistDelete {
  op_id: string;
  type: "checklist_delete";
  /** task_checklists 行 id */
  id: string;
  created_at: number;
}

export type PendingTaskOp =
  | PendingTaskCreate
  | PendingTaskUpdate
  | PendingChecklistUpdate
  | PendingChecklistDelete;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readTaskOps(storage: StorageLike, userId: string): PendingTaskOp[] {
  try {
    const raw = storage.getItem(taskOpsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingTaskOp[]) : [];
  } catch {
    return [];
  }
}

/** 返回 false 表示持久化失败（存储满/被禁用）——调用方必须提示，不可静默忽略 */
export function writeTaskOps(storage: StorageLike, userId: string, ops: PendingTaskOp[]): boolean {
  try {
    storage.setItem(taskOpsStorageKey(userId), JSON.stringify(ops));
    return true;
  } catch {
    return false;
  }
}

export interface EnqueueTaskOpResult {
  ops: PendingTaskOp[];
  /** false = 队列已更新但写盘失败（存储满/被禁用），刷新后可能丢失 */
  persisted: boolean;
}

/**
 * 入队并合并（合并规则见文件头）；返回值必须检查 persisted。
 */
export function enqueueTaskOp(storage: StorageLike, userId: string, op: PendingTaskOp): EnqueueTaskOpResult {
  const ops = readTaskOps(storage, userId);
  if (op.type === "update") {
    const createIndex = ops.findIndex((item) => item.type === "create" && item.task.id === op.id);
    if (createIndex >= 0) {
      const create = ops[createIndex] as PendingTaskCreate;
      ops[createIndex] = { ...create, task: { ...create.task, ...op.patch } };
      return { ops, persisted: writeTaskOps(storage, userId, ops) };
    }
    const updateIndex = ops.findIndex((item) => item.type === "update" && item.id === op.id);
    if (updateIndex >= 0) {
      const existing = ops[updateIndex] as PendingTaskUpdate;
      ops[updateIndex] = { ...existing, patch: { ...existing.patch, ...op.patch }, expected_sync_version: op.expected_sync_version };
      return { ops, persisted: writeTaskOps(storage, userId, ops) };
    }
  }
  if (op.type === "checklist_update") {
    const updateIndex = ops.findIndex(
      (item) => item.type === "checklist_update" && item.id === op.id
    );
    if (updateIndex >= 0) {
      const existing = ops[updateIndex] as PendingChecklistUpdate;
      ops[updateIndex] = { ...existing, patch: { ...existing.patch, ...op.patch } };
      return { ops, persisted: writeTaskOps(storage, userId, ops) };
    }
  }
  if (op.type === "checklist_delete") {
    // 该项已待删：本次入队是重复删除；同时丢弃滞留勾选（回放无意义）
    const isChecklistOpOnSameItem = (item: PendingTaskOp) =>
      (item.type === "checklist_delete" || item.type === "checklist_update") && item.id === op.id;
    const filtered = ops.filter((item) => !isChecklistOpOnSameItem(item));
    filtered.push(op);
    return { ops: filtered, persisted: writeTaskOps(storage, userId, filtered) };
  }
  ops.push(op);
  return { ops, persisted: writeTaskOps(storage, userId, ops) };
}

export function removeTaskOp(storage: StorageLike, userId: string, opId: string): PendingTaskOp[] {
  const ops = readTaskOps(storage, userId).filter((item) => item.op_id !== opId);
  writeTaskOps(storage, userId, ops);
  return ops;
}

export function taskOpsCount(storage: StorageLike, userId: string): number {
  return readTaskOps(storage, userId).length;
}

export function makeTaskCreateOp(task: Record<string, unknown>): PendingTaskCreate {
  return { op_id: crypto.randomUUID(), type: "create", task, created_at: Date.now() };
}

export function makeTaskUpdateOp(
  id: string,
  patch: Record<string, unknown>,
  expectedSyncVersion: number | null
): PendingTaskUpdate {
  return {
    op_id: crypto.randomUUID(),
    type: "update",
    id,
    patch,
    expected_sync_version: expectedSyncVersion,
    created_at: Date.now(),
  };
}

export function makeChecklistUpdateOp(
  id: string,
  patch: Record<string, unknown>
): PendingChecklistUpdate {
  return { op_id: crypto.randomUUID(), type: "checklist_update", id, patch, created_at: Date.now() };
}

export function makeChecklistDeleteOp(id: string): PendingChecklistDelete {
  return { op_id: crypto.randomUUID(), type: "checklist_delete", id, created_at: Date.now() };
}

/** 回放依赖的最小写入接口（由 supabase client 适配而来，便于测试注入） */
export interface TaskQueueWriter {
  insertTask(task: Record<string, unknown>): Promise<{ error: unknown }>;
  /** 走原子协议：meta 来自被回放的 op（mutation id = op_id） */
  updateTask(
    id: string,
    patch: Record<string, unknown>,
    meta: { expectedSyncVersion: number | null; mutationId: string }
  ): Promise<{ error: unknown }>;
  updateChecklist(id: string, patch: Record<string, unknown>): Promise<{ error: unknown }>;
  deleteChecklist(id: string): Promise<{ error: unknown }>;
}

export interface RejectedTaskOp {
  op: PendingTaskOp;
  error: unknown;
}

export interface ReplayResult {
  /** 成功应用的操作数（含幂等命中 23505 的创建与 already_applied 的更新） */
  applied: number;
  /** 被服务端拒绝的操作（非网络错误）——调用方必须写入 dead-letter，不可静默丢弃 */
  rejectedOps: RejectedTaskOp[];
  /** 因网络错误中止后仍滞留的操作 */
  remaining: PendingTaskOp[];
  /** 是否因网络错误中止 */
  stoppedOffline: boolean;
}

/** 按序回放操作（纯逻辑，不写存储；调用方负责落盘剩余队列与 dead-letter） */
export async function replayTaskOps(
  writer: TaskQueueWriter,
  ops: PendingTaskOp[]
): Promise<ReplayResult> {
  let applied = 0;
  const rejectedOps: RejectedTaskOp[] = [];
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
      : op.type === "update"
        ? await writer.updateTask(op.id, op.patch, {
            expectedSyncVersion: op.expected_sync_version ?? null,
            mutationId: op.op_id,
          })
        : op.type === "checklist_update"
          ? await writer.updateChecklist(op.id, op.patch)
          : await writer.deleteChecklist(op.id);

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
    // 非网络失败（conflict/not_found/约束/权限……）：不静默丢弃，交给 dead-letter
    rejectedOps.push({ op, error });
  }

  return { applied, rejectedOps, remaining, stoppedOffline };
}
