import { describe, expect, it } from "vitest";
import {
  CALLOUT_ICON_OPTIONS,
  filterCalloutIcons,
  normalizeCalloutEmoji,
  normalizeCalloutTone,
} from "./callout-icons";

describe("filterCalloutIcons", () => {
  it("空查询返回全部内置图标", () => {
    expect(filterCalloutIcons("").length).toBe(CALLOUT_ICON_OPTIONS.length);
    expect(filterCalloutIcons("   ").length).toBe(CALLOUT_ICON_OPTIONS.length);
  });

  it("中文关键词过滤", () => {
    expect(filterCalloutIcons("警告").map((option) => option.emoji)).toContain("⚠️");
    expect(filterCalloutIcons("警告").every((option) => option.keywords.some((k) => k.includes("警告")) || option.emoji === "⚠️")).toBe(true);
  });

  it("英文关键词过滤（大小写不敏感）", () => {
    expect(filterCalloutIcons("DONE").map((option) => option.emoji)).toContain("✅");
    expect(filterCalloutIcons("book").map((option) => option.emoji)).toContain("📖");
  });

  it("按 emoji 字符本身过滤", () => {
    expect(filterCalloutIcons("🔥").map((option) => option.emoji)).toEqual(["🔥"]);
  });

  it("无匹配返回空数组", () => {
    expect(filterCalloutIcons("不存在的词")).toEqual([]);
  });
});

describe("normalizeCalloutTone", () => {
  it("合法值原样返回，非法值回 default", () => {
    expect(normalizeCalloutTone("info")).toBe("info");
    expect(normalizeCalloutTone("danger")).toBe("danger");
    expect(normalizeCalloutTone("neon")).toBe("default");
    expect(normalizeCalloutTone(null)).toBe("default");
    expect(normalizeCalloutTone(undefined)).toBe("default");
  });
});

describe("normalizeCalloutEmoji", () => {
  it("空串是合法的无图标状态", () => {
    expect(normalizeCalloutEmoji("")).toBe("");
    expect(normalizeCalloutEmoji("  ")).toBe("");
  });

  it("非字符串回默认图标，长复合 emoji 不丢失", () => {
    expect(normalizeCalloutEmoji(undefined)).toBe("💡");
    expect(normalizeCalloutEmoji(null)).toBe("💡");
    expect(normalizeCalloutEmoji("👨‍👩‍👧‍👦")).toBe("👨‍👩‍👧‍👦");
  });

  it("保留单个 emoji 与首尾空白", () => {
    expect(normalizeCalloutEmoji("⚠️")).toBe("⚠️");
    expect(normalizeCalloutEmoji(" ⭐ ")).toBe("⭐");
  });
});
