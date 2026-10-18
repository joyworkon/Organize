import { describe, expect, it } from "vitest";
import type { LessonWithTags } from "@organize/shared";
import {
  LESSONS_LIST_LOAD_ERROR_MESSAGE,
  nextLessonsAfterLoad,
} from "./list-load";

const lesson = (id: string, title = id): LessonWithTags => ({
  id,
  user_id: "u1",
  title,
  content: null,
  lesson_type: "lesson",
  task_id: null,
  reading_item_id: null,
  note_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  tags: [],
});

describe("nextLessonsAfterLoad", () => {
  it("on success replaces the list and clears the error", () => {
    const previous = [lesson("old")];
    const fresh = [lesson("a"), lesson("b")];
    const plan = nextLessonsAfterLoad({ previous, data: fresh, error: null });
    expect(plan.lessons).toEqual(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on failure keeps a non-empty previous snapshot and surfaces the error message", () => {
    const previous = [lesson("old")];
    const plan = nextLessonsAfterLoad({
      previous,
      data: null,
      error: { message: "boom" },
    });
    expect(plan.lessons).toBe(previous);
    expect(plan.loadError).toBe("boom");
  });

  it("on failure falls back to the constant message when error.message is blank", () => {
    const previous = [lesson("old")];
    const plan = nextLessonsAfterLoad({
      previous,
      data: null,
      error: { message: "   " },
    });
    expect(plan.lessons).toBe(previous);
    expect(plan.loadError).toBe(LESSONS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("treats null data without error as a failure too, not as an empty list", () => {
    const previous = [lesson("old")];
    const plan = nextLessonsAfterLoad({ previous, data: null, error: null });
    expect(plan.lessons).toBe(previous);
    expect(plan.loadError).toBe(LESSONS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("on first-load failure keeps lessons empty but still reports the error", () => {
    const plan = nextLessonsAfterLoad({
      previous: [],
      data: null,
      error: { message: "network down" },
    });
    expect(plan.lessons).toEqual([]);
    expect(plan.loadError).toBe("network down");
  });

  it("treats an empty successful list as a real empty state without error", () => {
    const plan = nextLessonsAfterLoad({
      previous: [lesson("old")],
      data: [],
      error: null,
    });
    expect(plan.lessons).toEqual([]);
    expect(plan.loadError).toBeNull();
  });
});
