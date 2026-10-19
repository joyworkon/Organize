export const READING_NOTE_LOOKUP_LOAD_ERROR_MESSAGE = "读书笔记状态加载失败";

type ReadingNoteLookupInput = { previous: string | null } & (
  | { ok: true; noteId: string | null }
  | { ok: false; error?: { message?: string } | null }
);

export function nextReadingNoteIdAfterLookup(
  input: ReadingNoteLookupInput
): { noteId: string | null; loadError: string | null } {
  if (input.ok) {
    return { noteId: input.noteId, loadError: null };
  }

  return {
    noteId: input.previous,
    loadError: input.error?.message?.trim() || READING_NOTE_LOOKUP_LOAD_ERROR_MESSAGE,
  };
}
