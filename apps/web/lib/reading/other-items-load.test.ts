import { describe, expect, it } from "vitest";
import {
  READING_OTHER_ITEMS_LOAD_ERROR_MESSAGE,
  nextOtherItemsAfterLoad,
} from "./other-items-load";

describe("nextOtherItemsAfterLoad", () => {
  it("replaces the previous snapshot and clears the error on success", () => {
    const items = ["new"];
    const result = nextOtherItemsAfterLoad({
      previous: ["old"],
      ok: true,
      items,
    });

    expect(result.items).toBe(items);
    expect(result.loadError).toBeNull();
  });

  it("keeps the previous snapshot by reference on failure", () => {
    const previous = ["old"];
    const result = nextOtherItemsAfterLoad({
      previous,
      ok: false,
      error: { message: "network down" },
    });

    expect(result.items).toBe(previous);
    expect(result.loadError).toBe("network down");
  });

  it("passes through the trimmed error message on failure", () => {
    const result = nextOtherItemsAfterLoad({
      previous: [],
      ok: false,
      error: { message: "  Failed to fetch  " },
    });

    expect(result.loadError).toBe("Failed to fetch");
  });

  it("keeps a first-load failure empty while exposing an error", () => {
    const previous: string[] = [];
    const result = nextOtherItemsAfterLoad({ previous, ok: false });

    expect(result.items).toBe(previous);
    expect(result.items).toEqual([]);
    expect(result.loadError).toBe(READING_OTHER_ITEMS_LOAD_ERROR_MESSAGE);
  });

  it("treats a successful empty list as a valid empty state", () => {
    const result = nextOtherItemsAfterLoad({
      previous: ["old"],
      ok: true,
      items: [],
    });

    expect(result.items).toEqual([]);
    expect(result.loadError).toBeNull();
  });

  it("falls back to the standard message for a blank error message", () => {
    const previous = ["old"];
    const result = nextOtherItemsAfterLoad({
      previous,
      ok: false,
      error: { message: "   " },
    });

    expect(result.items).toBe(previous);
    expect(result.loadError).toBe(READING_OTHER_ITEMS_LOAD_ERROR_MESSAGE);
  });
});
