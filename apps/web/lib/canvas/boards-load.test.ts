import { describe, expect, it } from "vitest";
import {
  CANVAS_BOARDS_LOAD_ERROR_MESSAGE,
  nextBoardIdAfterLoad,
  nextBoardsAfterLoad,
} from "./boards-load";

interface BoardOption {
  id: string;
  name: string;
  regionCount: number;
}

const board = (id: string, name = id): BoardOption => ({ id, name, regionCount: 1 });

describe("nextBoardsAfterLoad", () => {
  it("on success replaces the boards and clears the error", () => {
    const previous = [board("old")];
    const fresh = [board("a"), board("b")];
    const plan = nextBoardsAfterLoad({ previous, ok: true, boards: fresh });
    expect(plan.boards).toBe(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on failure keeps a non-empty previous snapshot instead of faking an empty page list", () => {
    const previous = [board("old")];
    const plan = nextBoardsAfterLoad({ previous, ok: false });
    expect(plan.boards).toBe(previous);
    expect(plan.loadError).toBe(CANVAS_BOARDS_LOAD_ERROR_MESSAGE);
  });

  it("on first-load failure returns an empty list WITH an error so UI shows error + retry, not 'no pages'", () => {
    const plan = nextBoardsAfterLoad({ previous: [], ok: false });
    expect(plan.boards).toEqual([]);
    expect(plan.loadError).toBe(CANVAS_BOARDS_LOAD_ERROR_MESSAGE);
  });

  it("treats an empty successful load as a real empty state without error", () => {
    const plan = nextBoardsAfterLoad({ previous: [board("old")], ok: true, boards: [] });
    expect(plan.boards).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("distinguishes success-empty from failure-empty only by loadError", () => {
    const failed = nextBoardsAfterLoad({ previous: [], ok: false });
    const emptyOk = nextBoardsAfterLoad({ previous: [], ok: true, boards: [] });
    expect(failed.boards).toEqual(emptyOk.boards);
    expect(failed.loadError).not.toBeNull();
    expect(emptyOk.loadError).toBeNull();
  });
});

describe("nextBoardIdAfterLoad", () => {
  const boards = [board("p1"), board("p2"), board("p3")];

  it("keeps the current selection when it is still in the list (retry / kept snapshot)", () => {
    expect(nextBoardIdAfterLoad(boards, "p2")).toBe("p2");
  });

  it("falls back to the first board when the current selection is gone (switched canvas)", () => {
    expect(nextBoardIdAfterLoad(boards, "from-other-canvas")).toBe("p1");
  });

  it("picks the first board when nothing was selected yet", () => {
    expect(nextBoardIdAfterLoad(boards, "")).toBe("p1");
  });

  it("returns empty id for an empty list regardless of previous selection", () => {
    expect(nextBoardIdAfterLoad([], "p1")).toBe("");
    expect(nextBoardIdAfterLoad([], "")).toBe("");
  });
});
