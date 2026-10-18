import { describe, expect, it } from "vitest";
import {
  READING_HIGHLIGHT_REFERENCES_LOAD_ERROR_MESSAGE,
  nextHighlightReferencesAfterLoad,
} from "./highlight-references-load";

describe("nextHighlightReferencesAfterLoad", () => {
  it("replaces the previous snapshot and clears the error on success", () => {
    const references = { new: "new" };
    const result = nextHighlightReferencesAfterLoad({
      previous: { old: "old" },
      ok: true,
      references,
    });

    expect(result.references).toBe(references);
    expect(result.loadError).toBeNull();
  });

  it("keeps the previous snapshot by reference on failure", () => {
    const previous = { old: "old" };
    const result = nextHighlightReferencesAfterLoad({
      previous,
      ok: false,
      error: { message: "network down" },
    });

    expect(result.references).toBe(previous);
    expect(result.loadError).toBe("network down");
  });

  it("passes through the trimmed error message on failure", () => {
    const result = nextHighlightReferencesAfterLoad({
      previous: {},
      ok: false,
      error: { message: "  Failed to fetch  " },
    });

    expect(result.loadError).toBe("Failed to fetch");
  });

  it("keeps a first-load failure empty while exposing an error", () => {
    const previous: Record<string, string> = {};
    const result = nextHighlightReferencesAfterLoad({ previous, ok: false });

    expect(result.references).toBe(previous);
    expect(result.references).toEqual({});
    expect(result.loadError).toBe(READING_HIGHLIGHT_REFERENCES_LOAD_ERROR_MESSAGE);
  });

  it("treats a successful empty map as a valid empty state", () => {
    const result = nextHighlightReferencesAfterLoad({
      previous: { old: "old" },
      ok: true,
      references: {},
    });

    expect(result.references).toEqual({});
    expect(result.loadError).toBeNull();
  });

  it("falls back to the standard message for a blank error message", () => {
    const previous = { old: "old" };
    const result = nextHighlightReferencesAfterLoad({
      previous,
      ok: false,
      error: { message: "   " },
    });

    expect(result.references).toBe(previous);
    expect(result.loadError).toBe(READING_HIGHLIGHT_REFERENCES_LOAD_ERROR_MESSAGE);
  });
});
