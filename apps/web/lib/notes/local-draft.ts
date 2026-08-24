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

export function writeLocalNoteDraft(
  storage: DraftStorage,
  userId: string,
  noteId: string,
  baseRevision: number,
  draft: NoteDraftSnapshot,
  now = new Date()
): StoredNoteDraft | null {
  const stored: StoredNoteDraft = {
    version: 1,
    noteId,
    userId,
    baseRevision,
    updatedAt: now.toISOString(),
    draft,
  };
  try {
    storage.setItem(noteDraftStorageKey(userId, noteId), JSON.stringify(stored));
    return stored;
  } catch {
    return null;
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
