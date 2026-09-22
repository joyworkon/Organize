import { describe, expect, it } from "vitest";
import { IMPORT_ACCEPT, importKind } from "./kinds";
import { validateImportBatch, IMPORT_MAX_FILES } from "./budgets";

describe("importKind", () => {
  it("按扩展名识别全部支持格式", () => {
    const cases: Array<[string, string | null]> = [
      ["a.txt", "text"], ["a.md", "markdown"], ["a.markdown", "markdown"],
      ["a.csv", "csv"], ["a.json", "json"], ["a.pdf", "pdf"], ["a.docx", "docx"],
      ["a.xlsx", "xlsx"], ["a.png", "image"], ["a.jpg", "image"],
      ["a.mp3", "audio"], ["a.wav", "audio"],
      ["a.doc", null], ["a.xls", null], ["a.exe", null], ["a", null],
    ];
    for (const [name, kind] of cases) {
      expect(importKind({ name, type: "" }), name).toBe(kind);
    }
  });

  it("MIME 优先于扩展名", () => {
    expect(importKind({ name: "x.bin", type: "application/pdf" })).toBe("pdf");
    expect(importKind({ name: "x.txt", type: "application/pdf" })).toBe("pdf");
  });

  it("accept 清单覆盖所有识别格式", () => {
    for (const ext of ["txt", "md", "csv", "json", "pdf", "docx", "xlsx", "png", "jpg", "mp3"]) {
      expect(IMPORT_ACCEPT).toContain(`.${ext}`);
    }
  });
});

describe("validateImportBatch", () => {
  const file = (name: string, size: number) => ({ name, size });

  it("空批次 / 超数量 / 超总量 / 空文件分别拒绝", () => {
    expect(validateImportBatch([])).toContain("至少选择");
    expect(validateImportBatch(Array.from({ length: IMPORT_MAX_FILES + 1 }, (_, i) => file(`f${i}`, 1))))
      .toContain(`最多导入 ${IMPORT_MAX_FILES} 个`);
    expect(validateImportBatch([file("a", 19 * 1024 * 1024), file("b", 2 * 1024 * 1024)]))
      .toContain("20MB");
    expect(validateImportBatch([file("empty.txt", 0)])).toContain("空文件");
  });

  it("合规批次通过", () => {
    expect(validateImportBatch([file("a.txt", 100), file("b.pdf", 1024)])).toBeNull();
  });
});
