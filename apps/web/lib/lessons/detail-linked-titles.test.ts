import { describe, expect, it } from "vitest";
import {
  LESSON_LINKED_TITLES_LOAD_ERROR_MESSAGE,
  nextLinkedTitlesAfterLoad,
} from "./detail-linked-titles";

type Row = { id: string; title: string | null };
type ReadingRow = Row & { url: string };

const row = (id: string, title: string | null = id): Row => ({ id, title });
const readingRow = (id: string, title: string | null = id, url = `https://x/${id}`): ReadingRow => ({ id, title, url });

const ids = { taskId: "t1", readingId: "r1", noteId: "n1" };

const previous = {
  task: row("t1", "prev task"),
  reading: readingRow("r1", "prev reading"),
  note: row("n1", "prev note"),
};
const emptyPrevious = { task: null, reading: null, note: null };

const succeed = <T,>(data: T) => ({ data, error: null });
const failWith = (message?: string, code?: string) => ({ data: null, error: { message, code } });
const notFound = () => failWith("JSON object requested, multiple (or no) rows returned", "PGRST116");
const noRow = () => ({ data: null, error: null });

describe("nextLinkedTitlesAfterLoad", () => {
  it("uses fresh data on all three routes and clears the error when every route succeeds", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids,
      previous,
      task: succeed(row("t1", "task one")),
      reading: succeed(readingRow("r1", "reading one")),
      note: succeed(row("n1", "note one")),
    });
    expect(plan.linkedTask).toEqual(row("t1", "task one"));
    expect(plan.linkedReading).toEqual(readingRow("r1", "reading one"));
    expect(plan.linkedNote).toEqual(row("n1", "note one"));
    expect(plan.loadError).toBeNull();
  });

  it("keeps previous.task on a task failure while still applying the other two routes", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids,
      previous,
      task: failWith("tasks boom"),
      reading: succeed(readingRow("r1", "reading one")),
      note: succeed(row("n1", "note one")),
    });
    expect(plan.linkedTask).toBe(previous.task);
    expect(plan.linkedReading).toEqual(readingRow("r1", "reading one"));
    expect(plan.linkedNote).toEqual(row("n1", "note one"));
    expect(plan.loadError).toBe("tasks boom");
  });

  it("treats PGRST116 (target row deleted) as a real missing link: null without loadError", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids,
      previous,
      task: notFound(),
      reading: succeed(readingRow("r1", "reading one")),
      note: notFound(),
    });
    expect(plan.linkedTask).toBeNull();
    expect(plan.linkedReading).toEqual(readingRow("r1", "reading one"));
    expect(plan.linkedNote).toBeNull();
    expect(plan.loadError).toBeNull();
  });

  it("treats null data without an error (mock .single() on zero rows) as missing, not as a failure", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids,
      previous,
      task: noRow(),
      reading: noRow(),
      note: succeed(row("n1", "note one")),
    });
    expect(plan.linkedTask).toBeNull();
    expect(plan.linkedReading).toBeNull();
    expect(plan.linkedNote).toEqual(row("n1", "note one"));
    expect(plan.loadError).toBeNull();
  });

  it("clears a route without an id regardless of its result, and never counts it as a failure", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids: { taskId: null, readingId: "", noteId: "n1" },
      previous,
      task: failWith("should be ignored"),
      reading: failWith("should be ignored too"),
      note: succeed(row("n1", "note one")),
    });
    expect(plan.linkedTask).toBeNull();
    expect(plan.linkedReading).toBeNull();
    expect(plan.linkedNote).toEqual(row("n1", "note one"));
    expect(plan.loadError).toBeNull();
  });

  it("falls back to minimal stubs plus loadError on a first-load failure with no previous snapshot", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids,
      previous: emptyPrevious,
      task: failWith("tasks boom"),
      reading: failWith("readings boom"),
      note: failWith(),
    });
    expect(plan.linkedTask).toEqual({ id: "t1", title: null });
    expect(plan.linkedReading).toEqual({ id: "r1", title: null, url: "" });
    expect(plan.linkedNote).toEqual({ id: "n1", title: null });
    expect(plan.loadError).toBe("tasks boom");
  });

  it("falls back to the constant message when the failing route's message is blank", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids,
      previous,
      task: failWith("   "),
      reading: succeed(readingRow("r1", "reading one")),
      note: succeed(row("n1", "note one")),
    });
    expect(plan.linkedTask).toBe(previous.task);
    expect(plan.loadError).toBe(LESSON_LINKED_TITLES_LOAD_ERROR_MESSAGE);
  });

  it("does not reuse a previous row whose id no longer matches the lesson's foreign key", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids: { taskId: "t2", readingId: "r1", noteId: "n1" },
      previous,
      task: failWith("tasks boom"),
      reading: succeed(readingRow("r1", "reading one")),
      note: succeed(row("n1", "note one")),
    });
    expect(plan.linkedTask).toEqual({ id: "t2", title: null });
    expect(plan.loadError).toBe("tasks boom");
  });

  it("picks the first non-blank message among failed routes in task → reading → note order", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids,
      previous,
      task: failWith("   "),
      reading: failWith("readings boom"),
      note: failWith("notes boom"),
    });
    expect(plan.linkedTask).toBe(previous.task);
    expect(plan.linkedReading).toBe(previous.reading);
    expect(plan.linkedNote).toBe(previous.note);
    expect(plan.loadError).toBe("readings boom");

    const noteOnly = nextLinkedTitlesAfterLoad({
      ids,
      previous,
      task: succeed(row("t1", "task one")),
      reading: succeed(readingRow("r1", "reading one")),
      note: failWith("notes boom"),
    });
    expect(noteOnly.linkedNote).toBe(previous.note);
    expect(noteOnly.loadError).toBe("notes boom");
  });

  it("does not let a PGRST116 route mask a real failure on another route", () => {
    const plan = nextLinkedTitlesAfterLoad({
      ids,
      previous,
      task: notFound(),
      reading: failWith("readings boom"),
      note: succeed(row("n1", "note one")),
    });
    expect(plan.linkedTask).toBeNull();
    expect(plan.linkedReading).toBe(previous.reading);
    expect(plan.loadError).toBe("readings boom");
  });
});
