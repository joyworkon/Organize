/**
 * 笔记离线删除队列（X1）：localStorage 持久化，断网时的软删除（移入垃圾箱）
 * 先入队并乐观移出列表，联网后按序回放。模式与任务删除离线化（#138）一致。
 *
 * 回放走 mutate_trash RPC（soft_delete / note）——直写 notes.deleted_at 会被
 * RLS 拒绝（更新后的行必须仍满足 SELECT 可见性），RPC 是 security definer。
 * RPC 天然幂等：目标已删或不存在时更新 0 行、返回 0，不报错。
 *
 * 「建后删」不入本队列：仍在离线创建队列里的笔记（服务端还没有）删除时直接
 * 丢弃草稿载荷（removeNoteCreate），由调用方在入队前判定。
 *
 * 失败分类复用 note-sync：网络错误中止回放等下次 online；带 code 的服务端错误
 * 丢弃该条（rejected）并继续后续操作。
 */

import { isNetworkSaveError } from "./note-sync";

const STORAGE_KEY = "organize:offline:note-deletes:v1";

export interface PendingNoteDelete {
  op_id: string;
  /** 待软删除的笔记 id（服务端已有行） */
  id: string;
  created_at: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readNoteDeletes(storage: StorageLike): PendingNoteDelete[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingNoteDelete[]) : [];
  } catch {
    return [];
  }
}

export function writeNoteDeletes(storage: StorageLike, ops: PendingNoteDelete[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(ops));
  } catch { /* 存储满/不可用：放弃持久化，内存流程继续 */ }
}

/** 入队并按 note id 去重（同一篇笔记只保留一条待删记录） */
export function enqueueNoteDelete(storage: StorageLike, id: string): PendingNoteDelete[] {
  const ops = readNoteDeletes(storage);
  if (ops.some((item) => item.id === id)) return ops;
  ops.push(makeNoteDeleteOp(id));
  writeNoteDeletes(storage, ops);
  return ops;
}

export function noteDeletesCount(storage: StorageLike): number {
  return readNoteDeletes(storage).length;
}

export function makeNoteDeleteOp(id: string): PendingNoteDelete {
  return { op_id: crypto.randomUUID(), id, created_at: Date.now() };
}

/** 回放依赖的最小写入接口（由 supabase client 适配而来，便于测试注入） */
export interface NoteDeleteWriter {
  softDeleteNote(id: string): Promise<{ error: unknown }>;
}

export interface NoteDeleteReplayResult {
  /** 成功应用的操作数 */
  applied: number;
  /** 被服务端拒绝而丢弃的操作数（带 code 的非网络错误） */
  rejected: number;
  /** 因网络错误中止后仍滞留的操作 */
  remaining: PendingNoteDelete[];
  /** 是否因网络错误中止 */
  stoppedOffline: boolean;
}

/** 按序回放删除操作（纯逻辑，不写存储；调用方负责落盘剩余队列） */
export async function replayNoteDeletes(
  writer: NoteDeleteWriter,
  ops: PendingNoteDelete[]
): Promise<NoteDeleteReplayResult> {
  let applied = 0;
  let rejected = 0;
  const remaining: PendingNoteDelete[] = [];
  let stoppedOffline = false;

  for (const op of ops) {
    if (stoppedOffline) {
      remaining.push(op);
      continue;
    }
    const { error } = await writer.softDeleteNote(op.id);
    if (!error) {
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
