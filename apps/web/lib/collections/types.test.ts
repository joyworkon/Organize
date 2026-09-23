import { describe, expect, it } from "vitest";
import {
  suggestCollections,
  tokenizeForSuggest,
  validateCollectionName,
} from "./types";

// 阶段 3：自动主题建议（确定性启发式 + 用户确认制）与集合名校验。
describe("suggestCollections", () => {
  const collections = [
    { id: "c1", name: "产品发布" },
    { id: "c2", name: "技术调研" },
    { id: "c3", name: "xiaomi launch" },
    { id: "c4", name: "随手记" },
  ];

  it("标题词元与集合名重合 → 命中（重合度排序）", () => {
    const hits = suggestCollections(collections, { title: "Xiaomi Launch 计划书" });
    expect(hits[0]).toBe("c3");
  });

  it("速记标签直接匹配集合名", () => {
    expect(suggestCollections(collections, { tags: ["产品发布"] })).toEqual(["c1"]);
  });

  it("无重合 → 空建议（绝不让用户在无关项里挑）", () => {
    expect(suggestCollections(collections, { title: "完全无关的标题" })).toEqual([]);
  });

  it("空标题/空标签 → 空", () => {
    expect(suggestCollections(collections, {})).toEqual([]);
    expect(suggestCollections(collections, { title: "" })).toEqual([]);
  });

  it("limit 截断建议数量", () => {
    const many = [
      { id: "a", name: "发布会" },
      { id: "b", name: "发布会" },
      { id: "c", name: "发布会" },
      { id: "d", name: "发布会" },
    ];
    expect(suggestCollections(many, { title: "发布会筹备" }, 2)).toHaveLength(2);
  });

  it("tokenize：单字与标点被过滤，英文小写化", () => {
    expect(tokenizeForSuggest("Mi, Launch！发布会")).toEqual(["mi", "launch", "发布会"]);
  });
});

describe("validateCollectionName", () => {
  it("空名/超长拒绝，前后空白修剪后返回 null（合法）", () => {
    expect(validateCollectionName("")).toContain("不能为空");
    expect(validateCollectionName("   ")).toContain("不能为空");
    expect(validateCollectionName("x".repeat(81))).toContain("80");
    expect(validateCollectionName("  产品发布 ")).toBeNull();
  });
});
