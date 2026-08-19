import { describe, it, expect } from "vitest";
import { tiptapJsonToMarkdown } from "./tiptap-to-md";

describe("tiptapJsonToMarkdown：公式与附件", () => {
  it("inlineMath 输出 $latex$", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "公式 " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
          ],
        },
      ],
    };
    expect(tiptapJsonToMarkdown(json)).toContain("$x^2$");
  });

  it("mathBlock 输出 $$ 代码块", () => {
    const json = {
      type: "doc",
      content: [{ type: "mathBlock", attrs: { latex: "\\int x dx" } }],
    };
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("$$");
    expect(md).toContain("\\int x dx");
  });

  it("inlineMath 兼容旧 expr 属性", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "inlineMath", attrs: { expr: "a+b" } }],
        },
      ],
    };
    expect(tiptapJsonToMarkdown(json)).toContain("$a+b$");
  });

  it("fileAttachment 输出带文件名的链接", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "fileAttachment",
          attrs: { src: "https://example.com/a.pdf", name: "报告.pdf", mime: "application/pdf" },
        },
      ],
    };
    expect(tiptapJsonToMarkdown(json)).toContain("[📎 报告.pdf](https://example.com/a.pdf)");
  });

  it("fileAttachment 无 src 时仍保留文件名", () => {
    const json = {
      type: "doc",
      content: [{ type: "fileAttachment", attrs: { name: "附件.zip" } }],
    };
    expect(tiptapJsonToMarkdown(json)).toContain("附件.zip");
  });
});
