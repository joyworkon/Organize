export const NOTE_CONTENT_LINK_STATES_LOAD_ERROR_MESSAGE = "内链状态加载失败";

type ContentLinkStatesLoadInput<T> = { previous: Record<string, T> } & (
  | { ok: true; states: Record<string, T> }
  | { ok: false; error?: { message?: string } | null }
);

export function nextContentLinkStatesAfterLoad<T>(
  input: ContentLinkStatesLoadInput<T>
): { states: Record<string, T>; loadError: string | null } {
  if (input.ok) {
    return { states: input.states, loadError: null };
  }

  return {
    states: input.previous,
    loadError: input.error?.message?.trim() || NOTE_CONTENT_LINK_STATES_LOAD_ERROR_MESSAGE,
  };
}
