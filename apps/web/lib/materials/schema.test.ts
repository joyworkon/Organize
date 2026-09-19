import { describe, expect, it } from "vitest";
import { materialKind, parseMaterialResult, validateMaterialRequest, validateMaterialResult } from "./schema";
import { materialResultToArticle } from "./article";

const result = { title: "会议记录", category: "会议", tags: ["项目"], blocks: [{ type: "paragraph", text: "原文" }] };

describe("material boundaries", () => {
  it("accepts extension fallback but rejects unsupported and oversized material before requesting AI", () => {
    expect(materialKind(new File(["abc"], "note.MD"))).toBe("text");
    expect(() => validateMaterialRequest({ files: [new File(["abc"], "test.pdf")], mode: "organize" })).toThrow("暂不支持");
    expect(() => validateMaterialRequest({ files: Array.from({ length: 7 }, () => new File(["x"], "a.txt")), mode: "extract" })).toThrow("6");
    expect(() => validateMaterialRequest({ files: [new File([new Uint8Array(9 * 1024 * 1024)], "a.png")], mode: "extract" })).toThrow("8MB");
    expect(() => validateMaterialRequest({ files: [], text: "x".repeat(40_001), mode: "organize" })).toThrow("4 万");
    expect(() => validateMaterialRequest({ files: [], text: " ", mode: "organize" })).toThrow("添加");
  });

  it("accepts fenced JSON and strips arbitrary model attributes", () => {
    expect(parseMaterialResult(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``)).toEqual(result);
    expect(validateMaterialResult({ ...result, attrs: { onClick: "evil" }, blocks: [{ type: "paragraph", text: "safe", attrs: { id: "existing" } }] }).blocks).toEqual([{ type: "paragraph", text: "safe" }]);
  });

  it("rejects truncation, arbitrary editor nodes and malformed tables instead of inserting partial output", () => {
    expect(() => parseMaterialResult('{"title":')).toThrow("完整");
    expect(() => validateMaterialResult({ ...result, blocks: [{ type: "htmlEmbed", html: "<script>evil</script>" }] })).toThrow();
    expect(() => validateMaterialResult({ ...result, blocks: [{ type: "table", rows: [["A", "B"], ["C"]] }] })).toThrow();
    expect(() => validateMaterialResult({ ...result, blocks: [] })).toThrow();
  });

  it("preserves literal source text and makes editable lists, tasks and tables without executable content", () => {
    const article = materialResultToArticle(validateMaterialResult({ ...result, blocks: [
      { type: "paragraph", text: '<img src=x onerror="alert(1)">' },
      { type: "taskList", items: ["跟进项目"] },
      { type: "table", rows: [["事项", "金额"], ["采购", "100"]] },
    ] }), ["会议.txt"]);
    expect(article.content).toContain("&lt;img");
    expect(article.content).not.toContain("<img");
    expect(article.content).toContain("<li>☐ 跟进项目</li>");
    expect(article.content).toContain("<th>事项</th>");
    expect(article.content).toContain("会议.txt");
    expect(article.tags).toEqual(["会议", "项目"]);
  });
});
