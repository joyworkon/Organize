import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/019_reading_lifecycle.sql"),
  "utf8"
);

describe("reading lifecycle migration contract", () => {
  it("adds nullable lifecycle timestamps without a legacy backfill", () => {
    expect(migration).toContain("started_reading_at timestamptz");
    expect(migration).toContain("completed_reading_at timestamptz");
    expect(migration).not.toMatch(
      /update\s+public\.reading_items[\s\S]*started_reading_at\s*=/i
    );
    expect(migration).not.toContain("updated_at");
  });

  it("only fills timestamps on a real status transition", () => {
    expect(migration).toContain(
      "old.reading_status is distinct from new.reading_status"
    );
    expect(migration).toContain(
      "new.reading_status in ('reading', 'read')"
    );
    expect(migration).toContain("new.reading_status = 'read'");
    expect(migration).toContain(
      "new.started_reading_at := old.started_reading_at"
    );
    expect(migration).toContain(
      "new.completed_reading_at := old.completed_reading_at"
    );
  });
});
