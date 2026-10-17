import { describe, expect, it } from "vitest";
import type { CanvasListItem } from "./repository";
import { CANVAS_LIST_LOAD_ERROR_MESSAGE, nextCanvasItemsAfterLoad } from "./list-load";

const item = (id: string, title = id): CanvasListItem => ({
  id,
  title,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

describe("nextCanvasItemsAfterLoad", () => {
  it("on success replaces the list and clears the error", () => {
    const previous = [item("old")];
    const fresh = [item("a"), item("b")];
    const plan = nextCanvasItemsAfterLoad({ previous, list: fresh });
    expect(plan.items).toEqual(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on failure keeps a non-empty previous snapshot instead of faking an empty list", () => {
    const previous = [item("old")];
    const plan = nextCanvasItemsAfterLoad({ previous, list: null });
    expect(plan.items).toBe(previous);
    expect(plan.loadError).toBe(CANVAS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("on first-load failure keeps items null so the page shows the error block, not the empty state", () => {
    const plan = nextCanvasItemsAfterLoad({ previous: null, list: null });
    expect(plan.items).toBeNull();
    expect(plan.loadError).toBe(CANVAS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("treats an empty successful list as a real empty state without error", () => {
    const plan = nextCanvasItemsAfterLoad({ previous: [item("old")], list: [] });
    expect(plan.items).toEqual([]);
    expect(plan.loadError).toBeNull();
  });
});
