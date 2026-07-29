import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/022_soft_delete_child_visibility.sql"
  ),
  "utf8"
);

describe("soft-deleted child visibility", () => {
  it.each([
    "note_comment_threads",
    "note_comments",
    "note_suggestions",
    "highlights",
    "favorites",
  ])("replaces the permissive %s policy", (table) => {
    expect(migration).toContain(`on public.${table}`);
    expect(migration).toContain("deleted_at is null");
  });

  it("checks favorite target ownership for every supported type", () => {
    expect(migration).toContain("when 'reading' then exists");
    expect(migration).toContain("when 'note' then exists");
    expect(migration).toContain("when 'task' then exists");
  });
});
