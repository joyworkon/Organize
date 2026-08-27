import { describe, expect, it } from "vitest";
import { claimTaskNoteCreation, releaseTaskNoteCreation } from "./note-link";

describe("taskNoteCreation 入场券", () => {
  it("同一任务在途期间不能重复领取", () => {
    const taskId = "t-note-link-1";
    expect(claimTaskNoteCreation(taskId)).toBe(true);
    expect(claimTaskNoteCreation(taskId)).toBe(false);
    releaseTaskNoteCreation(taskId);
    expect(claimTaskNoteCreation(taskId)).toBe(true);
    releaseTaskNoteCreation(taskId);
  });

  it("不同任务互不干扰", () => {
    expect(claimTaskNoteCreation("t-a")).toBe(true);
    expect(claimTaskNoteCreation("t-b")).toBe(true);
    releaseTaskNoteCreation("t-a");
    releaseTaskNoteCreation("t-b");
  });
});
