import { describe, expect, it } from "vitest";
import type { ReadingItem } from "@organize/shared";
import {
  READING_LIST_LOAD_ERROR_MESSAGE,
  READING_TAG_FILTER_ERROR_MESSAGE,
  nextReadingItemsAfterLoad,
  nextReadingItemsAfterTagScope,
} from "./list-load";

const item = (id: string): ReadingItem => ({
  id,
  user_id: "u1",
  url: `https://example.com/${id}`,
  title: id,
  content: null,
  excerpt: null,
  cover_image: null,
  reading_status: "unread",
  reading_progress: 0,
  started_reading_at: null,
  completed_reading_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

describe("nextReadingItemsAfterLoad", () => {
  it("on success replaces the list and clears the error", () => {
    const previous = [item("old")];
    const fresh = [item("a"), item("b")];
    const plan = nextReadingItemsAfterLoad({ previous, data: fresh, error: null });
    expect(plan.items).toEqual(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on failure keeps a non-empty previous snapshot instead of faking an empty list", () => {
    const previous = [item("old")];
    const plan = nextReadingItemsAfterLoad({
      previous,
      data: null,
      error: { message: "Failed to fetch" },
    });
    expect(plan.items).toBe(previous);
    expect(plan.loadError).toBe("Failed to fetch");
  });

  it("on failure falls back to the standard message when error.message is blank", () => {
    const plan = nextReadingItemsAfterLoad({
      previous: [],
      data: null,
      error: { message: "  " },
    });
    expect(plan.loadError).toBe(READING_LIST_LOAD_ERROR_MESSAGE);
  });

  it("on first-load failure (previous=[]) keeps items empty but flags the error", () => {
    const plan = nextReadingItemsAfterLoad({ previous: [], data: null, error: {} });
    expect(plan.items).toEqual([]);
    expect(plan.loadError).toBe(READING_LIST_LOAD_ERROR_MESSAGE);
  });

  it("treats an empty successful list as a real empty state without error", () => {
    const plan = nextReadingItemsAfterLoad({ previous: [item("old")], data: [], error: null });
    expect(plan.items).toEqual([]);
    expect(plan.loadError).toBeNull();
  });
});

describe("nextReadingItemsAfterTagScope", () => {
  it("on tag query failure keeps the previous list instead of clearing it", () => {
    const previous = [item("old")];
    const plan = nextReadingItemsAfterTagScope({
      previous,
      tagRows: null,
      tagError: { message: "network down" },
    });
    expect(plan.status).toBe("error");
    if (plan.status !== "error") return;
    expect(plan.items).toBe(previous);
    expect(plan.loadError).toBe("network down");
  });

  it("treats null tagRows without an error as a failure, not an empty match", () => {
    const previous = [item("old")];
    const plan = nextReadingItemsAfterTagScope({ previous, tagRows: null, tagError: null });
    expect(plan.status).toBe("error");
    if (plan.status !== "error") return;
    expect(plan.items).toBe(previous);
    expect(plan.loadError).toBe(READING_TAG_FILTER_ERROR_MESSAGE);
  });

  it("treats an empty successful tag query as a real empty match", () => {
    const plan = nextReadingItemsAfterTagScope({ previous: [item("old")], tagRows: [], tagError: null });
    expect(plan.status).toBe("empty");
    if (plan.status !== "empty") return;
    expect(plan.items).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("dedupes item ids into scopedIds for the main query", () => {
    const plan = nextReadingItemsAfterTagScope({
      previous: [],
      tagRows: [
        { item_id: "a" },
        { item_id: "b" },
        { item_id: "a" },
        { item_id: null },
      ],
      tagError: null,
    });
    expect(plan.status).toBe("scoped");
    if (plan.status !== "scoped") return;
    expect(plan.scopedIds).toEqual(["a", "b"]);
    expect(plan.loadError).toBeNull();
  });
});
