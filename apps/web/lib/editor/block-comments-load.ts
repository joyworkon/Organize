export const EDITOR_BLOCK_COMMENTS_LOAD_ERROR_MESSAGE = "评论加载失败";

export function nextBlockCommentsAfterLoad<T>(
  input: { previous: T[] } & ({ ok: true; threads: T[] } | { ok: false }),
): { threads: T[]; loadError: string | null } {
  if (!input.ok) {
    return {
      threads: input.previous,
      loadError: EDITOR_BLOCK_COMMENTS_LOAD_ERROR_MESSAGE,
    };
  }

  return { threads: input.threads, loadError: null };
}
