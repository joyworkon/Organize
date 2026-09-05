import { describe, it, expect } from "vitest";
import { marked } from "marked";
import { renderMarkdownExport, tiptapJsonToMarkdown } from "./tiptap-to-md";

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

// ---------- R01 复杂块保真回归 ----------
// 每个样本带唯一标记文字，断言标记全部出现且顺序正确。
const docOf = (...content: unknown[]) => ({ type: "doc", content });
const paraOf = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("R01 复杂块保真", () => {
  it("标注转引用且正文不丢", () => {
    const json = docOf({
      type: "callout",
      attrs: { emoji: "💡" },
      content: [paraOf("标注内唯一文字甲")],
    });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("💡");
    expect(md).toContain("标注内唯一文字甲");
    expect(md).toContain(">");
  });

  it("分栏依次展开两列正文", () => {
    const json = docOf({
      type: "columns",
      attrs: { cols: 2 },
      content: [
        { type: "column", content: [paraOf("分栏左列唯一文字乙")] },
        { type: "column", content: [paraOf("分栏右列唯一文字丙")] },
      ],
    });
    const md = tiptapJsonToMarkdown(json);
    const left = md.indexOf("分栏左列唯一文字乙");
    const right = md.indexOf("分栏右列唯一文字丙");
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeGreaterThan(left);
  });

  it("表格保留各单元格段落文本并转义竖线", () => {
    const json = docOf({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [paraOf("表头唯一文字丁")] },
            { type: "tableHeader", content: [paraOf("第二列")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [paraOf("第一段戊"), paraOf("第二段己")] },
            { type: "tableCell", content: [paraOf("含|竖线")] },
          ],
        },
      ],
    });
    const md = tiptapJsonToMarkdown(json);
    for (const marker of ["表头唯一文字丁", "第一段戊", "第二段己"]) {
      expect(md).toContain(marker);
    }
    // 同一单元格内多段落用 <br> 或一致空格连接，不丢失
    expect(md).toMatch(/第一段戊<br>第二段己|第一段戊 第二段己/);
    expect(md).toContain("含\\|竖线");
  });

  it("合并单元格降级展开并输出警告", () => {
    const json = docOf({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableHeader", attrs: { colspan: 2 }, content: [paraOf("跨列表头")] }],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [paraOf("合并甲")] },
            { type: "tableCell", content: [paraOf("合并乙")] },
          ],
        },
      ],
    });
    const { markdown, warnings } = renderMarkdownExport(json);
    expect(markdown).toContain("跨列表头");
    expect(markdown).toContain("合并甲");
    expect(markdown).toContain("合并乙");
    expect(warnings.some((w) => w.code === "table-merged-cells")).toBe(true);
  });

  it("两层嵌套列表缩进保留子项", () => {
    const json = docOf({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            paraOf("父项唯一文字庚"),
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [paraOf("子项唯一文字辛")] }],
            },
          ],
        },
      ],
    });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("父项唯一文字庚");
    const childLine = md.split("\n").find((line) => line.includes("子项唯一文字辛"));
    // 子项仍保留自己的列表标记且缩进在父项之下，不是被拍平成纯文本或丢失
    expect(childLine).toBeDefined();
    expect(childLine).toMatch(/^\s+- /);
  });

  it("任务列表输出 - [ ] / - [x]", () => {
    const json = docOf({
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: false }, content: [paraOf("待办唯一文字壬")] },
        { type: "taskItem", attrs: { checked: true }, content: [paraOf("已完成唯一文字癸")] },
      ],
    });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("- [ ] 待办唯一文字壬");
    expect(md).toContain("- [x] 已完成唯一文字癸");
  });

  it("有序列表尊重 start 属性", () => {
    const json = docOf({
      type: "orderedList",
      attrs: { start: 3 },
      content: [{ type: "listItem", content: [paraOf("有序唯一文字子")] }],
    });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("3. 有序唯一文字子");
  });

  it("代码围栏长度避开内容中的连续反引号", () => {
    const json = docOf({
      type: "codeBlock",
      attrs: { language: "md" },
      content: [{ type: "text", text: "内容中有```\n三连反引号" }],
    });
    const md = tiptapJsonToMarkdown(json);
    expect(md.startsWith("````md\n")).toBe(true);
    expect(md).toContain("三连反引号");
  });

  it("折叠保留摘要与正文且顺序正确", () => {
    const json = docOf({
      type: "details",
      content: [
        { type: "detailsSummary", content: [paraOf("折叠摘要唯一文字丑")] },
        { type: "detailsContent", content: [paraOf("折叠正文唯一文字寅")] },
      ],
    });
    const md = tiptapJsonToMarkdown(json);
    const summary = md.indexOf("折叠摘要唯一文字丑");
    const body = md.indexOf("折叠正文唯一文字寅");
    expect(summary).toBeGreaterThanOrEqual(0);
    expect(body).toBeGreaterThan(summary);
  });

  it("tabs 保留各页标题与正文", () => {
    const json = docOf({
      type: "tabs",
      attrs: { activeIndex: 0 },
      content: [
        { type: "tab", attrs: { title: "页一标题", active: true }, content: [paraOf("页一唯一文字卯")] },
        { type: "tab", attrs: { title: "页二标题", active: false }, content: [paraOf("页二唯一文字辰")] },
      ],
    });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("页一标题");
    expect(md).toContain("页二标题");
    expect(md.indexOf("页一唯一文字卯")).toBeLessThan(md.indexOf("页二唯一文字辰"));
  });

  it("Mermaid 保留源码围栏", () => {
    const json = docOf({ type: "mermaid", attrs: { code: "graph TD\nA-->B" } });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("```mermaid");
    expect(md).toContain("A-->B");
  });

  it("htmlEmbed 保留 HTML 源码", () => {
    const json = docOf({ type: "htmlEmbed", attrs: { html: "<p>内嵌HTML唯一文字申</p>" } });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("内嵌HTML唯一文字申");
  });

  it("嵌入保留源链接与标题", () => {
    const json = docOf({
      type: "embed",
      attrs: { url: "https://example.com/v", title: "嵌入唯一文字巳" },
    });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("https://example.com/v");
    expect(md).toContain("嵌入唯一文字巳");
  });

  it("按钮保留标签与安全目标，不安全目标不导出", () => {
    const safe = docOf({
      type: "buttonBlock",
      attrs: { label: "按钮唯一文字午", action: "open-url", payload: "https://example.com/go" },
    });
    const md = tiptapJsonToMarkdown(safe);
    expect(md).toContain("按钮唯一文字午");
    expect(md).toContain("https://example.com/go");

    const evil = docOf({
      type: "buttonBlock",
      attrs: { label: "恶按钮唯一文字", action: "open-url", payload: "javascript:alert(1)" },
    });
    const md2 = tiptapJsonToMarkdown(evil);
    expect(md2).toContain("恶按钮唯一文字");
    expect(md2).not.toContain("javascript:");
  });

  it("目录与面包屑输出可读说明", () => {
    const json = docOf({ type: "tableOfContents" }, { type: "breadcrumb" });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("目录");
    expect(md).toContain("面包屑");
  });

  it("同步块导出正文内已有快照", () => {
    const json = docOf({
      type: "syncedBlock",
      attrs: { syncedId: "s1", hydrated: true },
      content: [paraOf("同步块快照唯一文字未")],
    });
    const md = tiptapJsonToMarkdown(json);
    expect(md).toContain("同步块快照唯一文字未");
  });

  it("数据库块输出引用说明并报告未含行数据", () => {
    const json = docOf({
      type: "databaseBlock",
      attrs: { databaseId: "db-123", viewId: "default_view" },
    });
    const { markdown, warnings } = renderMarkdownExport(json);
    expect(markdown).toContain("db-123");
    expect(markdown).toContain("数据库");
    expect(warnings.some((w) => w.code === "database-rows-excluded")).toBe(true);
  });
});

