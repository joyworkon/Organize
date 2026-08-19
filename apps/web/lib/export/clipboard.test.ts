// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tiptapJsonToHtml, tiptapJsonToPlainText, wrapClipboardHtml } from "./tiptap-to-html";
import { copyNoteContent, supportsClipboardItem, supportsWriteText } from "./clipboard";

describe("tiptapJsonToHtml", () => {
  it("空输入返回空字符串", () => {
    expect(tiptapJsonToHtml(null)).toBe("");
    expect(tiptapJsonToHtml(undefined)).toBe("");
  });

  it("标题渲染为 h1-h4", () => {
    const json = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "大标题" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "二级" }] },
        { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "四级" }] },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("<h1>大标题</h1>");
    expect(html).toContain("<h2>二级</h2>");
    expect(html).toContain("<h4>四级</h4>");
  });

  it("段落和普通文本", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    expect(tiptapJsonToHtml(json)).toBe("<p>Hello world</p>");
  });

  it("加粗/斜体/删除线/下划线/行内代码标记", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " italic", marks: [{ type: "italic" }] },
            { type: "text", text: " strike", marks: [{ type: "strike" }] },
            { type: "text", text: " under", marks: [{ type: "underline" }] },
            { type: "text", text: " code", marks: [{ type: "code" }] },
          ],
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em> italic</em>");
    expect(html).toContain("<s> strike</s>");
    expect(html).toContain("<u> under</u>");
    expect(html).toContain("<code> code</code>");
  });

  it("链接带有安全属性", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("无序列表和有序列表", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "1st" }] }] },
          ],
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
    expect(html).toContain("<ol><li><p>1st</p></li></ol>");
  });

  it("引用块 blockquote", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "引用文本" }] },
          ],
        },
      ],
    };
    expect(tiptapJsonToHtml(json)).toContain("<blockquote><p>引用文本</p></blockquote>");
  });

  it("代码块 pre/code 并转义 HTML 实体", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [{ type: "text", text: "<div>hello</div>" }],
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("<pre data-language=\"javascript\"><code>&lt;div&gt;hello&lt;/div&gt;</code></pre>");
  });

  it("表格渲染为 table/tr/td/th", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H1" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H2" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
              ],
            },
          ],
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("<table>");
    expect(html).toContain("<th><p>H1</p></th>");
    expect(html).toContain("<th><p>H2</p></th>");
    expect(html).toContain("<td><p>A</p></td>");
    expect(html).toContain("<td><p>B</p></td>");
    expect(html).toContain("</table>");
  });

  it("任务列表渲染为 checkbox 列表项", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }],
            },
          ],
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("task-list");
    expect(html).toContain("☑");
    expect(html).toContain("☐");
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('data-checked="false"');
  });

  it("callout 带 emoji 属性", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { emoji: "⚠️" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "注意" }] }],
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("<blockquote class=\"callout\"");
    expect(html).toContain("⚠️");
    expect(html).toContain("注意");
  });

  it("htmlEmbed 不输出任何内容（安全：跳过脚本/iframe）", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "htmlEmbed",
          attrs: { html: "<script>alert(1)</script>" },
        },
        { type: "paragraph", content: [{ type: "text", text: "safe" }] },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).not.toContain("script");
    expect(html).not.toContain("alert");
    expect(html).toContain("safe");
  });

  it("转义文本中的 HTML 特殊字符", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "<script>bad</script> & \"quotes\"" }] },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("硬换行和分割线", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "line1" },
            { type: "hardBreak" },
            { type: "text", text: "line2" },
          ],
        },
        { type: "horizontalRule" },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("<br />");
    expect(html).toContain("<hr />");
  });

  it("图片带 alt 属性", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://example.com/img.png", alt: "示例图" },
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("<img src=\"https://example.com/img.png\" alt=\"示例图\"");
  });
});

