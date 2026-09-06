import { describe, it, expect } from "vitest";
import { CaptureDraft } from "./capture-draft";
describe("capture acknowledgements", () => {
  it("does not clear text written while an earlier request was pending", () => {
    const draft = new CaptureDraft(); draft.reset("a"); draft.edit("first");
    const request = draft.begin()!; draft.edit("second");
    expect(draft.acknowledge(request)).toBe(false); expect(draft.content).toBe("second");
  });
  it("reuses the id on uncertain retries and clears only the acknowledged revision", () => {
    const draft = new CaptureDraft(); draft.reset("a", "text");
    const request = draft.begin()!; expect(draft.begin()?.id).toBe(request.id);
    expect(draft.acknowledge(request)).toBe(true); expect(draft.content).toBe("");
  });
  it("rejects results from a previous login, including logging back into the same user", () => {
    const draft = new CaptureDraft(); draft.reset("a", "private"); const request = draft.begin()!;
    draft.reset("b", "other"); expect(draft.acknowledge(request)).toBe(false);
    draft.reset("a", "restored"); expect(draft.acknowledge(request)).toBe(false);
    expect(draft.content).toBe("restored");
  });
});
