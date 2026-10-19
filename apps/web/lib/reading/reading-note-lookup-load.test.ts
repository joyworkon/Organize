import { describe, expect, it } from "vitest";
import {
  READING_NOTE_LOOKUP_LOAD_ERROR_MESSAGE,
  nextReadingNoteIdAfterLookup,
} from "./reading-note-lookup-load";

describe("nextReadingNoteIdAfterLookup", () => {
  it("uses the found note id and clears the error on success", () => {
    const result = nextReadingNoteIdAfterLookup({
      previous: "old-note",
      ok: true,
      noteId: "new-note",
    });

    expect(result).toEqual({ noteId: "new-note", loadError: null });
  });

  it("treats a successful null lookup as a valid empty state", () => {
    const result = nextReadingNoteIdAfterLookup({
      previous: "old-note",
      ok: true,
      noteId: null,
    });

    expect(result).toEqual({ noteId: null, loadError: null });
  });

  it("keeps the previous note id on failure and exposes the trimmed error", () => {
    const previous = "existing-note";
    const result = nextReadingNoteIdAfterLookup({
      previous,
      ok: false,
      error: { message: "  network down  " },
    });

    expect(result.noteId).toBe(previous);
    expect(result.loadError).toBe("network down");
  });

  it("keeps a first-load failure empty while exposing the default error", () => {
    const result = nextReadingNoteIdAfterLookup({ previous: null, ok: false });

    expect(result.noteId).toBeNull();
    expect(result.loadError).toBe(READING_NOTE_LOOKUP_LOAD_ERROR_MESSAGE);
  });

  it("falls back to the default error for a blank message without changing the previous id", () => {
    const previous = "existing-note";
    const result = nextReadingNoteIdAfterLookup({
      previous,
      ok: false,
      error: { message: "   " },
    });

    expect(result.noteId).toBe(previous);
    expect(result.loadError).toBe(READING_NOTE_LOOKUP_LOAD_ERROR_MESSAGE);
  });

  it("keeps a null previous value unchanged when the error is null", () => {
    const result = nextReadingNoteIdAfterLookup({
      previous: null,
      ok: false,
      error: null,
    });

    expect(result.noteId).toBeNull();
    expect(result.loadError).toBe(READING_NOTE_LOOKUP_LOAD_ERROR_MESSAGE);
  });
});