describe("tiptapJsonToPlainText", () => {
  it("空输入返回空字符串", () => {
    expect(tiptapJsonToPlainText(null)).toBe("");
    expect(tiptapJsonToPlainText(undefined)).toBe("");
  });

  it("标题和段落用空行分隔", () => {
    const json = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] },
        { type: "paragraph", content: [{ type: "text", text: "正文第一段" }] },
        { type: "paragraph", content: [{ type: "text", text: "正文第二段" }] },
      ],
    };
    const text = tiptapJsonToPlainText(json);
    const lines = text.split("\n\n");
    expect(lines[0]).toBe("标题");
    expect(lines).toContain("正文第一段");
    expect(lines).toContain("正文第二段");
  });

  it("列表项带符号前缀", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
          ],
        },
      ],
    };
    const text = tiptapJsonToPlainText(json);
    expect(text).toContain("- a");
    expect(text).toContain("- b");
  });

  it("有序列表带数字编号", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
          ],
        },
      ],
    };
    const text = tiptapJsonToPlainText(json);
    expect(text).toContain("1. first");
    expect(text).toContain("2. second");
  });

  it("代码块输出纯代码文本", () => {
    const json = {
      type: "doc",
      content: [
        { type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }] },
      ],
    };
    expect(tiptapJsonToPlainText(json)).toBe("const x = 1;");
  });

  it("htmlEmbed 跳过不输出", () => {
    const json = {
      type: "doc",
      content: [
        { type: "htmlEmbed", attrs: { html: "<script>x</script>" } },
        { type: "paragraph", content: [{ type: "text", text: "ok" }] },
      ],
    };
    expect(tiptapJsonToPlainText(json)).toBe("ok");
  });

  it("表格行用 | 分隔", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
              ],
            },
          ],
        },
      ],
    };
    expect(tiptapJsonToPlainText(json)).toBe("a | b");
  });
});

describe("wrapClipboardHtml", () => {
  it("带标题时包含 h1 和 charset meta", () => {
    const html = wrapClipboardHtml("<p>body</p>", "My Title");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<meta charset=\"utf-8\">");
    expect(html).toContain("<h1>My Title</h1>");
    expect(html).toContain("<p>body</p>");
  });

  it("空标题时不生成 h1", () => {
    const html = wrapClipboardHtml("<p>x</p>", "");
    expect(html).not.toContain("<h1>");
    expect(html).toContain("<p>x</p>");
  });

  it("标题中 HTML 特殊字符被转义", () => {
    const html = wrapClipboardHtml("", "<script>bad</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---------- copyNoteContent 测试 ----------
// 用 vi.stubGlobal 模拟 navigator.clipboard 和 window.ClipboardItem。

describe("copyNoteContent", () => {
  let writeMock: ReturnType<typeof vi.fn>;
  let writeTextMock: ReturnType<typeof vi.fn>;
  let ctorCalls: Array<Record<string, Blob>>;

  class MockClipboardItem {
    data: Record<string, Blob>;
    types: string[];
    constructor(data: Record<string, Blob>) {
      this.data = data;
      this.types = Object.keys(data);
      ctorCalls.push(data);
    }
  }

  beforeEach(() => {
    writeMock = vi.fn().mockResolvedValue(undefined);
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    ctorCalls = [];

    const mockClipboard = { write: writeMock, writeText: writeTextMock };
    vi.stubGlobal("navigator", { clipboard: mockClipboard });
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    // 注意：代码通过 (window as any).ClipboardItem 访问，window.ClipboardItem 也要设置
    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).window.ClipboardItem = MockClipboardItem;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("双格式写入成功返回 mode=rich", async () => {
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };
    const result = await copyNoteContent("Test", json);
    if (!result.success) throw new Error("expected success");
    expect(result.mode).toBe("rich");
    expect(result.usedFallback).toBe(false);
    expect(writeMock).toHaveBeenCalledTimes(1);
    // ClipboardItem 应该收到 text/html 和 text/plain
    expect(ctorCalls).toHaveLength(1);
    const blobMap = ctorCalls[0];
    expect(blobMap).toHaveProperty("text/html");
    expect(blobMap).toHaveProperty("text/plain");
  });

  it("ClipboardItem 写入失败（权限拒绝）降级到纯文本", async () => {
    writeMock.mockRejectedValueOnce(new DOMException("Not allowed", "NotAllowedError"));
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };
    const result = await copyNoteContent("Test", json);
    if (!result.success) throw new Error("expected success");
    expect(result.mode).toBe("plain");
    expect(result.usedFallback).toBe(true);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0][0]).toContain("Test");
    expect(writeTextMock.mock.calls[0][0]).toContain("hi");
  });

  it("ClipboardItem 不可用（无 window.ClipboardItem）时降级到 writeText", async () => {
    // 删除 ClipboardItem 以模拟旧浏览器
    vi.stubGlobal("ClipboardItem", undefined);
    (globalThis as any).window.ClipboardItem = undefined;
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };
    const result = await copyNoteContent("Title", json);
    if (!result.success) throw new Error("expected success");
    expect(result.mode).toBe("plain");
    expect(writeMock).not.toHaveBeenCalled();
    expect(writeTextMock).toHaveBeenCalledTimes(1);
  });

  it("write 和 writeText 都失败时返回失败", async () => {
    writeMock.mockRejectedValue(new Error("fail"));
    writeTextMock.mockRejectedValue(new Error("fail"));
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };
    const result = await copyNoteContent("T", json);
    expect(result.success).toBe(false);
  });

  it("空正文和空标题视为成功（无内容可复制也不报错）", async () => {
    const result = await copyNoteContent("", { type: "doc", content: [] });
    expect(result.success).toBe(true);
    expect(writeMock).not.toHaveBeenCalled();
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("纯文本格式包含标题和正文", async () => {
    writeMock.mockRejectedValue(new Error("no rich"));
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }] };
    await copyNoteContent("My Note", json);
    const plainArg = writeTextMock.mock.calls[0][0] as string;
    expect(plainArg).toContain("My Note");
    expect(plainArg).toContain("body");
    // 标题和正文之间有空行
    expect(plainArg).toMatch(/My Note\n\s*\nbody/);
  });
});


