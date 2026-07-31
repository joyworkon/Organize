import { describe, it, expect } from "vitest";
import type { DatabaseProperty, DatabaseRow } from "@organize/shared";
import { evaluateFilter, applyFilters } from "./filters";
import type { DatabaseFilter } from "./types";

const schema: DatabaseProperty[] = [
  { id: "p_name", name: "名称", type: "text" },
  { id: "p_num", name: "数量", type: "number" },
  { id: "p_sel", name: "状态", type: "select", options: [
    { id: "opt_a", name: "进行中", color: "#3b82f6" },
    { id: "opt_b", name: "已完成", color: "#10b981" },
  ]},
  { id: "p_multi", name: "标签", type: "multi_select", options: [
    { id: "m1", name: "前端" },
    { id: "m2", name: "后端" },
  ]},
  { id: "p_check", name: "重要", type: "checkbox" },
  { id: "p_date", name: "日期", type: "date" },
  { id: "p_url", name: "链接", type: "url" },
];

function makeRow(id: string, values: Record<string, unknown>): DatabaseRow {
  return {
    id,
    user_id: "u1",
    database_id: "db1",
    sort: 0,
    values,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("evaluateFilter", () => {
  describe("is_empty / is_not_empty", () => {
    const f: DatabaseFilter = { id: "f1", propertyId: "p_name", operator: "is_empty" };
    it("null → empty", () => expect(evaluateFilter(null, f, schema[0])).toBe(true));
    it("undefined → empty", () => expect(evaluateFilter(undefined, f, schema[0])).toBe(true));
    it("'' → empty", () => expect(evaluateFilter("", f, schema[0])).toBe(true));
    it("[] → empty", () => expect(evaluateFilter([], f, schema[0])).toBe(true));
    it("'hello' → not empty", () => expect(evaluateFilter("hello", f, schema[0])).toBe(false));

    const fNot: DatabaseFilter = { id: "f2", propertyId: "p_name", operator: "is_not_empty" };
    it("is_not_empty: 'hello' → true", () => expect(evaluateFilter("hello", fNot, schema[0])).toBe(true));
    it("is_not_empty: null → false", () => expect(evaluateFilter(null, fNot, schema[0])).toBe(false));
  });

  describe("is / is_not (text)", () => {
    const f: DatabaseFilter = { id: "f1", propertyId: "p_name", operator: "is", value: "Hello" };
    it("case-insensitive match", () => expect(evaluateFilter("hello", f, schema[0])).toBe(true));
    it("mismatch", () => expect(evaluateFilter("world", f, schema[0])).toBe(false));

    const fNot: DatabaseFilter = { id: "f2", propertyId: "p_name", operator: "is_not", value: "Hello" };
    it("is_not: different → true", () => expect(evaluateFilter("world", fNot, schema[0])).toBe(true));
    it("is_not: same → false", () => expect(evaluateFilter("hello", fNot, schema[0])).toBe(false));
  });

  describe("contains / does_not_contain / starts_with / ends_with", () => {
    it("contains", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_name", operator: "contains", value: "ell" };
      expect(evaluateFilter("Hello World", f, schema[0])).toBe(true);
      expect(evaluateFilter("xyz", f, schema[0])).toBe(false);
    });
    it("does_not_contain", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_name", operator: "does_not_contain", value: "ell" };
      expect(evaluateFilter("xyz", f, schema[0])).toBe(true);
      expect(evaluateFilter("Hello", f, schema[0])).toBe(false);
    });
    it("starts_with", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_url", operator: "starts_with", value: "https" };
      expect(evaluateFilter("https://example.com", f, schema[6])).toBe(true);
      expect(evaluateFilter("http://example.com", f, schema[6])).toBe(false);
    });
    it("ends_with", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_url", operator: "ends_with", value: ".com" };
      expect(evaluateFilter("https://example.com", f, schema[6])).toBe(true);
      expect(evaluateFilter("https://example.org", f, schema[6])).toBe(false);
    });
  });

  describe("number operators", () => {
    const numProp = schema[1];
    it("equals", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_num", operator: "equals", value: 42 };
      expect(evaluateFilter(42, f, numProp)).toBe(true);
      expect(evaluateFilter(43, f, numProp)).toBe(false);
      expect(evaluateFilter(null, f, numProp)).toBe(false);
    });
    it("greater_than", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_num", operator: "greater_than", value: 10 };
      expect(evaluateFilter(15, f, numProp)).toBe(true);
      expect(evaluateFilter(5, f, numProp)).toBe(false);
      expect(evaluateFilter(10, f, numProp)).toBe(false);
    });
    it("less_equal", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_num", operator: "less_equal", value: 10 };
      expect(evaluateFilter(10, f, numProp)).toBe(true);
      expect(evaluateFilter(9, f, numProp)).toBe(true);
      expect(evaluateFilter(11, f, numProp)).toBe(false);
    });
  });

  describe("checkbox", () => {
    const checkProp = schema[4];
    it("checked", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_check", operator: "checked" };
      expect(evaluateFilter(true, f, checkProp)).toBe(true);
      expect(evaluateFilter(false, f, checkProp)).toBe(false);
      expect(evaluateFilter(null, f, checkProp)).toBe(false);
    });
    it("unchecked", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_check", operator: "unchecked" };
      expect(evaluateFilter(false, f, checkProp)).toBe(true);
      expect(evaluateFilter(null, f, checkProp)).toBe(true);
      expect(evaluateFilter(true, f, checkProp)).toBe(false);
    });
  });

  describe("multi_select includes / not_includes", () => {
    const multiProp = schema[3];
    it("includes", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_multi", operator: "includes", value: "m1" };
      expect(evaluateFilter(["m1", "m2"], f, multiProp)).toBe(true);
      expect(evaluateFilter(["m2"], f, multiProp)).toBe(false);
      expect(evaluateFilter(null, f, multiProp)).toBe(false);
    });
    it("not_includes", () => {
      const f: DatabaseFilter = { id: "f1", propertyId: "p_multi", operator: "not_includes", value: "m1" };
      expect(evaluateFilter(["m2"], f, multiProp)).toBe(true);
      expect(evaluateFilter(["m1"], f, multiProp)).toBe(false);
    });
  });
});

