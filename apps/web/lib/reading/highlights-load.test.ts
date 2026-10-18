import { describe, expect, it } from "vitest";
import {
  READING_HIGHLIGHTS_LOAD_ERROR_MESSAGE,
  nextHighlightsAfterLoad,
} from "./highlights-load";

describe("nextHighlightsAfterLoad", () => {
  it("replaces the previous snapshot and clears the error on success", () => {
    const highlights = ["new"];
    const result = nextHighlightsAfterLoad({
      previous: ["old"],
      ok: true,
      highlights,
    });

    expect(result.highlights).toBe(highlights);
    expect(result.loadError).toBeNull();
  });

  it("keeps the previous snapshot by reference on failure", () => {
    const previous = ["old"];
    const result = nextHighlightsAfterLoad({
      previous,
      ok: false,
      error: { message: "network down" },
    });

    expect(result.highlights).toBe(previous);
  });

  it("passes through the trimmed error message on failure", () => {
    const result = nextHighlightsAfterLoad({
      previous: [],
      ok: false,
      error: { message: "  Failed to fetch  " },
    });

    expect(result.loadError).toBe("Failed to fetch");
  });

  it("keeps a first-load failure empty while exposing an error", () => {
    const previous: string[] = [];
    const result = nextHighlightsAfterLoad({ previous, ok: false });

    expect(result.highlights).toBe(previous);
    expect(result.highlights).toEqual([]);
    expect(result.loadError).toBe(READING_HIGHLIGHTS_LOAD_ERROR_MESSAGE);
  });

  it("treats a successful empty list as a valid empty state", () => {
    const result = nextHighlightsAfterLoad({
      previous: ["old"],
      ok: true,
      highlights: [],
    });

    expect(result.highlights).toEqual([]);
    expect(result.loadError).toBeNull();
  });

  it("falls back to the standard message for a blank error message", () => {
    const previous = ["old"];
    const result = nextHighlightsAfterLoad({
      previous,
      ok: false,
      error: { message: "   " },
    });

    expect(result.highlights).toBe(previous);
    expect(result.loadError).toBe(READING_HIGHLIGHTS_LOAD_ERROR_MESSAGE);
  });
});
