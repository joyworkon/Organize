export const READING_OTHER_ITEMS_LOAD_ERROR_MESSAGE = "下一篇推荐加载失败";

type OtherItemsLoadInput<T> = { previous: T[] } & (
  | { ok: true; items: T[] }
  | { ok: false; error?: { message?: string } | null }
);

export function nextOtherItemsAfterLoad<T>(
  input: OtherItemsLoadInput<T>
): { items: T[]; loadError: string | null } {
  if (input.ok) {
    return { items: input.items, loadError: null };
  }

  return {
    items: input.previous,
    loadError: input.error?.message?.trim() || READING_OTHER_ITEMS_LOAD_ERROR_MESSAGE,
  };
}
