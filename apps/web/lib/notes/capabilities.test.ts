import { describe, expect, it } from "vitest";
import { deriveNotePageCapabilities } from "./capabilities";

describe("deriveNotePageCapabilities（R08.5）", () => {
  it("owner / editor 可编辑可改标签，非 viewer 角标", () => {
    for (const role of ["owner", "editor"] as const) {
      const caps = deriveNotePageCapabilities(role);
      expect(caps.canEdit).toBe(true);
      expect(caps.canModifyTags).toBe(true);
      expect(caps.isViewer).toBe(false);
    }
  });

  it("viewer 只读、不可改标签、显示只读角标", () => {
    const caps = deriveNotePageCapabilities("viewer");
    expect(caps.canEdit).toBe(false);
    expect(caps.canModifyTags).toBe(false);
    expect(caps.isViewer).toBe(true);
  });

  it("null（未判定）保持加载期可编辑的既有行为，不按 viewer 处理", () => {
    const caps = deriveNotePageCapabilities(null);
    expect(caps.canEdit).toBe(true);
    expect(caps.isViewer).toBe(false);
  });
});
