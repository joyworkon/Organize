// @vitest-environment node
// 服务端解析器测试：真实样本（fixtures 由 reportlab / python-docx / openpyxl 生成）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractServerDocument, zipDecompressedSize } from "./extract-server";
import { ImportError } from "./errors";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

const enc = new TextEncoder();

describe("zipDecompressedSize", () => {
  it("真实 xlsx 的解压体积为正且有限", () => {
    const size = zipDecompressedSize(fixture("sample.xlsx"));
    expect(size).toBeGreaterThan(1000);
    expect(size).toBeLessThan(1024 * 1024);
  });

  it("非 zip 字节 → corrupted", () => {
    expect(() => zipDecompressedSize(enc.encode("not a zip at all"))).toThrowError(ImportError);
  });
});

describe("extractServerDocument / xlsx", () => {
  it("多工作表结构保留为表格，不压成摘要", async () => {
    const doc = await extractServerDocument("xlsx", { fileName: "报表.xlsx", bytes: fixture("sample.xlsx") });
    expect(doc.title).toBe("报表");
    expect(doc.html).toContain("<h3>工作表：销售</h3>");
    expect(doc.html).toContain("<h3>工作表：备注</h3>");
    expect(doc.html).toContain("<th>月份</th>");
    expect(doc.html).toContain("<td>二月</td>");
    expect(doc.html).toContain("<td>第二季数据待补</td>");
    expect(doc.excerpt).toContain("一月");
  });

  it("工作表预算超限 → too-many-sheets", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    for (let i = 0; i < 51; i++) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"]]), `S${i}`);
    }
    const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer" }) as ArrayBuffer);
    try {
      await extractServerDocument("xlsx", { fileName: "many.xlsx", bytes });
      expect.unreachable();
    } catch (e) {
      expect((e as ImportError).code).toBe("too-many-sheets");
    }
  });

  it("单元格预算超限 → too-many-cells", async () => {
    const XLSX = await import("xlsx");
    const rows = Array.from({ length: 500 }, (_, r) =>
      Array.from({ length: 250 }, (_, c) => `r${r}c${c}`)); // 125,000 cells
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "big");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer" }) as ArrayBuffer);
    try {
      await extractServerDocument("xlsx", { fileName: "big.xlsx", bytes });
      expect.unreachable();
    } catch (e) {
      expect((e as ImportError).code).toBe("too-many-cells");
    }
  });
});

describe("extractServerDocument / pdf", () => {
  it("文本 PDF：提取正文、保留页码信息、页数元数据、元数据标题", async () => {
    const doc = await extractServerDocument("pdf", { fileName: "report.pdf", bytes: fixture("sample.pdf") });
    expect(doc.title).toBe("季度报告 Fixture");
    expect(doc.html).toContain("第 1 页");
    expect(doc.html).toContain("第 2 页");
    expect(doc.html).toContain("Revenue grew 42 percent");
    expect(doc.html).toContain("Second page content");
    expect(doc.pageCount).toBe(2);
  });

  it("扫描型 PDF → scanned（不伪造正文）", async () => {
    try {
      await extractServerDocument("pdf", { fileName: "scan.pdf", bytes: fixture("sample-scanned.pdf") });
      expect.unreachable();
    } catch (e) {
      expect((e as ImportError).code).toBe("scanned");
      expect((e as ImportError).message).toContain("OCR");
    }
  });

  it("加密 PDF → encrypted", async () => {
    try {
      await extractServerDocument("pdf", { fileName: "locked.pdf", bytes: fixture("sample-encrypted.pdf") });
      expect.unreachable();
    } catch (e) {
      expect((e as ImportError).code).toBe("encrypted");
    }
  });

  it("垃圾字节 → corrupted/parse-failed（不崩溃）", async () => {
    try {
      await extractServerDocument("pdf", { fileName: "junk.pdf", bytes: enc.encode("%PDF-junk-not-real") });
      expect.unreachable();
    } catch (e) {
      expect(["corrupted", "parse-failed"]).toContain((e as ImportError).code);
    }
  });
});

describe("extractServerDocument / docx", () => {
  it("标题/段落/列表/表格提取 + 嵌入图片纳入资产管理", async () => {
    const doc = await extractServerDocument("docx", { fileName: "方案.docx", bytes: fixture("sample.docx") });
    expect(doc.title).toBe("方案");
    expect(doc.html).toContain("导入测试文档");
    expect(doc.html).toContain("这是一段正文");
    expect(doc.html).toContain("<ul>");
    expect(doc.html).toContain("第一点 alpha");
    expect(doc.html).toContain("<table>");
    expect(doc.html).toContain("<td>42</td>");
    // 嵌入图片字节被收集（由路由存档）
    expect(doc.embeddedImages.length).toBe(1);
    expect(doc.embeddedImages[0].bytes.length).toBeGreaterThan(100);
  });

  it("损坏的 docx → 明确失败（不崩溃）", async () => {
    try {
      await extractServerDocument("docx", { fileName: "bad.docx", bytes: enc.encode("PK not really") });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
    }
  });
});

describe("extractServerDocument / 纯文本路径", () => {
  it("服务端复用同一实现（与 mock shim 输出一致）", async () => {
    const doc = await extractServerDocument("markdown", {
      fileName: "a.md", bytes: enc.encode("# 标题\n\n- 一\n- 二"),
    });
    expect(doc.title).toBe("标题");
    expect(doc.html).toContain("<ul><li>一</li><li>二</li></ul>");
    expect(doc.embeddedImages).toEqual([]);
  });
});
