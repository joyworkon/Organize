import { describe, expect, it } from "vitest";
import { editableTextToHtml, htmlToEditableText } from "./digest-editable";

// 阶段 4：整理稿可编辑的双向转换。覆盖 AI 产出的全部块型（h2/p/ul/ol/table），
// 编辑不丢表格；反向全部转义（内容视为不可信）。

describe("htmlToEditableText", () => {
  it("标题/段落/列表转迷你标记", () => {
    const html = "<h2>小结</h2><p>第一段</p><ul><li>要点甲</li><li>要点乙</li></ul>";
    expect(htmlToEditableText(html)).toBe(
      "## 小结\n\n第一段\n\n- 要点甲\n\n- 要点乙",
    );
  });

  it("表格转管道行；有序列表保留编号", () => {
    const html =
      "<table><tr><th>名称</th><th>金额</th></tr><tr><td>门票</td><td>100</td></tr></table>" +
      "<ol><li>第一步</li><li>第二步</li></ol>";
    const text = htmlToEditableText(html);
    expect(text).toContain("| 名称 | 金额 |");
    expect(text).toContain("| 门票 | 100 |");
    expect(text).toContain("1. 第一步");
    expect(text).toContain("2. 第二步");
  });

  it("解实体", () => {
    expect(htmlToEditableText("<p>a&amp;b &lt;tag&gt;</p>")).toBe("a&b <tag>");
  });
});

describe("editableTextToHtml", () => {
  it("迷你标记转回 HTML，列表相邻行合并", () => {
    const html = editableTextToHtml("## 小结\n\n- 要点甲\n- 要点乙\n\n1. 第一步\n2. 第二步");
    expect(html).toBe(
      "<h2>小结</h2><ul><li>要点甲</li><li>要点乙</li></ul><ol><li>第一步</li><li>第二步</li></ol>",
    );
  });

  it("表格首行表头，其余行体", () => {
    const html = editableTextToHtml("| 名称 | 金额 |\n| 门票 | 100 |");
    expect(html).toBe(
      "<table><tr><th>名称</th><th>金额</th></tr><tr><td>门票</td><td>100</td></tr></table>",
    );
  });

  it("全部转义（内容不可信）", () => {
    const html = editableTextToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("round-trip", () => {
  it("AI 形态的完整文章：HTML → 编辑 → HTML，结构无损", () => {
    const original =
      "<p>产品发布 · 整理</p>" +
      "<h2>关键结论</h2>" +
      "<p>定价 4999 元（来源1）。</p>" +
      "<ul><li>渠道：线上（来源2）</li><li>时间：十月（来源1）</li></ul>" +
      "<table><tr><th>配置</th><th>价格</th></tr><tr><td>标准版</td><td>4999</td></tr></table>";
    const edited = htmlToEditableText(original)
      .replace("定价 4999 元", "定价 499 元");
    const result = editableTextToHtml(edited);
    expect(result).toContain("<h2>关键结论</h2>");
    expect(result).toContain("<p>定价 499 元（来源1）。</p>");
    expect(result).toContain("<ul><li>渠道：线上（来源2）</li><li>时间：十月（来源1）</li></ul>");
    expect(result).toContain("<th>配置</th>");
    expect(result).toContain("<td>标准版</td><td>4999</td>");
  });
});
