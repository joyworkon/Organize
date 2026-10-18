import { describe, expect, it } from "vitest";
import {
  CANVAS_MATERIAL_SEARCH_ERROR_MESSAGE,
  nextMaterialItemsAfterLoad,
} from "./material-search-load";

interface MaterialRow {
  id: string;
  title: string;
}

const row = (id: string, title = id): MaterialRow => ({ id, title });

describe("nextMaterialItemsAfterLoad", () => {
  it("on success replaces the items and clears the error", () => {
    const previous = [row("old")];
    const fresh = [row("a"), row("b")];
    const plan = nextMaterialItemsAfterLoad({ previous, ok: true, items: fresh });
    expect(plan.items).toBe(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on failure keeps the previous snapshot (same reference) with a non-empty error", () => {
    const previous = [row("old")];
    const plan = nextMaterialItemsAfterLoad({ previous, ok: false });
    expect(plan.items).toBe(previous);
    expect(plan.loadError).toBe(CANVAS_MATERIAL_SEARCH_ERROR_MESSAGE);
    expect(plan.loadError).not.toBeNull();
  });

  it("on first-search failure returns an empty list WITH an error, not 'no matches'", () => {
    const plan = nextMaterialItemsAfterLoad({ previous: [], ok: false });
    expect(plan.items).toEqual([]);
    expect(plan.loadError).toBe(CANVAS_MATERIAL_SEARCH_ERROR_MESSAGE);
  });

  it("treats an empty successful result as a real empty state without error", () => {
    const plan = nextMaterialItemsAfterLoad({ previous: [row("old")], ok: true, items: [] });
    expect(plan.items).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("distinguishes success-empty from failure-empty only by loadError", () => {
    const failed = nextMaterialItemsAfterLoad({ previous: [], ok: false });
    const emptyOk = nextMaterialItemsAfterLoad({ previous: [], ok: true, items: [] });
    expect(failed.items).toEqual(emptyOk.items);
    expect(failed.loadError).not.toBeNull();
    expect(emptyOk.loadError).toBeNull();
  });
});
