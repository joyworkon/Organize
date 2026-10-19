import { describe, expect, it } from "vitest";
import {
  EDITOR_BLOCK_SUGGESTIONS_LOAD_ERROR_MESSAGE,
  nextBlockSuggestionsAfterLoad,
} from "./block-suggestions-load";

describe("nextBlockSuggestionsAfterLoad", () => {
  it("replaces suggestions and clears the load error on success", () => {
    const previous = [{ id: "old" }];
    const fresh = [{ id: "new" }];

    const plan = nextBlockSuggestionsAfterLoad({ previous, ok: true, suggestions: fresh });

    expect(plan.suggestions).toBe(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("keeps previous suggestions by reference and reports an error on failure", () => {
    const previous = [{ id: "old" }];

    const plan = nextBlockSuggestionsAfterLoad({ previous, ok: false });

    expect(plan.suggestions).toBe(previous);
    expect(plan.loadError).toBe(EDITOR_BLOCK_SUGGESTIONS_LOAD_ERROR_MESSAGE);
  });

  it("returns empty suggestions and an error when the first load fails", () => {
    const plan = nextBlockSuggestionsAfterLoad({ previous: [], ok: false });

    expect(plan.suggestions).toEqual([]);
    expect(plan.loadError).toBe(EDITOR_BLOCK_SUGGESTIONS_LOAD_ERROR_MESSAGE);
  });

  it("treats a successful empty result as a real empty state", () => {
    const empty: Array<{ id: string }> = [];

    const plan = nextBlockSuggestionsAfterLoad({
      previous: [{ id: "old" }],
      ok: true,
      suggestions: empty,
    });

    expect(plan.suggestions).toBe(empty);
    expect(plan.loadError).toBeNull();
  });

  it("retains the same previous snapshot across repeated failures", () => {
    const previous = [{ id: "old" }];
    const first = nextBlockSuggestionsAfterLoad({ previous, ok: false });

    const second = nextBlockSuggestionsAfterLoad({ previous: first.suggestions, ok: false });

    expect(second.suggestions).toBe(first.suggestions);
    expect(second.suggestions).toBe(previous);
    expect(second.loadError).toBe(EDITOR_BLOCK_SUGGESTIONS_LOAD_ERROR_MESSAGE);
  });
});
