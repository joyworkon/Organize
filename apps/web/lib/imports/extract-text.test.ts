import { describe, expect, it } from "vitest";
import { extractTextDocument } from "./extract-text";
import { ImportError } from "./errors";

const enc = new TextEncoder();

describe("extractTextDocument", () => {
  it("text：按空行分段为段落", () => {
    const doc = extractTextDocument("text", {
      fileName: "笔记.txt",
      bytes: enc.encode("第一段。\n\n第二段，更长一些的内容。"),
    });
    expect(doc.title).toBe("笔记");
    expect(doc.html).toBe("<p>第一段。</p><p>第二段，更长一些的内容。</p>");
    expect(doc.excerpt.length).toBeGreaterThan(0);
  });

  it("text：全部内容 HTML 转义（XSS 注入被中和）", () => {
    const doc = extractTextDocument("text", {
      fileName: "x.txt",
      bytes: enc.encode('<script>alert(1)</script> & "quotes"'),
    });
    expect(doc.html).not.toContain("<script>");
    expect(doc.html).toContain("&lt;script&gt;");
    expect(doc.html).toContain("&amp;");
    expect(doc.html).toContain("&quot;");
  });

  it("markdown：标题/列表/管道表格层级保留", () => {
    const md = "# 大标题\n\n## 小节\n\n- 甲\n- 乙\n\n| 名 | 值 |\n|---|---|\n| a | 1 |\n";
    const doc = extractTextDocument("markdown", { fileName: "doc.md", bytes: enc.encode(md) });
    expect(doc.title).toBe("大标题");
    expect(doc.html).toContain("<h2>大标题</h2>");
    expect(doc.html).toContain("<h3>小节</h3>");
    expect(doc.html).toContain("<ul><li>甲</li><li>乙</li></ul>");
    expect(doc.html).toContain("<table>");
    expect(doc.html).toContain("<th>名</th>");
    expect(doc.html).toContain("<td>a</td>");
  });

  it("markdown：表格单元格转义", () => {
    const md = "| a |\n|---|\n| <img onerror=x> |\n";
    const doc = extractTextDocument("markdown", { fileName: "d.md", bytes: enc.encode(md) });
    expect(doc.html).not.toContain("<img");
    expect(doc.html).toContain("&lt;img");
  });

  it("csv：引号包裹与转义双引号", () => {
    const doc = extractTextDocument("csv", {
      fileName: "data.csv",
      bytes: enc.encode('名称,备注\n"甲,乙","他说 ""你好"""\n'),
    });
    expect(doc.html).toContain("<table>");
    expect(doc.html).toContain("<th>名称</th>");
    expect(doc.html).toContain("甲,乙");
    // 引号在 HTML 中被转义（安全渲染合同）
    expect(doc.html).toContain("他说 &quot;你好&quot;");
  });

  it("json：对象数组 → 表格（保留表格结构）", () => {
    const doc = extractTextDocument("json", {
      fileName: "rows.json",
      bytes: enc.encode('[{"名称":"甲","数值":1},{"名称":"乙","数值":2}]'),
    });
    expect(doc.html).toContain("<th>名称</th>");
    expect(doc.html).toContain("<td>乙</td>");
  });

  it("json：非法 JSON → corrupted", () => {
    expect(() =>
      extractTextDocument("json", { fileName: "bad.json", bytes: enc.encode("{oops") }),
    ).toThrowError(ImportError);
    try {
      extractTextDocument("json", { fileName: "bad.json", bytes: enc.encode("{oops") });
    } catch (e) {
      expect((e as ImportError).code).toBe("corrupted");
    }
  });

  it("非 UTF-8 → not-utf8", () => {
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]); // GBK「你好」
    try {
      extractTextDocument("text", { fileName: "gbk.txt", bytes: gbk });
      expect.unreachable();
    } catch (e) {
      expect((e as ImportError).code).toBe("not-utf8");
    }
  });

  it("空内容 → empty", () => {
    try {
      extractTextDocument("text", { fileName: "empty.txt", bytes: new Uint8Array() });
      expect.unreachable();
    } catch (e) {
      expect((e as ImportError).code).toBe("empty");
    }
  });
});
