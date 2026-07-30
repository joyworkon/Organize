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

const sql025 = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/025_note_page_settings.sql"
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

describe("migration 025: note page display settings", () => {
  it("adds full_width / font_family / small_font columns with defaults and check constraints", () => {
    expect(sql025).toContain("add column if not exists full_width boolean not null default false");
    expect(sql025).toContain("add column if not exists font_family text not null default 'default'");
    expect(sql025).toContain("check (font_family in ('default', 'serif', 'mono'))");
    expect(sql025).toContain("add column if not exists small_font boolean not null default false");
  });

  it("rewrites restore_backup_v2 to insert the new columns with coalesce defaults for legacy backups", () => {
    expect(sql025).toContain("create or replace function public.restore_backup_v2");
    expect(sql025).toContain("full_width, font_family, small_font");
    expect(sql025).toContain("coalesce(row.full_width, false)");
    expect(sql025).toContain("case when row.font_family in ('default', 'serif', 'mono') then row.font_family else 'default' end");
    expect(sql025).toContain("coalesce(row.small_font, false)");
  });

  it("keeps the restore RPC private to authenticated users", () => {
    expect(sql025).toContain(
      "revoke all on function public.restore_backup_v2(jsonb) from public"
    );
    expect(sql025).toContain(
      "grant execute on function public.restore_backup_v2(jsonb) to authenticated"
    );
  });
});
