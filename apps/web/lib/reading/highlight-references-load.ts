export const READING_HIGHLIGHT_REFERENCES_LOAD_ERROR_MESSAGE = "高亮引用状态加载失败";

type HighlightReferencesLoadInput<T> = { previous: Record<string, T> } & (
  | { ok: true; references: Record<string, T> }
  | { ok: false; error?: { message?: string } | null }
);

export function nextHighlightReferencesAfterLoad<T>(
  input: HighlightReferencesLoadInput<T>
): { references: Record<string, T>; loadError: string | null } {
  if (input.ok) {
    return { references: input.references, loadError: null };
  }

  return {
    references: input.previous,
    loadError: input.error?.message?.trim() || READING_HIGHLIGHT_REFERENCES_LOAD_ERROR_MESSAGE,
  };
}
