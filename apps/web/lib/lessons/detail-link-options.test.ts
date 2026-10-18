import { describe, expect, it } from "vitest";
import {
  LESSON_LINK_OPTIONS_LOAD_ERROR_MESSAGE,
  nextLinkOptionsAfterLoad,
} from "./detail-link-options";

type Row = { id: string; title: string | null };

const row = (id: string, title: string | null = id): Row => ({ id, title });

const previous = {
  tasks: [row("pt1", "prev task")],
  readingItems: [row("pr1", "prev reading")],
  notes: [row("pn1", "prev note")],
};

const succeed = <T,>(data: T[]) => ({ data, error: null });
const failWith = (message?: string) => ({ data: null, error: { message } });

describe("nextLinkOptionsAfterLoad", () => {
  it("replaces all three lists and clears the error when every route succeeds", () => {
    const plan = nextLinkOptionsAfterLoad({
      previous,
      tasks: succeed([row("t1", "task one")]),
      readings: succeed([row("r1", "reading one")]),
      notes: succeed([row("n1", "note one")]),
    });
    expect(plan.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(plan.readingItems.map((t) => t.id)).toEqual(["r1"]);
    expect(plan.notes.map((t) => t.id)).toEqual(["n1"]);
    expect(plan.loadError).toBeNull();
  });

  it("keeps previous tasks on a tasks failure while still applying the other two routes", () => {
    const plan = nextLinkOptionsAfterLoad({
      previous,
      tasks: failWith("tasks boom"),
      readings: succeed([row("r1", "reading one")]),
      notes: succeed([row("n1", "note one")]),
    });
    expect(plan.tasks).toBe(previous.tasks);
    expect(plan.readingItems.map((t) => t.id)).toEqual(["r1"]);
    expect(plan.notes.map((t) => t.id)).toEqual(["n1"]);
    expect(plan.loadError).toBe("tasks boom");
  });

  it("falls back to the constant message when the failing route's message is blank", () => {
    const plan = nextLinkOptionsAfterLoad({
      previous,
      tasks: failWith("   "),
      readings: succeed([]),
      notes: succeed([]),
    });
    expect(plan.tasks).toBe(previous.tasks);
    expect(plan.loadError).toBe(LESSON_LINK_OPTIONS_LOAD_ERROR_MESSAGE);
  });

  it("keeps the whole previous snapshot when all three routes fail", () => {
    const plan = nextLinkOptionsAfterLoad({
      previous,
      tasks: failWith("tasks boom"),
      readings: failWith("readings boom"),
      notes: failWith("notes boom"),
    });
    expect(plan.tasks).toBe(previous.tasks);
    expect(plan.readingItems).toBe(previous.readingItems);
    expect(plan.notes).toBe(previous.notes);
    expect(plan.loadError).toBe("tasks boom");
  });

  it("surfaces the error but keeps empty lists on a first-load failure with no previous data", () => {
    const plan = nextLinkOptionsAfterLoad({
      previous: { tasks: [], readingItems: [], notes: [] },
      tasks: failWith("tasks boom"),
      readings: succeed([row("r1", "reading one")]),
      notes: failWith(),
    });
    expect(plan.tasks).toEqual([]);
    expect(plan.readingItems.map((t) => t.id)).toEqual(["r1"]);
    expect(plan.notes).toEqual([]);
    expect(plan.loadError).toBe("tasks boom");
  });

  it("treats all-empty successful lists as a real empty state without error", () => {
    const plan = nextLinkOptionsAfterLoad({
      previous,
      tasks: succeed([]),
      readings: succeed([]),
      notes: succeed([]),
    });
    expect(plan.tasks).toEqual([]);
    expect(plan.readingItems).toEqual([]);
    expect(plan.notes).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("treats null data without an error object as a failure, not as an empty list", () => {
    const plan = nextLinkOptionsAfterLoad({
      previous,
      tasks: { data: null, error: null },
      readings: succeed([row("r1", "reading one")]),
      notes: succeed([row("n1", "note one")]),
    });
    expect(plan.tasks).toBe(previous.tasks);
    expect(plan.loadError).toBe(LESSON_LINK_OPTIONS_LOAD_ERROR_MESSAGE);
  });

  it("picks the first non-blank message among failed routes in tasks → readings → notes order", () => {
    const plan = nextLinkOptionsAfterLoad({
      previous,
      tasks: failWith("   "),
      readings: failWith("readings boom"),
      notes: failWith("notes boom"),
    });
    expect(plan.loadError).toBe("readings boom");

    const notesOnly = nextLinkOptionsAfterLoad({
      previous,
      tasks: succeed([]),
      readings: succeed([]),
      notes: failWith("notes boom"),
    });
    expect(notesOnly.notes).toBe(previous.notes);
    expect(notesOnly.loadError).toBe("notes boom");
  });
});
