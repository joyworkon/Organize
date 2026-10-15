import { describe, expect, it } from "vitest";
import { captureDraftStorageKey, draftAfterSubmit, isCaptureSubmissionCurrent } from "@/lib/dashboard/capture-draft";

describe("dashboard capture draft", () => {
  it("scopes saved drafts to an account", () => {
    expect(captureDraftStorageKey("user-a")).not.toBe(captureDraftStorageKey("user-b"));
  });

  it("clears only the submitted snapshot and preserves later typing", () => {
    expect(draftAfterSubmit("first draft", "first draft")).toBe("");
    expect(draftAfterSubmit("first draft plus more", "first draft")).toBe("first draft plus more");
  });

  it("ignores a completed request after the account changes, even when draft text matches", () => {
    const submitted = { userId: "account-a", generation: 4, text: "same title" };
    const current = { userId: "account-b", generation: 5, text: "same title" };
    const appliesResult = isCaptureSubmissionCurrent(submitted.userId, submitted.generation, current.userId, current.generation);
    expect(appliesResult).toBe(false);
    expect(appliesResult ? draftAfterSubmit(current.text, submitted.text) : current.text).toBe("same title");
  });
});
