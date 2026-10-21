import { afterEach, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { mockDb } from "./mock-data";
const original = mockDb.notes;
afterEach(() => { mockDb.notes = original; });
it("filters before limiting, matches titles case-insensitively, and treats escaped wildcards literally", async () => {
  mockDb.notes = [
    { id: "other", title: "other" }, { id: "meeting", title: "会议 ABC" },
    { id: "literal", title: "100%_done" }, { id: "wild", title: "100XYdone" },
  ];
  const client = createMockClient();
  expect((await client.from("notes").select().ilike("title", "%会议 ab%").limit(1)).data.map((row: { id: string }) => row.id)).toEqual(["meeting"]);
  expect((await client.from("notes").select().ilike("title", "%100\\%\\_done%")).data.map((row: { id: string }) => row.id)).toEqual(["literal"]);
});
