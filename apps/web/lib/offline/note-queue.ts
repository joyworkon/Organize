/**
 * 笔记离线创建队列（X1 第二阶段 B）：localStorage 持久化，断网时新建笔记
 * 先入队并立即跳转编辑器（客户端 UUID 即最终 id），联网后按序回放插入。
 *
 * 幂等设计：id 由客户端 crypto.randomUUID() 生成，服务端主键唯一约束天然去重
 * （回放遇 23505 视为「已应用」）。笔记的后续「更新」不走此队列——由编辑器
 * 草稿 + save_note_with_tasks 乐观锁管线负责（见 notes/[id]/page.tsx flushSave）。
 *
 * 按 user_id 隔离存储 key（与任务 / 速记队列同一约定）：同一个浏览器换号后，新账号
 * 既看不到、也不会回放上一位的离线笔记。key 不分账号时，上一位的条目会以新账号的
 * 会话插入，被 notes 的插入策略（RLS）拒绝后按「服务端拒绝」丢弃，永久丢失。
 * 回放另有一道保险：不属于本人的操作不发往服务端，原样留在队列里。
 *
 * 失败分类复用 note-sync：网络错误中止回放等下次 online；带 code 的服务端错误
 * 丢弃该条（rejected）并继续后续操作。
 *
 * 存量数据：旧版本用不分账号的全局 key，各自属主首次读取时迁移
 * （见 migrateLegacyNoteCreates）。
 */

import { isNetworkSaveError } from "./note-sync";

const STORAGE_KEY_PREFIX = "organize:offline:note-creates:v1:";
/** 旧版全局 key（不分账号）。各属主的条目迁走后写回剩余部分，迁空后是空数组。 */
const LEGACY_STORAGE_KEY = "organize:offline:note-creates:v1";

export function noteCreatesStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

export interface PendingNoteCreate {
  op_id: string;
  /** 完整插入载荷（含客户端生成的 id 与 user_id） */
  note: Record<string, unknown>;
  /** 本地创建时间（ms），用于列表乐观排序 */
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

function parseOps(raw: string | null): PendingNoteCreate[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingNoteCreate[]) : [];
  } catch {
    return [];
  }
}

/**
 * 旧版全局 key 的存量迁移：只迁属于当前账号的条目（载荷里带 user_id），其余原样
 * 留给各自的属主。即使本人一条都没有，也给当前账号写下空队列——新 key 已存在即
 * 视为迁移完成，之后不再读旧 key。写盘失败时旧数据原样保留，下次读取再试。
 */
function migrateLegacyNoteCreates(storage: StorageLike, userId: string): void {
  const legacyRaw = safeGet(storage, LEGACY_STORAGE_KEY);
  if (legacyRaw === null) return;
  if (safeGet(storage, noteCreatesStorageKey(userId)) !== null) return;

  const legacy = parseOps(legacyRaw);
  const mine = legacy.filter((op) => op?.note?.user_id === userId);
  const others = legacy.filter((op) => op?.note?.user_id !== userId);
  try {
    storage.setItem(noteCreatesStorageKey(userId), JSON.stringify(mine));
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(others));
  } catch {
    // 存储不可用：旧数据原样保留
  }
}

export function readNoteCreates(storage: StorageLike, userId: string): PendingNoteCreate[] {
  migrateLegacyNoteCreates(storage, userId);
  return parseOps(safeGet(storage, noteCreatesStorageKey(userId)));
}

export function writeNoteCreates(
  storage: StorageLike,
  userId: string,
  ops: PendingNoteCreate[]
): boolean {
  try {
    storage.setItem(noteCreatesStorageKey(userId), JSON.stringify(ops));
    return true;
  } catch {
    // 存储满/不可用：放弃持久化，内存流程继续；调用方经 persisted 感知
    return false;
  }
}

export function enqueueNoteCreate(
  storage: StorageLike,
  userId: string,
  op: PendingNoteCreate
): { ops: PendingNoteCreate[]; persisted: boolean } {
  const ops = readNoteCreates(storage, userId);
  // 同 note id 只保留一条（重复入队以最新载荷为准）
  const index = ops.findIndex((item) => item.note.id === op.note.id);
  if (index >= 0) ops[index] = op;
  else ops.push(op);
  // 持久化失败必须让调用方可知（提示「离线创建可能丢失」）
  return { ops, persisted: writeNoteCreates(storage, userId, ops) };
}

export function findNoteCreate(
  storage: StorageLike,
  userId: string,
  noteId: string
): PendingNoteCreate | null {
  return readNoteCreates(storage, userId).find((item) => item.note.id === noteId) || null;
}

/** 按 note id 移除（回放成功/被判业务拒绝后调用） */
export function removeNoteCreate(
  storage: StorageLike,
  userId: string,
  noteId: string
): PendingNoteCreate[] {
  const ops = readNoteCreates(storage, userId).filter((item) => item.note.id !== noteId);
  writeNoteCreates(storage, userId, ops);
  return ops;
}

export function noteCreatesCount(storage: StorageLike, userId: string): number {
  return readNoteCreates(storage, userId).length;
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
  /** 不属于当前账号的操作数：未发送，原样留在 remaining 里等属主自己回放 */
  foreign: number;
  /** 回放结束后仍滞留队列的操作（因网络错误中止的，加上不属于当前账号的） */
  remaining: PendingNoteCreate[];
  /** 是否因网络错误中止 */
  stoppedOffline: boolean;
}

/**
 * 按序回放当前账号的操作（纯逻辑，不写存储；调用方负责落盘剩余队列）。
 * 载荷的 user_id 与 userId 不一致的操作一律不发送：以别人的会话插入必然被 RLS 拒绝，
 * 按「服务端拒绝」丢弃就等于替属主删掉了还没同步的笔记。
 */
export async function replayNoteCreates(
  writer: NoteCreateWriter,
  ops: PendingNoteCreate[],
  userId: string
): Promise<NoteReplayResult> {
  let applied = 0;
  let rejected = 0;
  let foreign = 0;
  const remaining: PendingNoteCreate[] = [];
  let stoppedOffline = false;

  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (op?.note?.user_id !== userId) {
      foreign += 1;
      remaining.push(op);
      continue;
    }
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

  return { applied, rejected, foreign, remaining, stoppedOffline };
}
