import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/023_note_page_structure.sql"),
  "utf8"
);

describe("note page structure migration", () => {
  it("adds persisted page metadata and a scoped parent index", () => {
    expect(sql).toContain("add column if not exists icon text");
    expect(sql).toContain("add column if not exists cover_url text");
    expect(sql).toContain("add column if not exists cover_position");
    expect(sql).toContain("add column if not exists parent_note_id");
    expect(sql).toContain("idx_notes_parent_note_id");
  });

  it("rejects cross-user parents and hierarchy cycles", () => {
    expect(sql).toContain("Parent note must belong to the same user");
    expect(sql).toContain("Note hierarchy cannot contain a cycle");
    expect(sql).toContain("validate_note_parent_trigger");
  });
});
