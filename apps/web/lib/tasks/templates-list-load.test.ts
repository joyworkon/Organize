import { describe, expect, it } from "vitest";
import type { TaskTemplate } from "@organize/shared";
import {
  TASK_TEMPLATES_LIST_LOAD_ERROR_MESSAGE,
  nextTemplatesAfterLoad,
} from "./templates-list-load";

const template = (id: string, name = id): TaskTemplate => ({
  id,
  user_id: "u1",
  name,
  template: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

describe("nextTemplatesAfterLoad", () => {
  it("on success replaces the list and clears the error", () => {
    const previous = [template("old")];
    const fresh = [template("a"), template("b")];
    const plan = nextTemplatesAfterLoad({ previous, data: fresh, error: null });
    expect(plan.templates).toEqual(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on failure keeps a non-empty previous snapshot and surfaces the error message", () => {
    const previous = [template("old")];
    const plan = nextTemplatesAfterLoad({
      previous,
      data: null,
      error: { message: "boom" },
    });
    expect(plan.templates).toBe(previous);
    expect(plan.loadError).toBe("boom");
  });

  it("on failure falls back to the constant message when error.message is blank", () => {
    const previous = [template("old")];
    const plan = nextTemplatesAfterLoad({
      previous,
      data: null,
      error: { message: "   " },
    });
    expect(plan.templates).toBe(previous);
    expect(plan.loadError).toBe(TASK_TEMPLATES_LIST_LOAD_ERROR_MESSAGE);
  });

  it("treats null data without error as a failure too, not as an empty list", () => {
    const previous = [template("old")];
    const plan = nextTemplatesAfterLoad({
      previous,
      data: null,
      error: null,
    });
    expect(plan.templates).toBe(previous);
    expect(plan.loadError).toBe(TASK_TEMPLATES_LIST_LOAD_ERROR_MESSAGE);
  });

  it("on first-load failure keeps templates empty but still reports the error", () => {
    const plan = nextTemplatesAfterLoad({
      previous: [],
      data: null,
      error: { message: "network down" },
    });
    expect(plan.templates).toEqual([]);
    expect(plan.loadError).toBe("network down");
  });

  it("treats an empty successful list as a real empty state without error", () => {
    const plan = nextTemplatesAfterLoad({
      previous: [template("old")],
      data: [],
      error: null,
    });
    expect(plan.templates).toEqual([]);
    expect(plan.loadError).toBeNull();
  });
});
