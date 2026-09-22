import { describe, expect, it } from "vitest";
import { textToMaterialResult } from "./text-material";
import { MAX_MATERIAL_TEXT } from "./schema";

describe("textToMaterialResult 确定性切块", () => {
  it("空文本明确报错", () => {
    expect(() => textToMaterialResult("")).toThrow("内容为空");
    expect(() => textToMaterialResult("  \n ")).toThrow("内容为空");
  });

  it("超 4 万字符明确报错提示分段保存，不截断", () => {
    const over = "字".repeat(MAX_MATERIAL_TEXT + 1);
    expect(() => textToMaterialResult(over)).toThrow(/4 万字符/);
  });

  it("标题取首个非空行（剥 markdown 标题符，≤120 字）", () => {
    const result = textToMaterialResult("# 我的长文标题\n\n第一段。\n\n第二段。");
    expect(result.title).toBe("我的长文标题");
    expect(result.category).toBe("长文本");
    expect(result.tags).toEqual([]);
    expect(result.blocks).toEqual([
      { type: "heading", text: "我的长文标题" },
      { type: "paragraph", text: "第一段。" },
      { type: "paragraph", text: "第二段。" },
    ]);
  });

  it("无标题时标题取首行，正文按段落切块", () => {
    const result = textToMaterialResult("第一行就是标题感\n\n正文段落一。\n\n正文段落二。");
    expect(result.title).toBe("第一行就是标题感");
    expect(result.blocks.filter((b) => b.type === "paragraph")).toHaveLength(3);
  });

  it("无序/有序列表行归为列表块", () => {
    const result = textToMaterialResult("开头说明\n\n- 甲\n- 乙\n\n1. 第一步\n2. 第二步");
    expect(result.blocks).toContainEqual({ type: "bulletList", items: ["甲", "乙"] });
    expect(result.blocks).toContainEqual({ type: "orderedList", items: ["第一步", "第二步"] });
  });

  it("列表与文字混排在同段时按段落处理（不强行归列表）", () => {
    const result = textToMaterialResult("- 甲\n中间一句话\n- 乙");
    expect(result.blocks.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("超长段落按 12000 字符切块（物料 schema 单块上限）", () => {
    const long = "长".repeat(12_500);
    const result = textToMaterialResult(`${long}\n\n结尾。`);
    const chunks = result.blocks.filter((b) => b.type === "paragraph");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((b) => "text" in b && b.text.length <= 12_000)).toBe(true);
    expect(result.blocks[result.blocks.length - 1]).toEqual({ type: "paragraph", text: "结尾。" });
  });

  it("HTML 特殊字符原样保留（由 materialResultToArticle 统一转义）", () => {
    const result = textToMaterialResult("含有 <b>标签</b> 与 & 符号");
    expect(result.blocks[0]).toEqual({ type: "paragraph", text: "含有 <b>标签</b> 与 & 符号" });
  });

  it("块数超 200 明确报错（物料 schema 上限）", () => {
    const text = Array.from({ length: 201 }, (_, i) => `段落 ${i}`).join("\n\n");
    expect(() => textToMaterialResult(text)).toThrow(/分段保存/);
  });

  it("5000 边界文本（速记装不下、物料可容纳）不截断", () => {
    const text = `标题\n\n${"字".repeat(5001)}`;
    const result = textToMaterialResult(text);
    const body = result.blocks.filter((b) => b.type === "paragraph" && "text" in b && b.text.length > 1000);
    expect(body).toHaveLength(1);
    expect((body[0] as { text: string }).text).toBe("字".repeat(5001));
  });
});
