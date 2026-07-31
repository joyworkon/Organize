import { describe, expect, it } from "vitest";
import { DEFAULT_MERMAID_CODE, looksLikeMermaid } from "./mermaid";

describe("looksLikeMermaid", () => {
  it("识别常见 mermaid 图表类型", () => {
    expect(looksLikeMermaid("graph TD\nA-->B")).toBe(true);
    expect(looksLikeMermaid("flowchart LR\nA-->B")).toBe(true);
    expect(looksLikeMermaid("sequenceDiagram\nA->>B: hi")).toBe(true);
    expect(looksLikeMermaid("pie\n\"a\": 1")).toBe(true);
    expect(looksLikeMermaid("gantt\ntitle s")).toBe(true);
    expect(looksLikeMermaid("stateDiagram-v2")).toBe(true);
  });
  it("拒绝空内容与无关文本", () => {
    expect(looksLikeMermaid("")).toBe(false);
    expect(looksLikeMermaid("   ")).toBe(false);
    expect(looksLikeMermaid("这是一段普通文字")).toBe(false);
    expect(looksLikeMermaid("console.log(1)")).toBe(false);
  });
});

describe("DEFAULT_MERMAID_CODE", () => {
  it("默认代码是合法 mermaid", () => {
    expect(looksLikeMermaid(DEFAULT_MERMAID_CODE)).toBe(true);
  });
});
