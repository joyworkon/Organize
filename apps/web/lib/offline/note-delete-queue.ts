/**
 * 笔记离线删除队列（X1）：localStorage 持久化，断网时的软删除（移入垃圾箱）
 * 先入队并乐观移出列表，联网后按序回放。模式与任务删除离线化（#138）一致。
 *
 * 回放走 mutate_trash RPC（soft_delete / note）——直写 notes.deleted_at 会被
 * RLS 拒绝（更新后的行必须仍满足 SELECT 可见性），RPC 是 security definer。
 * RPC 天然幂等：目标已删或不存在时更新 0 行、返回 0，不报错。
 *
 * 按 user_id 隔离存储 key（与创建队列、任务 / 速记队列同一约定）。这一点对删除队列
 * 尤其要紧：回放按当前账号执行，别人的删除请求更新 0 行且不报错，会被当成「已应用」
 * 出队——上一位离线删掉的笔记就再也删不掉了。
 *
 * 「建后删」不入本队列：仍在离线创建队列里的笔记（服务端还没有）删除时直接
 * 丢弃草稿载荷（removeNoteCreate），由调用方在入队前判定。
 *
 * 失败分类复用 note-sync：网络错误中止回放等下次 online；带 code 的服务端错误
 * 丢弃该条（rejected）并继续后续操作。
 *
 * 存量数据：旧版本用不分账号的全局 key，首个读取的账号整体接手（见 migrateLegacyNoteDeletes）。
 */

import { isNetworkSaveError } from "./note-sync";

const STORAGE_KEY_PREFIX = "organize:offline:note-deletes:v1:";
/** 旧版全局 key（不分账号）。存量迁走后写回空数组，之后不再进入迁移。 */
const LEGACY_STORAGE_KEY = "organize:offline:note-deletes:v1";

export function noteDeletesStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

export interface PendingNoteDelete {
  op_id: string;
  /** 待软删除的笔记 id（服务端已有行） */
  id: string;
  created_at: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function parseOps(raw: string | null): PendingNoteDelete[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingNoteDelete[]) : [];
  } catch {
    return [];
  }
}

/**
 * 旧版全局 key 的存量迁移。删除操作不记属主，无法判断属于谁：整体迁给首个读取的
 * 账号——单人设备上就是原属主；多人共用设备时最坏情况与修复前一致。当前账号的
 * 新 key 已存在即视为迁移完成。写盘失败时旧数据原样保留，下次读取再试。
 */
function migrateLegacyNoteDeletes(storage: StorageLike, userId: string): void {
  const legacyRaw = safeGet(storage, LEGACY_STORAGE_KEY);
  if (legacyRaw === null) return;
  if (safeGet(storage, noteDeletesStorageKey(userId)) !== null) return;

  try {
    storage.setItem(noteDeletesStorageKey(userId), JSON.stringify(parseOps(legacyRaw)));
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([]));
  } catch {
    // 存储不可用：旧数据原样保留
  }
}

export function readNoteDeletes(storage: StorageLike, userId: string): PendingNoteDelete[] {
  migrateLegacyNoteDeletes(storage, userId);
  return parseOps(safeGet(storage, noteDeletesStorageKey(userId)));
}

export function writeNoteDeletes(
  storage: StorageLike,
  userId: string,
  ops: PendingNoteDelete[]
): void {
  try {
    storage.setItem(noteDeletesStorageKey(userId), JSON.stringify(ops));
  } catch { /* 存储满/不可用：放弃持久化，内存流程继续 */ }
}

/** 入队并按 note id 去重（同一篇笔记只保留一条待删记录） */
export function enqueueNoteDelete(
  storage: StorageLike,
  userId: string,
  id: string
): PendingNoteDelete[] {
  const ops = readNoteDeletes(storage, userId);
  if (ops.some((item) => item.id === id)) return ops;
  ops.push(makeNoteDeleteOp(id));
  writeNoteDeletes(storage, userId, ops);
  return ops;
}

export function noteDeletesCount(storage: StorageLike, userId: string): number {
  return readNoteDeletes(storage, userId).length;
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
