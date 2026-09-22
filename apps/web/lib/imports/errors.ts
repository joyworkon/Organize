/**
 * 导入失败分类（任务书 §八：扫描型 / 加密 / 损坏 / 超限分别提示原因，禁止静默截断）。
 *
 * code 是稳定机器标识（重试与测试用）；message 是用户可读中文原因。
 */
export type ImportErrorCode =
  | "unsupported"      // 不支持的格式
  | "empty"            // 空文件
  | "not-utf8"         // 文本不是 UTF-8
  | "encrypted"        // 加密文件（如加密 PDF）
  | "corrupted"        // 损坏文件
  | "scanned"          // 扫描型 PDF：需要 OCR（仍可保存原件，不伪造正文）
  | "too-large"        // 超过入口/解析预算
  | "too-many-pages"   // PDF 超过页数预算
  | "too-many-sheets"  // XLSX 超过工作表预算
  | "too-many-cells"   // XLSX 超过单元格预算
  | "parse-failed";    // 解析器未归类失败

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

export function isImportError(error: unknown): error is ImportError {
  return error instanceof ImportError;
}

/** 把任意解析器异常归为 ImportError（未知一律 parse-failed，附原文）。 */
export function toImportError(error: unknown, fallback = "解析失败"): ImportError {
  if (isImportError(error)) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ImportError("parse-failed", `${fallback}：${detail.slice(0, 200)}`);
}
