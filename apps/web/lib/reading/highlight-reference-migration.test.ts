import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/042_highlight_reference_links.sql"),
  "utf8"
);

describe("highlight reference migration", () => {
  it("adds stable note and task references", () => {
    expect(sql).toContain("add column if not exists note_id uuid");
    expect(sql).toContain("add column if not exists task_id uuid");
    expect(sql).toContain("validate_highlight_reference");
  });

  it("converts highlights atomically and preserves sources", () => {
    expect(sql).toContain("convert_highlight_reference");
    expect(sql).toContain("source_highlight.content");
    expect(sql).toContain("reading_item_id, note_id");
    expect(sql).toContain("for update");
  });

  it("exposes deleted or missing reference states", () => {
    expect(sql).toContain("get_highlight_reference_states");
    expect(sql).toContain("get_linked_content_states");
    expect(sql).toContain("then 'deleted'");
    expect(sql).toContain("then 'missing'");
  });

  it("restores remapped references after the base restore", () => {
    expect(sql).toContain("restore_backup_v2_with_highlight_references");
    expect(sql).toContain("restore_backup_v2_with_dependencies");
    expect(sql).toContain("note_id = nullif");
    expect(sql).toContain("task_id = nullif");
  });
});
