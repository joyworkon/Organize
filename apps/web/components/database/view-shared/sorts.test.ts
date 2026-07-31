import { describe, it, expect } from "vitest";
import type { DatabaseProperty, DatabaseRow } from "@organize/shared";
import { applySorts } from "./sorts";
import type { DatabaseSort } from "./types";

const schema: DatabaseProperty[] = [
  { id: "p_name", name: "名称", type: "text" },
  { id: "p_num", name: "数量", type: "number" },
  { id: "p_check", name: "重要", type: "checkbox" },
  { id: "p_date", name: "日期", type: "date" },
  { id: "p_multi", name: "标签", type: "multi_select", options: [
    { id: "m1", name: "Alpha" },
    { id: "m2", name: "Beta" },
  ]},
];

function makeRow(id: string, values: Record<string, unknown>, sort = 0): DatabaseRow {
  return {
    id,
    user_id: "u1",
    database_id: "db1",
    sort,
    values,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("applySorts", () => {
  it("no sorts → original order", () => {
    const rows = [makeRow("r1", {}), makeRow("r2", {}), makeRow("r3", {})];
    const result = applySorts(rows, [], schema);
    expect(result.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("does not mutate original array", () => {
    const rows = [makeRow("r2", { p_num: 2 }), makeRow("r1", { p_num: 1 })];
    const original = [...rows];
    applySorts(rows, [{ id: "s1", propertyId: "p_num", direction: "asc" }], schema);
    expect(rows).toEqual(original);
  });

  describe("number sort", () => {
    const rows = [
      makeRow("r1", { p_num: 30 }),
      makeRow("r2", { p_num: 10 }),
      makeRow("r3", { p_num: 20 }),
      makeRow("r4", { p_num: null }),
    ];

    it("asc: null goes last", () => {
      const sorts: DatabaseSort[] = [{ id: "s1", propertyId: "p_num", direction: "asc" }];
      const result = applySorts(rows, sorts, schema);
      expect(result.map((r) => r.id)).toEqual(["r2", "r3", "r1", "r4"]);
    });

    it("desc: null still goes last", () => {
      const sorts: DatabaseSort[] = [{ id: "s1", propertyId: "p_num", direction: "desc" }];
      const result = applySorts(rows, sorts, schema);
      expect(result.map((r) => r.id)).toEqual(["r1", "r3", "r2", "r4"]);
    });
  });

  describe("text sort (zh-CN locale)", () => {
    const rows = [
      makeRow("r1", { p_name: "Banana" }),
      makeRow("r2", { p_name: "apple" }),
      makeRow("r3", { p_name: "Cherry" }),
      makeRow("r4", { p_name: "" }),
    ];

    it("asc", () => {
      const sorts: DatabaseSort[] = [{ id: "s1", propertyId: "p_name", direction: "asc" }];
      const result = applySorts(rows, sorts, schema);
      expect(result.map((r) => r.id)).toEqual(["r2", "r1", "r3", "r4"]);
    });
  });

  describe("checkbox sort", () => {
    const rows = [
      makeRow("r1", { p_check: true }),
      makeRow("r2", { p_check: false }),
      makeRow("r3", { p_check: true }),
    ];

    it("asc: false before true", () => {
      const sorts: DatabaseSort[] = [{ id: "s1", propertyId: "p_check", direction: "asc" }];
      const result = applySorts(rows, sorts, schema);
      expect(result.map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
    });
  });

  describe("date sort", () => {
    const rows = [
      makeRow("r1", { p_date: "2026-03-15" }),
      makeRow("r2", { p_date: "2026-01-01" }),
      makeRow("r3", { p_date: "2026-02-10" }),
    ];

    it("asc", () => {
      const sorts: DatabaseSort[] = [{ id: "s1", propertyId: "p_date", direction: "asc" }];
      const result = applySorts(rows, sorts, schema);
      expect(result.map((r) => r.id)).toEqual(["r2", "r3", "r1"]);
    });
  });

  describe("multi-level sort", () => {
    const rows = [
      makeRow("r1", { p_check: true, p_num: 20 }),
      makeRow("r2", { p_check: false, p_num: 10 }),
      makeRow("r3", { p_check: true, p_num: 5 }),
      makeRow("r4", { p_check: false, p_num: 30 }),
    ];

    it("checkbox asc then number asc", () => {
      const sorts: DatabaseSort[] = [
        { id: "s1", propertyId: "p_check", direction: "asc" },
        { id: "s2", propertyId: "p_num", direction: "asc" },
      ];
      const result = applySorts(rows, sorts, schema);
      // false first: r2(10), r4(30); then true: r3(5), r1(20)
      expect(result.map((r) => r.id)).toEqual(["r2", "r4", "r3", "r1"]);
    });
  });
});
