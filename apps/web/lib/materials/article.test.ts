import { describe, expect, it } from "vitest";
import { materialFingerprint, materialResultToArticle } from "./article";
import { isMaterialUrl, readingSourceLabel } from "@/lib/reading/source";

describe("阅读物料标识与正文", () => {
  it("相同物料重试指纹不变，内容或模式变化生成新指纹", async () => {
    const files = [new File(["原文"], "article.txt")];
    const input = { files, mode: "extract" as const };
    const first = await materialFingerprint(input);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await materialFingerprint(input)).toBe(first);
    expect(await materialFingerprint({ ...input, mode: "organize" })).not.toBe(first);
    expect(await materialFingerprint({ ...input, files: [new File(["修改后的内容"], "article.txt")] })).not.toBe(first);
  });
  it("导入标识显示为物料来源且不当成外部网页", () => {
    expect(isMaterialUrl("urn:organize:material:abc")).toBe(true);
    expect(readingSourceLabel("urn:organize:material:abc")).toBe("导入物料");
    expect(readingSourceLabel("https://www.example.com/a")).toBe("example.com");
    expect(isMaterialUrl("https://example.com")).toBe(false);
  });
  it("来源名和模型内容都转义，不生成外部请求或脚本标签", () => {
    const article = materialResultToArticle({ title: "标题", category: "学习", tags: ["学习"], blocks: [{ type: "table", rows: [["表头"], ["<iframe src=evil>"]] }] }, ["<img src=evil>.png"]);
    expect(article.content).not.toContain("<iframe");
    expect(article.content).not.toContain("<img");
    expect(article.tags).toEqual(["学习"]);
    expect(article.excerpt).toBe("标题");
  });
});
