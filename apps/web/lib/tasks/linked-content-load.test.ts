import { describe, expect, it } from "vitest";
import {
  TASK_LINKED_CONTENT_LOAD_ERROR_MESSAGE,
  nextLinkedContentAfterLoad,
  type LinkedTargetSnapshot,
} from "./linked-content-load";

describe("nextLinkedContentAfterLoad", () => {
  it("replaces both targets and clears the error on success", () => {
    const current: LinkedTargetSnapshot = {
      reading: { id: "reading-new", title: "New reading", state: "active" },
      note: { id: "note-new", title: "New note", state: "deleted" },
    };
    const result = nextLinkedContentAfterLoad({
      previous: {
        reading: { id: "reading-old", title: "Old reading", state: "missing" },
        note: null,
      },
      ok: true,
      current,
    });

    expect(result.current).toBe(current);
    expect(result.loadError).toBeNull();
  });

  it("keeps the previous snapshot by reference and trims the error on failure", () => {
    const previous: LinkedTargetSnapshot = {
      reading: { id: "reading-1", title: "Reading", state: "active", highlightId: "hl-1" },
      note: { id: "note-1", title: "Note", state: "active" },
    };
    const result = nextLinkedContentAfterLoad({
      previous,
      ok: false,
      error: { message: "  network down  " },
    });

    expect(result.current).toBe(previous);
    expect(result.loadError).toBe("network down");
  });

  it("keeps a first-load failure empty while exposing the default error", () => {
    const previous: LinkedTargetSnapshot = { reading: null, note: null };
    const result = nextLinkedContentAfterLoad({ previous, ok: false });

    expect(result.current).toBe(previous);
    expect(result.current).toEqual({ reading: null, note: null });
    expect(result.loadError).toBe(TASK_LINKED_CONTENT_LOAD_ERROR_MESSAGE);
  });

  it("treats a successful empty snapshot as a valid state", () => {
    const current: LinkedTargetSnapshot = { reading: null, note: null };
    const result = nextLinkedContentAfterLoad({
      previous: {
        reading: { id: "reading-old", title: null, state: "active" },
        note: { id: "note-old", title: null, state: "active" },
      },
      ok: true,
      current,
    });

    expect(result.current).toBe(current);
    expect(result.current).toEqual({ reading: null, note: null });
    expect(result.loadError).toBeNull();
  });

  it("falls back to the standard message for a blank error message", () => {
    const previous: LinkedTargetSnapshot = {
      reading: { id: "reading-1", title: "Reading", state: "missing" },
      note: null,
    };
    const result = nextLinkedContentAfterLoad({
      previous,
      ok: false,
      error: { message: "   " },
    });

    expect(result.current).toBe(previous);
    expect(result.loadError).toBe(TASK_LINKED_CONTENT_LOAD_ERROR_MESSAGE);
  });

  it("uses the standard message when the failure has no error object", () => {
    const previous: LinkedTargetSnapshot = {
      reading: null,
      note: { id: "note-1", title: "Note", state: "deleted" },
    };
    const result = nextLinkedContentAfterLoad({
      previous,
      ok: false,
      error: null,
    });

    expect(result.current).toBe(previous);
    expect(result.loadError).toBe(TASK_LINKED_CONTENT_LOAD_ERROR_MESSAGE);
  });
});
