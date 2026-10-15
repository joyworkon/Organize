import { afterEach, describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { mockDb } from "./mock-data";

const originalTasks = mockDb.tasks;
afterEach(() => { mockDb.tasks = originalTasks; });

describe("mock date range filters", () => {
  it("keeps inclusive boundaries and excludes null or other dates", async () => {
    mockDb.tasks = [
      { id: "before", completed_at: "2026-10-14T23:59:59.999Z" },
      { id: "start", completed_at: "2026-10-15T00:00:00.000Z" },
      { id: "end", completed_at: "2026-10-15T23:59:59.999Z" },
      { id: "after", completed_at: "2026-10-16T00:00:00.000Z" },
      { id: "null", completed_at: null },
      { id: "missing" },
    ];
    const { data } = await createMockClient().from("tasks").select("*")
      .gte("completed_at", "2026-10-15T00:00:00.000Z")
      .lte("completed_at", "2026-10-15T23:59:59.999Z");
    expect(data.map((row: { id: string }) => row.id)).toEqual(["start", "end"]);
  });
});
