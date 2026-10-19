export const SHARED_NOTES_LIST_LOAD_ERROR_MESSAGE = "共享笔记加载失败，请重试";

function sharedNotesLoadError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return SHARED_NOTES_LIST_LOAD_ERROR_MESSAGE;
}

export function nextSharedNotesAfterLoad<T>({
  previousNotes,
  data,
  error,
}: {
  previousNotes: T[];
  data: T[] | null;
  error: unknown;
}): { notes: T[]; loadError: string | null } {
  if (error || data === null) {
    return {
      notes: previousNotes,
      loadError: sharedNotesLoadError(error),
    };
  }
  return { notes: data, loadError: null };
}
