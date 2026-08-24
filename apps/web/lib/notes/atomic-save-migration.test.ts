import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/038_note_atomic_save_metadata.sql"),
  "utf8"
);

describe("migration 038: atomic note save metadata", () => {
  it("extends the revision-checked RPC with a complete note snapshot", () => {
    expect(sql).toContain("p_expected_note_revision integer");
    expect(sql).toContain("p_note_snapshot jsonb default null");
    expect(sql).toContain("if v_cur_rev <> p_expected_note_revision");
    expect(sql).toContain("'status', 'conflict_note'");
    expect(sql).toContain("content_revision = v_cur_rev + 1");
  });

  it("writes all mutable page metadata inside the same transaction", () => {
    for (const column of [
      "icon",
      "cover_url",
      "cover_position",
      "parent_note_id",
      "full_width",
      "font_family",
      "small_font",
    ]) {
      expect(sql).toContain(`p_note_snapshot ? '${column}'`);
    }
  });

  it("keeps the expanded RPC private to authenticated users", () => {
    expect(sql).toContain("from public;");
    expect(sql).toContain("to authenticated;");
  });
});
