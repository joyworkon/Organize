import { describe, expect, it } from "vitest";
import { CALLOUT_ICON_OPTIONS } from "./callout-icons";
import { EMOJI_CATALOG, EMOJI_SUGGEST_LIMIT, findEmojiByShortcode, searchEmoji } from "./emoji-catalog";

describe("emoji catalog（数据层）", () => {
  it("keeps the 24 callout icon options as an exact subset", () => {
    for (const callout of CALLOUT_ICON_OPTIONS) {
      const hit = EMOJI_CATALOG.find((option) => option.emoji === callout.emoji);
      expect(hit, `catalog missing ${callout.emoji}`).toBeTruthy();
      expect(hit!.keywords).toEqual(callout.keywords);
    }
    expect(CALLOUT_ICON_OPTIONS).toHaveLength(24);
  });

  it("has 150–300 entries, each with a unique primary shortcode and at least one keyword", () => {
    expect(EMOJI_CATALOG.length).toBeGreaterThanOrEqual(150);
    expect(EMOJI_CATALOG.length).toBeLessThanOrEqual(300);
    const primaries = EMOJI_CATALOG.map((option) => option.keywords[0]);
    expect(new Set(primaries).size).toBe(primaries.length);
    for (const option of EMOJI_CATALOG) {
      expect(option.emoji.length).toBeGreaterThan(0);
      expect(option.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("searchEmoji（匹配排序）", () => {
  it("ranks keyword prefix matches before substring matches", () => {
    const result = searchEmoji("ear", [], 50); // 放大上限避免截断，专看排序
    expect(result[0].emoji).toBe("🌍"); // earth_africa 前缀命中
    const heartIndex = result.findIndex((option) => option.emoji === "❤️"); // heart 仅子串命中
    const bearIndex = result.findIndex((option) => option.emoji === "🐻"); // bear 仅子串命中
    expect(heartIndex).toBeGreaterThan(0);
    expect(bearIndex).toBeGreaterThan(0);
  });

  it("matches Chinese keywords and keeps catalog order within the same rank", () => {
    expect(searchEmoji("火箭")[0].emoji).toBe("🚀");
    expect(searchEmoji("火")[0].emoji).toBe("🔥");
    expect(searchEmoji("赞").map((option) => option.emoji)).toContain("👍");
  });

  it("matches English keywords case-insensitively", () => {
    expect(searchEmoji("FIRE")[0].emoji).toBe("🔥");
    expect(searchEmoji("Rocket")[0].emoji).toBe("🚀");
  });

  it("boosts matching recent emojis only for single-character queries", () => {
    expect(searchEmoji("喜", ["❤️"])[0].emoji).toBe("❤️");
    expect(searchEmoji("喜")[0].emoji).toBe("😍");
    // 多字符查询不提升最近使用：😍 在表内先于 ❤️
    expect(searchEmoji("喜欢", ["❤️"])[0].emoji).toBe("😍");
    // 最近使用但不匹配当前查询时不出现
    expect(searchEmoji("rocket", ["❤️"])[0].emoji).toBe("🚀");
  });

  it("caps results at the suggest limit and handles empty queries", () => {
    expect(searchEmoji("o")).toHaveLength(EMOJI_SUGGEST_LIMIT);
    expect(searchEmoji("o", [], 3)).toHaveLength(3);
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("zzzzzz")).toEqual([]);
  });
});

describe("findEmojiByShortcode（:fire: 精确短码）", () => {
  it("matches any keyword exactly, case-insensitively", () => {
    expect(findEmojiByShortcode("fire")?.emoji).toBe("🔥");
    expect(findEmojiByShortcode("FIRE")?.emoji).toBe("🔥");
    expect(findEmojiByShortcode("hot")?.emoji).toBe("🔥");
    expect(findEmojiByShortcode("火")?.emoji).toBe("🔥");
    expect(findEmojiByShortcode("火箭")?.emoji).toBe("🚀");
    expect(findEmojiByShortcode("点赞")?.emoji).toBe("👍");
  });

  it("rejects partial or unknown shortcodes", () => {
    expect(findEmojiByShortcode("fir")).toBeNull();
    expect(findEmojiByShortcode("fires")).toBeNull();
    expect(findEmojiByShortcode("nonexistent")).toBeNull();
    expect(findEmojiByShortcode("")).toBeNull();
    expect(findEmojiByShortcode("  ")).toBeNull();
  });
});
