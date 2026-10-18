import { describe, expect, it } from "vitest";
import {
  EDITOR_MOVE_NOTES_LOAD_ERROR_MESSAGE,
  nextMoveNotesAfterLoad,
} from "./move-notes-load";

describe("nextMoveNotesAfterLoad", () => {
  it("replaces notes and clears the load error on success", () => {
    const previous = [{ id: "old" }];
    const fresh = [{ id: "new" }];

    const plan = nextMoveNotesAfterLoad({ previous, ok: true, notes: fresh });

    expect(plan.notes).toBe(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("keeps previous notes by reference and reports an error on failure", () => {
    const previous = [{ id: "old" }];

    const plan = nextMoveNotesAfterLoad({ previous, ok: false });

    expect(plan.notes).toBe(previous);
    expect(plan.loadError).toBe(EDITOR_MOVE_NOTES_LOAD_ERROR_MESSAGE);
  });

  it("returns empty notes and an error when the first load fails", () => {
    const plan = nextMoveNotesAfterLoad({ previous: [], ok: false });

    expect(plan.notes).toEqual([]);
    expect(plan.loadError).toBe(EDITOR_MOVE_NOTES_LOAD_ERROR_MESSAGE);
  });

  it("treats a successful empty result as a real empty state", () => {
    const empty: Array<{ id: string }> = [];

    const plan = nextMoveNotesAfterLoad({
      previous: [{ id: "old" }],
      ok: true,
      notes: empty,
    });

    expect(plan.notes).toBe(empty);
    expect(plan.loadError).toBeNull();
  });

  it("retains the same previous snapshot across repeated failures", () => {
    const previous = [{ id: "old" }];
    const first = nextMoveNotesAfterLoad({ previous, ok: false });

    const second = nextMoveNotesAfterLoad({ previous: first.notes, ok: false });

    expect(second.notes).toBe(first.notes);
    expect(second.notes).toBe(previous);
    expect(second.loadError).toBe(EDITOR_MOVE_NOTES_LOAD_ERROR_MESSAGE);
  });
});
