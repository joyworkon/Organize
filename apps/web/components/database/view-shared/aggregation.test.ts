import { describe, it, expect } from "vitest";
import type { DatabaseProperty, DatabaseRow } from "@organize/shared";
import { aggregate, UNGROUPED_KEY } from "./aggregation";

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
  { id: "p_active", name: "启用", type: "checkbox" },
  { id: "p_amt", name: "金额", type: "number" },
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

describe("aggregate", () => {
  it("count: 按 select 分组统计行数", () => {
    const rows = [
      makeRow("r1", { p_status: "opt_todo" }),
      makeRow("r2", { p_status: "opt_done" }),
      makeRow("r3", { p_status: "opt_todo" }),
    ];
    const res = aggregate(rows, { groupByPropId: "p_status", metric: "count" }, schema);
    // 待办 2 行 > 完成 1 行（倒序）
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ key: "opt_todo", label: "待办", value: 2 });
    expect(res[1]).toMatchObject({ key: "opt_done", label: "完成", value: 1 });
    expect(res[0].color).toBe("#f59e0b");
  });

  it("sum: 按 select 分组对数值属性求和", () => {
    const rows = [
      makeRow("r1", { p_status: "opt_todo", p_amt: 10 }),
      makeRow("r2", { p_status: "opt_todo", p_amt: 5 }),
      makeRow("r3", { p_status: "opt_done", p_amt: 100 }),
    ];
    const res = aggregate(
      rows,
      { groupByPropId: "p_status", metric: "sum", valuePropId: "p_amt" },
      schema
    );
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ key: "opt_done", value: 100 });
    expect(res[1]).toMatchObject({ key: "opt_todo", value: 15 });
  });

  it("avg: 跳过非数值行，分母为该组有数值的行数", () => {
    const rows = [
      makeRow("r1", { p_status: "opt_todo", p_amt: 10 }),
      makeRow("r2", { p_status: "opt_todo", p_amt: "不是数字" }), // 非数值，跳过
      makeRow("r3", { p_status: "opt_todo", p_amt: 30 }),
    ];
    const res = aggregate(
      rows,
      { groupByPropId: "p_status", metric: "avg", valuePropId: "p_amt" },
      schema
    );
    // 分母 = 2（r1, r3），不是 3
    expect(res).toHaveLength(1);
    expect(res[0].value).toBe(20);
  });

  it("avg: 全组无有效数值时值为 0（不产生 NaN）", () => {
    const rows = [makeRow("r1", { p_status: "opt_todo", p_amt: "x" })];
    const res = aggregate(
      rows,
      { groupByPropId: "p_status", metric: "avg", valuePropId: "p_amt" },
      schema
    );
    expect(res[0].value).toBe(0);
  });

  it("multi_select: 一行可进入多个分组", () => {
    const rows = [
      makeRow("r1", { p_tags: ["t1", "t2"] }), // 同时进 t1、t2
      makeRow("r2", { p_tags: ["t1"] }),
    ];
    const res = aggregate(rows, { groupByPropId: "p_tags", metric: "count" }, schema);
    const t1 = res.find((g) => g.key === "t1");
    const t2 = res.find((g) => g.key === "t2");
    expect(t1?.value).toBe(2); // r1 + r2
    expect(t2?.value).toBe(1); // r1
  });

  it("checkbox: 分 true / false 两组", () => {
    const rows = [
      makeRow("r1", { p_active: true }),
      makeRow("r2", { p_active: false }),
      makeRow("r3", { p_active: true }),
    ];
    const res = aggregate(rows, { groupByPropId: "p_active", metric: "count" }, schema);
    expect(res).toHaveLength(2);
    // true 组 2 行 > false 组 1 行（倒序）
    expect(res[0]).toMatchObject({ key: "true", value: 2 });
    expect(res[1]).toMatchObject({ key: "false", value: 1 });
  });

  it("缺值行归入 __ungrouped__（label「未分组」）", () => {
    const rows = [
      makeRow("r1", { p_status: "opt_todo" }),
      makeRow("r2", { p_status: null }), // 缺值
      makeRow("r3", {}), // 没这个属性
    ];
    const res = aggregate(rows, { groupByPropId: "p_status", metric: "count" }, schema);
    const ungrouped = res.find((g) => g.key === UNGROUPED_KEY);
    expect(ungrouped?.label).toBe("未分组");
    expect(ungrouped?.value).toBe(2);
  });

  it("结果按 value 倒序稳定排（相等时保持插入顺序）", () => {
    // 三个文本值各 1 行（value 都 = 1），插入顺序 b, a, c
    const rows = [
      makeRow("r1", { p_name: "b" }),
      makeRow("r2", { p_name: "a" }),
      makeRow("r3", { p_name: "c" }),
    ];
    const res = aggregate(rows, { groupByPropId: "p_name", metric: "count" }, schema);
    expect(res.map((g) => g.key)).toEqual(["b", "a", "c"]); // value 相等，保持插入顺序
  });

  it("空行数组 → 空结果", () => {
    const res = aggregate([], { groupByPropId: "p_status", metric: "count" }, schema);
    expect(res).toEqual([]);
  });
});
