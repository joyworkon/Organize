export const READING_HIGHLIGHTS_LOAD_ERROR_MESSAGE = "高亮加载失败";

type HighlightsLoadInput<T> = { previous: T[] } & (
  | { ok: true; highlights: T[] }
  | { ok: false; error?: { message?: string } | null }
);

export function nextHighlightsAfterLoad<T>(
  input: HighlightsLoadInput<T>
): { highlights: T[]; loadError: string | null } {
  if (input.ok) {
    return { highlights: input.highlights, loadError: null };
  }

  return {
    highlights: input.previous,
    loadError: input.error?.message?.trim() || READING_HIGHLIGHTS_LOAD_ERROR_MESSAGE,
  };
}
