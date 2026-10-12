import { describe, expect, it } from "vitest";
import { aiResultToBlocks } from "./result-blocks";

describe("aiResultToBlocks", () => {
  it("Markdown 标题、加粗、列表转成正式节点，不留原始符号", () => {
    const blocks = aiResultToBlocks("## 间隔重复\n\n**定义**：一种学习方法。\n\n- 要点一\n- 要点二");
    expect(blocks[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(JSON.stringify(blocks)).not.toContain("**");
    expect(JSON.stringify(blocks)).toContain('"bold"');
    expect(blocks.some((b) => b.type === "bulletList")).toBe(true);
  });

  it("纯文本保持为段落；空结果返回空数组", () => {
    expect(aiResultToBlocks("一句话总结。")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "一句话总结。" }] },
    ]);
    expect(aiResultToBlocks("   ")).toEqual([]);
  });
});
