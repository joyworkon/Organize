import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/044_reading_full_width.sql"),
  "utf8"
);

describe("migration 044: reading item full width", () => {
  it("adds full_width column with a default for existing rows", () => {
    expect(sql).toContain("alter table reading_items");
    expect(sql).toContain(
      "add column if not exists full_width boolean not null default false"
    );
  });

  it("rewrites restore_backup_v2 to insert full_width with coalesce default for legacy backups", () => {
    expect(sql).toContain("create or replace function public.restore_backup_v2");
    expect(sql).toContain("reading_progress, is_pinned, full_width, started_reading_at");
    expect(sql).toContain("coalesce(row.full_width, false)");
    expect(sql).toContain("full_width boolean,");
  });

  it("keeps the restore RPC private to authenticated users", () => {
    expect(sql).toContain(
      "revoke all on function public.restore_backup_v2(jsonb) from public"
    );
    expect(sql).toContain(
      "grant execute on function public.restore_backup_v2(jsonb) to authenticated"
    );
  });
});
