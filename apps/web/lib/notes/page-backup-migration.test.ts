import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/024_note_page_backup_restore.sql"
  ),
  "utf8"
);

describe("note page metadata backup restore", () => {
  it("wraps the existing restore and applies metadata in the same transaction", () => {
    expect(sql).toContain("restore_backup_v2_with_pages");
    expect(sql).toContain("restore_result := public.restore_backup_v2(p_payload)");
    expect(sql).toContain("parent_note_id = page.parent_note_id");
    expect(sql).toContain("cover_position = coalesce(page.cover_position, 50)");
  });

  it("keeps the RPC private to authenticated users", () => {
    expect(sql).toContain(
      "revoke all on function public.restore_backup_v2_with_pages(jsonb) from public"
    );
    expect(sql).toContain(
      "grant execute on function public.restore_backup_v2_with_pages(jsonb) to authenticated"
    );
  });
});
