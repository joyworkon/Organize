import type { NoteFont } from "@organize/shared";

export interface NoteDraftSnapshot {
  title: string;
  content: Record<string, unknown> | null;
  icon: string | null;
  cover_url: string | null;
  cover_position: number;
  parent_note_id: string | null;
  full_width: boolean;
  font_family: NoteFont;
  small_font: boolean;
}

export interface StoredNoteDraft {
  version: 1;
  noteId: string;
  userId: string;
  baseRevision: number;
  updatedAt: string;
  draft: NoteDraftSnapshot;
}

interface DraftStorage {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

const DRAFT_PREFIX = "organize:note-draft:";

export function noteDraftStorageKey(userId: string, noteId: string): string {
  return `${DRAFT_PREFIX}${userId}:${noteId}`;
}

function isNoteDraftSnapshot(value: unknown): value is NoteDraftSnapshot {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<NoteDraftSnapshot>;
  return (
    typeof draft.title === "string"
    && (draft.content === null || typeof draft.content === "object")
    && (draft.icon === null || typeof draft.icon === "string")
    && (draft.cover_url === null || typeof draft.cover_url === "string")
    && typeof draft.cover_position === "number"
    && (draft.parent_note_id === null || typeof draft.parent_note_id === "string")
    && typeof draft.full_width === "boolean"
    && (draft.font_family === "default" || draft.font_family === "serif" || draft.font_family === "mono")
    && typeof draft.small_font === "boolean"
  );
}

export function readLocalNoteDraft(
  storage: DraftStorage,
  userId: string,
  noteId: string
): StoredNoteDraft | null {
  try {
    const raw = storage.getItem(noteDraftStorageKey(userId, noteId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredNoteDraft>;
    if (
      value.version !== 1
      || value.noteId !== noteId
      || value.userId !== userId
      || typeof value.baseRevision !== "number"
      || typeof value.updatedAt !== "string"
      || !isNoteDraftSnapshot(value.draft)
    ) {
      return null;
    }
    return value as StoredNoteDraft;
  } catch {
    return null;
  }
}

export type DraftWriteStatus = "ok" | "quota" | "unavailable" | "serialization";

export interface DraftWriteResult {
  status: DraftWriteStatus;
  /** status === "ok" 时为写入的完整记录，其余为 null */
  stored: StoredNoteDraft | null;
}

/** 保守分类：能确认配额才算 quota，其余一律 unavailable（UI 统一按“本机草稿未能保存”呈现）。 */
function classifyStorageError(error: unknown): DraftWriteStatus {
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED") {
      return "quota";
    }
    return "unavailable";
  }
  if (error && typeof error === "object") {
    const name = (error as { name?: unknown }).name;
    const code = (error as { code?: unknown }).code;
    if (name === "QuotaExceededError" || code === 22 || code === 1014) return "quota";
  }
  return "unavailable";
}

/**
 * 写入本地草稿，返回类型化结果；调用方必须消费 status 并如实呈现——
 * 禁止在失败时展示“已保存在本地 / 草稿已保留”类文案。
 */
export function writeLocalNoteDraft(
  storage: DraftStorage,
  userId: string,
  noteId: string,
  baseRevision: number,
  draft: NoteDraftSnapshot,
  now = new Date()
): DraftWriteResult {
  const stored: StoredNoteDraft = {
    version: 1,
    noteId,
    userId,
    baseRevision,
    updatedAt: now.toISOString(),
    draft,
  };
  let body: string;
  try {
    body = JSON.stringify(stored);
  } catch {
    // 内容本身无法序列化（如循环引用）：与存储可用性区分开
    return { status: "serialization", stored: null };
  }
  try {
    storage.setItem(noteDraftStorageKey(userId, noteId), body);
    return { status: "ok", stored };
  } catch (error) {
    return { status: classifyStorageError(error), stored: null };
  }
}

export function clearLocalNoteDraft(
  storage: DraftStorage,
  userId: string,
  noteId: string
): void {
  try {
    storage.removeItem(noteDraftStorageKey(userId, noteId));
  } catch {
    // 隐私模式或存储被禁用时无需阻断保存。
  }
}

export function clearLocalNoteDraftForNote(storage: DraftStorage, noteId: string): void {
  try {
    const suffix = `:${noteId}`;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(DRAFT_PREFIX) && key.endsWith(suffix)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // 清理失败最多导致下次进入时再次询问，不影响历史版本恢复。
  }
}

export function areNoteDraftsEqual(left: NoteDraftSnapshot, right: NoteDraftSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
