/**
 * 笔记离线创建队列（X1 第二阶段 B）：localStorage 持久化，断网时新建笔记
 * 先入队并立即跳转编辑器（客户端 UUID 即最终 id），联网后按序回放插入。
 *
 * 幂等设计：id 由客户端 crypto.randomUUID() 生成，服务端主键唯一约束天然去重
 * （回放遇 23505 视为「已应用」）。笔记的后续「更新」不走此队列——由编辑器
 * 草稿 + save_note_with_tasks 乐观锁管线负责（见 notes/[id]/page.tsx flushSave）。
 *
 * 失败分类复用 note-sync：网络错误中止回放等下次 online；带 code 的服务端错误
 * 丢弃该条（rejected）并继续后续操作。
 */

import { isNetworkSaveError } from "./note-sync";

const STORAGE_KEY = "organize:offline:note-creates:v1";

export interface PendingNoteCreate {
  op_id: string;
  /** 完整插入载荷（含客户端生成的 id 与 user_id） */
  note: Record<string, unknown>;
  /** 本地创建时间（ms），用于列表乐观排序 */
  created_at: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readNoteCreates(storage: StorageLike): PendingNoteCreate[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingNoteCreate[]) : [];
  } catch {
    return [];
  }
}

export function writeNoteCreates(storage: StorageLike, ops: PendingNoteCreate[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(ops));
  } catch { /* 存储满/不可用：放弃持久化，内存流程继续 */ }
}

export function enqueueNoteCreate(storage: StorageLike, op: PendingNoteCreate): PendingNoteCreate[] {
  const ops = readNoteCreates(storage);
  // 同 note id 只保留一条（重复入队以最新载荷为准）
  const index = ops.findIndex((item) => item.note.id === op.note.id);
  if (index >= 0) ops[index] = op;
  else ops.push(op);
  writeNoteCreates(storage, ops);
  return ops;
}

export function findNoteCreate(storage: StorageLike, noteId: string): PendingNoteCreate | null {
  return readNoteCreates(storage).find((item) => item.note.id === noteId) || null;
}

/** 按 note id 移除（回放成功/被判业务拒绝后调用） */
export function removeNoteCreate(storage: StorageLike, noteId: string): PendingNoteCreate[] {
  const ops = readNoteCreates(storage).filter((item) => item.note.id !== noteId);
  writeNoteCreates(storage, ops);
  return ops;
}

export function noteCreatesCount(storage: StorageLike): number {
  return readNoteCreates(storage).length;
}

export function makeNoteCreateOp(note: Record<string, unknown>): PendingNoteCreate {
  return { op_id: crypto.randomUUID(), note, created_at: Date.now() };
}

/** 回放依赖的最小写入接口（由 supabase client 适配而来，便于测试注入） */
export interface NoteCreateWriter {
  insertNote(note: Record<string, unknown>): Promise<{ error: unknown }>;
}

export interface NoteReplayResult {
  /** 成功应用的操作数（含幂等命中 23505 的创建） */
  applied: number;
  /** 被服务端拒绝而丢弃的操作数（带 code 的非网络错误） */
  rejected: number;
  /** 因网络错误中止后仍滞留的操作 */
  remaining: PendingNoteCreate[];
  /** 是否因网络错误中止 */
  stoppedOffline: boolean;
}

/** 按序回放创建操作（纯逻辑，不写存储；调用方负责落盘剩余队列） */
export async function replayNoteCreates(
  writer: NoteCreateWriter,
  ops: PendingNoteCreate[]
): Promise<NoteReplayResult> {
  let applied = 0;
  let rejected = 0;
  const remaining: PendingNoteCreate[] = [];
  let stoppedOffline = false;

  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (stoppedOffline) {
      remaining.push(op);
      continue;
    }
    const { error } = await writer.insertNote(op.note);

    if (!error) {
      applied += 1;
      continue;
    }
    // 幂等命中：主键冲突说明此前已应用（如响应丢失后的重放）
    const code = (error as { code?: unknown })?.code;
    if (code === "23505") {
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