describe("R01 未知节点与损坏输入", () => {
  it("未知容器节点递归块内容并输出警告", () => {
    const json = docOf({ type: "futureBlock", content: [paraOf("未知容器唯一文字酉")] });
    const { markdown, warnings } = renderMarkdownExport(json);
    expect(markdown).toContain("未知容器唯一文字酉");
    expect(warnings.some((w) => w.code === "unknown-node" && w.nodeType === "futureBlock")).toBe(true);
  });

  it("未知行内节点保留可读文字并输出警告", () => {
    const json = docOf({
      type: "paragraph",
      content: [
        { type: "text", text: "前" },
        { type: "futureInline", content: [{ type: "text", text: "未知行内唯一文字戌" }] },
        { type: "text", text: "后" },
      ],
    });
    const { markdown, warnings } = renderMarkdownExport(json);
    expect(markdown).toContain("前");
    expect(markdown).toContain("未知行内唯一文字戌");
    expect(markdown).toContain("后");
    expect(warnings.some((w) => w.code === "unknown-node")).toBe(true);
  });

  it("损坏输入不抛异常，降级信息与正文分离", () => {
    expect(() => renderMarkdownExport(null)).not.toThrow();
    expect(() => renderMarkdownExport({ type: "doc", content: [{ type: "paragraph" }] })).not.toThrow();
    expect(() => renderMarkdownExport({ type: "doc", content: "not-array" })).not.toThrow();
    const bad = renderMarkdownExport({ type: "doc", content: "not-array" } as unknown as Record<string, unknown>);
    expect(Array.isArray(bad.warnings)).toBe(true);
    expect(typeof bad.markdown).toBe("string");
  });

  it("空笔记与中文标题保持既有行为", () => {
    expect(tiptapJsonToMarkdown(null)).toBe("");
    expect(tiptapJsonToMarkdown(null, "中文标题")).toBe("# 中文标题\n");
    expect(tiptapJsonToMarkdown(docOf(), "中文标题二")).toContain("# 中文标题二");
  });

  it("代表性 Markdown 语法可用 marked 解析（列表/表格/引用）", () => {
    const json = docOf(
      paraOf("混排段落"),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              paraOf("列表项一"),
              { type: "bulletList", content: [{ type: "listItem", content: [paraOf("嵌套项")] }] },
            ],
          },
        ],
      },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [paraOf("列A")] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [paraOf("值A")] }] },
        ],
      },
      { type: "callout", attrs: { emoji: "💡" }, content: [paraOf("引用块")] },
    );
    const md = tiptapJsonToMarkdown(json);
    const html = marked.parse(md, { async: false }) as string;
    expect(html).toContain("<li>列表项一");
    expect(html).toContain("<li>嵌套项");
    expect(html).toContain("<table");
    expect(html).toContain("<blockquote");
  });
});
