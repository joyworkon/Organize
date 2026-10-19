export const SHARED_NOTES_OWNER_NAMES_LOAD_ERROR_MESSAGE = "分享者姓名加载失败，请重试";

export interface SharedNoteOwnerProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface SharedNoteOwnerSnapshot {
  ownerId: string;
  ownerName: string | null;
  ownerAvatarUrl: string | null;
}

export type SharedNoteOwnerProfiles = Map<
  string,
  { display_name: string | null; avatar_url: string | null }
>;

function ownerNamesLoadError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return SHARED_NOTES_OWNER_NAMES_LOAD_ERROR_MESSAGE;
}

export function nextSharedNoteOwnerProfilesAfterLoad({
  previousNotes,
  data,
  error,
}: {
  previousNotes: SharedNoteOwnerSnapshot[];
  data: SharedNoteOwnerProfileRow[] | null;
  error: unknown;
}): { profiles: SharedNoteOwnerProfiles; loadError: string | null } {
  if (error || data === null) {
    const profiles: SharedNoteOwnerProfiles = new Map();
    for (const note of previousNotes) {
      if (profiles.has(note.ownerId)) continue;
      if (note.ownerName === null && note.ownerAvatarUrl === null) continue;
      profiles.set(note.ownerId, {
        display_name: note.ownerName,
        avatar_url: note.ownerAvatarUrl,
      });
    }
    return { profiles, loadError: ownerNamesLoadError(error) };
  }
  const profiles: SharedNoteOwnerProfiles = new Map();
  for (const row of data) {
    profiles.set(row.id, {
      display_name: row.display_name ?? null,
      avatar_url: row.avatar_url ?? null,
    });
  }
  return { profiles, loadError: null };
}
