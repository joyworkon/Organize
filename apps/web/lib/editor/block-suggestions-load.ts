export const EDITOR_BLOCK_SUGGESTIONS_LOAD_ERROR_MESSAGE = "编辑建议加载失败";

export function nextBlockSuggestionsAfterLoad<T>(
  input: { previous: T[] } & ({ ok: true; suggestions: T[] } | { ok: false }),
): { suggestions: T[]; loadError: string | null } {
  if (!input.ok) {
    return {
      suggestions: input.previous,
      loadError: EDITOR_BLOCK_SUGGESTIONS_LOAD_ERROR_MESSAGE,
    };
  }

  return { suggestions: input.suggestions, loadError: null };
}
