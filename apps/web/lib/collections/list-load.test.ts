import { describe, expect, it } from "vitest";
import type { CollectionSummary } from "@/lib/collections/types";
import {
  COLLECTIONS_LIST_LOAD_ERROR_MESSAGE,
  nextCollectionsAfterLoad,
} from "./list-load";

const collection = (id: string, name = id): CollectionSummary => ({
  id,
  name,
  itemCount: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("nextCollectionsAfterLoad", () => {
  it("on success replaces the list and clears the error", () => {
    const previous = [collection("old")];
    const fresh = [collection("a"), collection("b")];
    const plan = nextCollectionsAfterLoad({ previous, data: fresh, error: null });
    expect(plan.collections).toEqual(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on failure keeps a non-empty previous snapshot and surfaces the error message", () => {
    const previous = [collection("old")];
    const plan = nextCollectionsAfterLoad({
      previous,
      data: null,
      error: { message: "boom" },
    });
    expect(plan.collections).toBe(previous);
    expect(plan.loadError).toBe("boom");
  });

  it("on failure falls back to the constant message when error.message is blank", () => {
    const previous = [collection("old")];
    const plan = nextCollectionsAfterLoad({
      previous,
      data: null,
      error: { message: "   " },
    });
    expect(plan.collections).toBe(previous);
    expect(plan.loadError).toBe(COLLECTIONS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("treats null data without error as a failure too, not as an empty list", () => {
    const previous = [collection("old")];
    const plan = nextCollectionsAfterLoad({
      previous,
      data: null,
      error: null,
    });
    expect(plan.collections).toBe(previous);
    expect(plan.loadError).toBe(COLLECTIONS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("on first-load failure keeps collections empty but still reports the error", () => {
    const plan = nextCollectionsAfterLoad({
      previous: [],
      data: null,
      error: { message: "network down" },
    });
    expect(plan.collections).toEqual([]);
    expect(plan.loadError).toBe("network down");
  });

  it("treats an empty successful list as a real empty state without error", () => {
    const plan = nextCollectionsAfterLoad({
      previous: [collection("old")],
      data: [],
      error: null,
    });
    expect(plan.collections).toEqual([]);
    expect(plan.loadError).toBeNull();
  });
});
