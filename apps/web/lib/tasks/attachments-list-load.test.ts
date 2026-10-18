import { describe, expect, it } from "vitest";
import type { TaskAttachment } from "@organize/shared";
import {
  TASK_ATTACHMENTS_LIST_LOAD_ERROR_MESSAGE,
  nextAttachmentsAfterLoad,
} from "./attachments-list-load";

const attachment = (id: string, name = id): TaskAttachment => ({
  id,
  user_id: "u1",
  task_id: "t1",
  name,
  bucket: "task-attachments",
  path: `u1/${id}`,
  mime_type: "application/pdf",
  size_bytes: 1024,
  created_at: "2026-01-01T00:00:00Z",
});

describe("nextAttachmentsAfterLoad", () => {
  it("on success replaces the list and clears the error", () => {
    const previous = [attachment("old")];
    const fresh = [attachment("a"), attachment("b")];
    const plan = nextAttachmentsAfterLoad({ previous, data: fresh, error: null });
    expect(plan.attachments).toEqual(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on failure keeps a non-empty previous snapshot and surfaces the error message", () => {
    const previous = [attachment("old")];
    const plan = nextAttachmentsAfterLoad({
      previous,
      data: null,
      error: { message: "boom" },
    });
    expect(plan.attachments).toBe(previous);
    expect(plan.loadError).toBe("boom");
  });

  it("on failure falls back to the constant message when error.message is blank", () => {
    const previous = [attachment("old")];
    const plan = nextAttachmentsAfterLoad({
      previous,
      data: null,
      error: { message: "   " },
    });
    expect(plan.attachments).toBe(previous);
    expect(plan.loadError).toBe(TASK_ATTACHMENTS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("treats null data without error as a failure too, not as an empty list", () => {
    const previous = [attachment("old")];
    const plan = nextAttachmentsAfterLoad({
      previous,
      data: null,
      error: null,
    });
    expect(plan.attachments).toBe(previous);
    expect(plan.loadError).toBe(TASK_ATTACHMENTS_LIST_LOAD_ERROR_MESSAGE);
  });

  it("on first-load failure keeps attachments empty but still reports the error", () => {
    const plan = nextAttachmentsAfterLoad({
      previous: [],
      data: null,
      error: { message: "network down" },
    });
    expect(plan.attachments).toEqual([]);
    expect(plan.loadError).toBe("network down");
  });

  it("treats an empty successful list as a real empty state without error", () => {
    const plan = nextAttachmentsAfterLoad({
      previous: [attachment("old")],
      data: [],
      error: null,
    });
    expect(plan.attachments).toEqual([]);
    expect(plan.loadError).toBeNull();
  });
});
