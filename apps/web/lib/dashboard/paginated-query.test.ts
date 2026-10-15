import { describe, expect, it } from "vitest";
import { fetchAllRows } from "@/lib/dashboard/paginated-query";

describe("fetchAllRows", () => {
  it("requests every page beyond the configured 1000-row server limit", async () => {
    const rows = Array.from({ length: 2105 }, (_, id) => ({ id }));
    const ranges: Array<[number, number]> = [];
    const query = {
      range: async (from: number, to: number) => {
        ranges.push([from, to]);
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    expect(await fetchAllRows(query)).toHaveLength(2105);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("propagates a later page failure instead of returning a partial total", async () => {
    const failure = new Error("page failed");
    const query = {
      range: async (from: number) => from === 0
        ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }
        : { data: null, error: failure },
    };
    await expect(fetchAllRows(query)).rejects.toBe(failure);
  });
});
