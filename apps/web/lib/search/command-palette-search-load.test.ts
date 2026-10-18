import { describe, expect, it } from "vitest";
import {
  COMMAND_PALETTE_SEARCH_ERROR_MESSAGE,
  nextCommandPaletteSearchAfterLoad,
  type CommandPaletteSearchCounts,
} from "./command-palette-search-load";

const counts = (overrides: Partial<CommandPaletteSearchCounts> = {}): CommandPaletteSearchCounts => ({
  reading: 0,
  note: 0,
  task: 0,
  lesson: 0,
  tag: 0,
  memo: 0,
  ...overrides,
});

describe("nextCommandPaletteSearchAfterLoad", () => {
  it("replaces results and counts and clears the error on success", () => {
    const previousResults = [{ id: "old" }];
    const previousCounts = counts({ reading: 1 });
    const freshResults = [{ id: "new" }];
    const freshCounts = counts({ note: 1 });

    const plan = nextCommandPaletteSearchAfterLoad({
      previousResults,
      previousCounts,
      ok: true,
      results: freshResults,
      counts: freshCounts,
    });

    expect(plan.results).toBe(freshResults);
    expect(plan.counts).toBe(freshCounts);
    expect(plan.loadError).toBeNull();
  });

  it("keeps previous results by reference and reports an error on failure", () => {
    const previousResults = [{ id: "old" }];
    const previousCounts = counts({ reading: 1 });

    const plan = nextCommandPaletteSearchAfterLoad({
      previousResults,
      previousCounts,
      ok: false,
    });

    expect(plan.results).toBe(previousResults);
    expect(plan.loadError).toBe(COMMAND_PALETTE_SEARCH_ERROR_MESSAGE);
  });

  it("returns empty results, zero counts, and an error when the first search fails", () => {
    const plan = nextCommandPaletteSearchAfterLoad({
      previousResults: [],
      previousCounts: counts(),
      ok: false,
    });

    expect(plan.results).toEqual([]);
    expect(plan.counts).toEqual(counts());
    expect(plan.loadError).toBe(COMMAND_PALETTE_SEARCH_ERROR_MESSAGE);
  });

  it("treats a successful empty result as a real empty state", () => {
    const emptyResults: Array<{ id: string }> = [];
    const emptyCounts = counts();

    const plan = nextCommandPaletteSearchAfterLoad({
      previousResults: [{ id: "old" }],
      previousCounts: counts({ reading: 1 }),
      ok: true,
      results: emptyResults,
      counts: emptyCounts,
    });

    expect(plan.results).toBe(emptyResults);
    expect(plan.counts).toBe(emptyCounts);
    expect(plan.loadError).toBeNull();
  });

  it("keeps previous counts by reference on failure", () => {
    const previousCounts = counts({ memo: 2 });

    const plan = nextCommandPaletteSearchAfterLoad({
      previousResults: [],
      previousCounts,
      ok: false,
    });

    expect(plan.counts).toBe(previousCounts);
  });
});
