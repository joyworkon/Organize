export const EDITOR_MOVE_NOTES_LOAD_ERROR_MESSAGE = "无法加载笔记";

export function nextMoveNotesAfterLoad<T>(
  input: { previous: T[] } & ({ ok: true; notes: T[] } | { ok: false }),
): { notes: T[]; loadError: string | null } {
  if (!input.ok) {
    return {
      notes: input.previous,
      loadError: EDITOR_MOVE_NOTES_LOAD_ERROR_MESSAGE,
    };
  }

  return { notes: input.notes, loadError: null };
}