describe("导出序列化：公式与附件（latex 属性 / fileAttachment）", () => {
  it("inlineMath / mathBlock 读取 latex 属性（HTML）", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "公式 " },
            { type: "inlineMath", attrs: { latex: "x^2+y^2" } },
          ],
        },
        { type: "mathBlock", attrs: { latex: "\\int_0^1 x dx" } },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain("x^2+y^2");
    expect(html).toContain("\\int_0^1 x dx");
  });

  it("inlineMath 兼容旧 expr 属性（HTML）", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "inlineMath", attrs: { expr: "a+b" } }],
        },
      ],
    };
    expect(tiptapJsonToHtml(json)).toContain("a+b");
  });

  it("inlineMath / mathBlock 读取 latex 属性（纯文本）", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "inlineMath", attrs: { latex: "e=mc^2" } }],
        },
        { type: "mathBlock", attrs: { latex: "\\sum i" } },
      ],
    };
    const text = tiptapJsonToPlainText(json);
    expect(text).toContain("e=mc^2");
    expect(text).toContain("\\sum i");
  });

  it("fileAttachment 导出为带文件名的链接（HTML）", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "fileAttachment",
          attrs: { src: "https://example.com/a.pdf", name: "报告.pdf", size: 1024, mime: "application/pdf" },
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).toContain('href="https://example.com/a.pdf"');
    expect(html).toContain("报告.pdf");
  });

  it("fileAttachment 无 src 时仍保留文件名（HTML + 纯文本）", () => {
    const json = {
      type: "doc",
      content: [{ type: "fileAttachment", attrs: { name: "丢失地址.zip" } }],
    };
    expect(tiptapJsonToHtml(json)).toContain("丢失地址.zip");
    expect(tiptapJsonToPlainText(json)).toContain("丢失地址.zip");
  });

  it("fileAttachment 文件名经过转义（HTML）", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "fileAttachment",
          attrs: { src: "https://example.com/x", name: '<script>alert(1)</script>' },
        },
      ],
    };
    const html = tiptapJsonToHtml(json);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