describe("applyFilters", () => {
  const rows: DatabaseRow[] = [
    makeRow("r1", { p_name: "Apple", p_num: 10, p_check: true }),
    makeRow("r2", { p_name: "Banana", p_num: 5, p_check: false }),
    makeRow("r3", { p_name: "Cherry", p_num: 20, p_check: true }),
    makeRow("r4", { p_name: "", p_num: null, p_check: false }),
  ];

  it("no filters → all rows", () => {
    expect(applyFilters(rows, [], schema)).toHaveLength(4);
  });

  it("single filter: contains 'an'", () => {
    const filters: DatabaseFilter[] = [
      { id: "f1", propertyId: "p_name", operator: "contains", value: "an" },
    ];
    const result = applyFilters(rows, filters, schema);
    expect(result.map((r) => r.id)).toEqual(["r2"]); // Banana
  });

  it("AND conjunction", () => {
    const filters: DatabaseFilter[] = [
      { id: "f1", propertyId: "p_num", operator: "greater_than", value: 8 },
      { id: "f2", propertyId: "p_check", operator: "checked" },
    ];
    const result = applyFilters(rows, filters, schema, "and");
    expect(result.map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("OR conjunction", () => {
    const filters: DatabaseFilter[] = [
      { id: "f1", propertyId: "p_name", operator: "is", value: "Apple" },
      { id: "f2", propertyId: "p_name", operator: "is", value: "Banana" },
    ];
    const result = applyFilters(rows, filters, schema, "or");
    expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("is_empty filter", () => {
    const filters: DatabaseFilter[] = [
      { id: "f1", propertyId: "p_name", operator: "is_empty" },
    ];
    const result = applyFilters(rows, filters, schema);
    expect(result.map((r) => r.id)).toEqual(["r4"]);
  });
});
