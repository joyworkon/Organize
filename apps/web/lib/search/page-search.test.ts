import { describe, expect, it } from "vitest";
import {
  filterByPageSearch,
  matchesPageSearch,
  normalizeSearchText,
  searchTokens,
} from "./page-search";

describe("page-search", () => {
  it("空查询不筛选，并返回原数组引用", () => {
    const items = [{ title: "a" }, { title: "b" }];
    expect(matchesPageSearch("", { title: "任意" })).toBe(true);
    expect(matchesPageSearch("   ", { title: "任意" })).toBe(true);
    expect(filterByPageSearch(items, "  ", (i) => ({ title: i.title }))).toBe(items);
  });

  it("命中标题（大小写不敏感）", () => {
    expect(matchesPageSearch("React", { title: "深入 react 渲染" })).toBe(true);
    expect(matchesPageSearch("vue", { title: "深入 react 渲染" })).toBe(false);
  });

  it("命中标签名（字符串与对象两种形态）", () => {
    expect(matchesPageSearch("设计", { title: "无标题", tags: ["设计系统"] })).toBe(true);
    expect(matchesPageSearch("设计", { title: "无标题", tags: [{ name: "设计系统" }] })).toBe(true);
    expect(matchesPageSearch("设计", { title: "无标题", tags: [null, { name: null }] })).toBe(false);
  });

  it("多关键词是 AND 关系，可跨字段命中", () => {
    const target = { title: "渲染性能笔记", tags: [{ name: "前端" }] };
    expect(matchesPageSearch("渲染 前端", target)).toBe(true);
    expect(matchesPageSearch("渲染 后端", target)).toBe(false);
  });

  it("附加字段（摘要/站点）参与匹配", () => {
    expect(
      matchesPageSearch("cubox", { title: "稍后读产品对比", extra: ["来自 Cubox 的实践"] })
    ).toBe(true);
  });

  it("normalize 与分词：折叠空白、去首尾", () => {
    expect(normalizeSearchText("  Hello   World ")).toBe("hello world");
    expect(searchTokens(" a  b ")).toEqual(["a", "b"]);
    expect(searchTokens("   ")).toEqual([]);
  });

  it("filterByPageSearch 按标题或标签筛选", () => {
    const rows = [
      { id: 1, title: "阅读清单", tags: [{ name: "输入" }] },
      { id: 2, title: "写作计划", tags: [{ name: "输出" }] },
    ];
    const hit = filterByPageSearch(rows, "输出", (r) => ({ title: r.title, tags: r.tags }));
    expect(hit.map((r) => r.id)).toEqual([2]);
  });
});
