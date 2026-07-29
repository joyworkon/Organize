import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/021_soft_delete.sql"),
  "utf8"
);

describe("soft delete migration contract", () => {
  it.each(["notes", "reading_items", "tasks", "lessons"])(
    "adds deleted_at and hides deleted %s rows by policy",
    (table) => {
      expect(migration).toMatch(
        new RegExp(`alter table public\\.${table}[\\s\\S]*?deleted_at timestamptz`)
      );
      expect(migration).toMatch(
        new RegExp(
          `create policy "Users can view own [^"]+" on public\\.${table}\\s+for select using \\(auth\\.uid\\(\\) = user_id and deleted_at is null\\)`
        )
      );
      expect(migration).toContain(
        `revoke delete on table public.${table} from anon, authenticated`
      );
    }
  );

  it("keeps deleted resources out of public shares and normal backups", () => {
    expect(migration).toContain("and n.deleted_at is null");
    expect(migration).toContain("and r.deleted_at is null");
    expect(migration).toContain("security definer");
  });
});
