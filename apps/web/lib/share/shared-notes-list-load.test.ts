import { describe, expect, it } from "vitest";
import {
  SHARED_NOTES_LIST_LOAD_ERROR_MESSAGE,
  nextSharedNotesAfterLoad,
} from "./shared-notes-list-load";

describe("nextSharedNotesAfterLoad", () => {
  it("replaces the previous snapshot and clears the error on success", () => {
    const data = ["new"];
    const result = nextSharedNotesAfterLoad({
      previousNotes: ["old"],
      data,
      error: null,
    });

    expect(result.notes).toBe(data);
    expect(result.loadError).toBeNull();
  });

  it("keeps the previous snapshot and exposes the trimmed error on failure", () => {
    const previousNotes = ["old"];
    const result = nextSharedNotesAfterLoad({
      previousNotes,
      data: null,
      error: new Error("  network down  "),
    });

    expect(result.notes).toBe(previousNotes);
    expect(result.loadError).toBe("network down");
  });

  it("falls back to the standard message for a blank error message", () => {
    const previousNotes = ["old"];
    const result = nextSharedNotesAfterLoad({
      previousNotes,
      data: null,
      error: new Error("   "),
    });

    expect(result.notes).toBe(previousNotes);
    expect(result.loadError).toBe(SHARED_NOTES_LIST_LOAD_ERROR_MESSAGE);
  });

  it("treats null data without an error as a failure", () => {
    const previousNotes = ["old"];
    const result = nextSharedNotesAfterLoad({
      previousNotes,
      data: null,
      error: null,
    });

    expect(result.notes).toBe(previousNotes);
    expect(result.loadError).toBe(SHARED_NOTES_LIST_LOAD_ERROR_MESSAGE);
  });

  it("treats a successful empty list as a valid empty state", () => {
    const data: string[] = [];
    const result = nextSharedNotesAfterLoad({
      previousNotes: ["old"],
      data,
      error: null,
    });

    expect(result.notes).toBe(data);
    expect(result.notes).toEqual([]);
    expect(result.loadError).toBeNull();
  });
});
