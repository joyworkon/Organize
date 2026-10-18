import { describe, expect, it } from "vitest";
import {
  EDITOR_BLOCK_COMMENTS_LOAD_ERROR_MESSAGE,
  nextBlockCommentsAfterLoad,
} from "./block-comments-load";

describe("nextBlockCommentsAfterLoad", () => {
  it("replaces threads and clears the load error on success", () => {
    const previous = [{ id: "old" }];
    const fresh = [{ id: "new" }];

    const plan = nextBlockCommentsAfterLoad({ previous, ok: true, threads: fresh });

    expect(plan.threads).toBe(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("keeps previous threads by reference and reports an error on failure", () => {
    const previous = [{ id: "old" }];

    const plan = nextBlockCommentsAfterLoad({ previous, ok: false });

    expect(plan.threads).toBe(previous);
    expect(plan.loadError).toBe(EDITOR_BLOCK_COMMENTS_LOAD_ERROR_MESSAGE);
  });

  it("returns empty threads and an error when the first load fails", () => {
    const plan = nextBlockCommentsAfterLoad({ previous: [], ok: false });

    expect(plan.threads).toEqual([]);
    expect(plan.loadError).toBe(EDITOR_BLOCK_COMMENTS_LOAD_ERROR_MESSAGE);
  });

  it("treats a successful empty result as a real empty state", () => {
    const empty: Array<{ id: string }> = [];

    const plan = nextBlockCommentsAfterLoad({
      previous: [{ id: "old" }],
      ok: true,
      threads: empty,
    });

    expect(plan.threads).toBe(empty);
    expect(plan.loadError).toBeNull();
  });

  it("retains the same previous snapshot across repeated failures", () => {
    const previous = [{ id: "old" }];
    const first = nextBlockCommentsAfterLoad({ previous, ok: false });

    const second = nextBlockCommentsAfterLoad({ previous: first.threads, ok: false });

    expect(second.threads).toBe(first.threads);
    expect(second.threads).toBe(previous);
    expect(second.loadError).toBe(EDITOR_BLOCK_COMMENTS_LOAD_ERROR_MESSAGE);
  });
});
