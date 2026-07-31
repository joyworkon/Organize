import { describe, it, expect } from "vitest";
import type { DatabaseProperty, DatabaseRow } from "@organize/shared";
import { groupBySelectProperty, UNGROUPED_KEY } from "./grouping";

const schema: DatabaseProperty[] = [
  { id: "p_name", name: "名称", type: "text" },
  { id: "p_status", name: "状态", type: "select", options: [
    { id: "opt_todo", name: "待办", color: "#f59e0b" },
    { id: "opt_done", name: "完成", color: "#10b981" },
  ]},
  { id: "p_tags", name: "标签", type: "multi_select", options: [
    { id: "t1", name: "前端" },
    { id: "t2", name: "后端" },
  ]},
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

describe("groupBySelectProperty", () => {
  const rows = [
    makeRow("r1", { p_status: "opt_todo" }),
    makeRow("r2", { p_status: "opt_done" }),
    makeRow("r3", { p_status: "opt_todo" }),
    makeRow("r4", { p_status: null }),
    makeRow("r5", { p_status: "deleted_opt" }), // 已删除的选项
  ];

  it("groups by select option", () => {
    const groups = groupBySelectProperty(rows, "p_status", schema);
    expect(groups).toHaveLength(3); // opt_todo, opt_done, ungrouped
    expect(groups[0].key).toBe("opt_todo");
    expect(groups[0].label).toBe("待办");
    expect(groups[0].color).toBe("#f59e0b");
    expect(groups[0].rows.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(groups[1].key).toBe("opt_done");
    expect(groups[1].rows.map((r) => r.id)).toEqual(["r2"]);
    expect(groups[2].key).toBe(UNGROUPED_KEY);
    expect(groups[2].rows.map((r) => r.id)).toEqual(["r4", "r5"]);
  });

  it("non-select property → single group", () => {
    const groups = groupBySelectProperty(rows, "p_name", schema);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(UNGROUPED_KEY);
    expect(groups[0].rows).toHaveLength(5);
  });

  it("multi_select: row appears in multiple groups", () => {
    const multiRows = [
      makeRow("r1", { p_tags: ["t1", "t2"] }),
      makeRow("r2", { p_tags: ["t1"] }),
      makeRow("r3", { p_tags: [] }),
    ];
    const groups = groupBySelectProperty(multiRows, "p_tags", schema);
    const t1Group = groups.find((g) => g.key === "t1");
    const t2Group = groups.find((g) => g.key === "t2");
    const ungrouped = groups.find((g) => g.key === UNGROUPED_KEY);
    expect(t1Group?.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(t2Group?.rows.map((r) => r.id)).toEqual(["r1"]);
    expect(ungrouped?.rows.map((r) => r.id)).toEqual(["r3"]);
  });

  it("empty options → only ungrouped", () => {
    const noOptSchema: DatabaseProperty[] = [
      { id: "p_sel", name: "空", type: "select", options: [] },
    ];
    const groups = groupBySelectProperty(
      [makeRow("r1", { p_sel: "x" })],
      "p_sel",
      noOptSchema
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(UNGROUPED_KEY);
  });
});
