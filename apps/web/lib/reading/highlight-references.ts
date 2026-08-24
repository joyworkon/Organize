export type ReferenceState = "active" | "deleted" | "missing";

export interface HighlightReferenceState {
  highlight_id: string;
  reading_item_id: string;
  reading_title: string | null;
  reading_state: ReferenceState;
  note_id: string | null;
  note_title: string | null;
  note_state: ReferenceState | null;
  task_id: string | null;
  task_title: string | null;
  task_state: ReferenceState | null;
}

export function getReferenceLabel(state: ReferenceState | null): string | null {
  if (state === "deleted") return "已移入垃圾箱";
  if (state === "missing") return "引用已失效";
  return null;
}
