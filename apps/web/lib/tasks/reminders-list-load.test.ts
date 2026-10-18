import { describe, expect, it } from "vitest";
import type { TaskReminder } from "@organize/shared";
import {
  TASK_REMINDERS_LIST_LOAD_ERROR_MESSAGE,
  nextRemindersAfterLoad,
} from "./reminders-list-load";

const reminder = (id: string): TaskReminder => ({
  id,
  user_id: "u1",
  task_id: "t1",
  anchor: "start",
  offset_minutes: -10,
  notified_at: null,
  created_at: "2026-01-01T00:00:00Z",
});

describe("nextRemindersAfterLoad", () => {
  it("on success replaces the list and clears the error", () => {
    const previous = [reminder("old")];
    const fresh = [reminder("a"), reminder("b")];
    const plan = nextRemindersAfterLoad({ previous, data: fresh, error: null });
    expect(plan.reminders).toEqual(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on failure keeps a non-empty previous snapshot and surfaces the error message", () => {
    const previous = [reminder("old")];
    const plan = nextRemindersAfterLoad({
      previous,
      data: null,
      error: { message: "boom" },
    });
    expect(plan.reminders).toBe(previous);
    expect(plan.loadError).toBe("boom");
  });

  it("on failure falls back to the constant message when error.message is blank", () => {
    const previous = [reminder("old")];
    const plan = nextRemindersAfterLoad({
      previous,
      data: null,
      error: { message: "   " },
    });
    expect(plan.reminders).toBe(previous);
    expect(plan.loadError).toBe(TASK_REMINDERS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("treats null data without error as a failure too, not as an empty list", () => {
    const previous = [reminder("old")];
    const plan = nextRemindersAfterLoad({
      previous,
      data: null,
      error: null,
    });
    expect(plan.reminders).toBe(previous);
    expect(plan.loadError).toBe(TASK_REMINDERS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("on first-load failure keeps reminders empty but still reports the error", () => {
    const plan = nextRemindersAfterLoad({
      previous: [],
      data: null,
      error: { message: "network down" },
    });
    expect(plan.reminders).toEqual([]);
    expect(plan.loadError).toBe("network down");
  });

  it("treats an empty successful list as a real empty state without error", () => {
    const plan = nextRemindersAfterLoad({
      previous: [reminder("old")],
      data: [],
      error: null,
    });
    expect(plan.reminders).toEqual([]);
    expect(plan.loadError).toBeNull();
  });
});
