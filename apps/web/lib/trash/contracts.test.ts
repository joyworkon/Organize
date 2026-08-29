import { describe, expect, it } from "vitest";
import { parseTrashMutation } from "./contracts";

const id = "10000000-0000-4000-8000-000000000001";

describe("parseTrashMutation", () => {
  it("accepts a bounded, deduplicated mutation", () => {
    expect(
      parseTrashMutation({
        action: "soft_delete",
        resource_type: "note",
        ids: [id, id],
      })
    ).toEqual({
      action: "soft_delete",
      resourceType: "note",
      ids: [id],
    });
  });

  it("accepts memo as a trash resource type（P1-04 速记接入垃圾箱）", () => {
    expect(
      parseTrashMutation({
        action: "restore",
        resource_type: "memo",
        ids: [id],
      })
    ).toEqual({
      action: "restore",
      resourceType: "memo",
      ids: [id],
    });
  });

  it.each([
    null,
    {},
    { action: "delete", resource_type: "note", ids: [id] },
    { action: "restore", resource_type: "share", ids: [id] },
    { action: "restore", resource_type: "note", ids: [] },
    { action: "restore", resource_type: "note", ids: ["not-a-uuid"] },
  ])("rejects invalid mutation %#", (value) => {
    expect(parseTrashMutation(value)).toBeNull();
  });
});
