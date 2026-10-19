import type { ReferenceState } from "@/lib/reading/highlight-references";

export const TASK_LINKED_CONTENT_LOAD_ERROR_MESSAGE = "关联内容加载失败";

export type LinkedTargetSnapshot = {
  reading: {
    id: string;
    title: string | null;
    state: ReferenceState;
    highlightId?: string | null;
  } | null;
  note: {
    id: string;
    title: string | null;
    state: ReferenceState;
  } | null;
};

type LinkedContentLoadInput = { previous: LinkedTargetSnapshot } & (
  | { ok: true; current: LinkedTargetSnapshot }
  | { ok: false; error?: { message?: string } | null }
);

export function nextLinkedContentAfterLoad(
  input: LinkedContentLoadInput
): { current: LinkedTargetSnapshot; loadError: string | null } {
  if (input.ok) {
    return { current: input.current, loadError: null };
  }

  return {
    current: input.previous,
    loadError: input.error?.message?.trim() || TASK_LINKED_CONTENT_LOAD_ERROR_MESSAGE,
  };
}
