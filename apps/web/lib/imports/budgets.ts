/**
 * 导入预算（任务 0 定稿，任务书 §八：先用真实样本验证再写进 UI 与测试，超限明确失败，禁止静默截断）。
 *
 * 入口层（客户端即时校验，与服务端一致）：
 *   每批 ≤6 个文件、合计 ≤20MB（沿用物料入口预算）。
 * 解析层（服务端强制执行）：
 *   文本文件单文件 ≤200KB；PDF ≤200 页；解压后 ≤50MB；XLSX ≤50 工作表 /
 *   ≤10 万单元格；提取输出 ≤10 万字符。
 */

/** 每批文件数上限（与既有物料入口一致） */
export const IMPORT_MAX_FILES = 6;
/** 每批合计字节上限（20MB） */
export const IMPORT_MAX_BATCH_BYTES = 20 * 1024 * 1024;
/** 单文本文件上限（200KB） */
export const IMPORT_MAX_TEXT_BYTES = 200 * 1024;
/** PDF 页数预算 */
export const IMPORT_MAX_PDF_PAGES = 200;
/** 解压后体积预算（XLSX 为 zip，防 zip bomb） */
export const IMPORT_MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;
/** XLSX 工作表预算 */
export const IMPORT_MAX_SHEETS = 50;
/** XLSX 单元格预算 */
export const IMPORT_MAX_CELLS = 100_000;
/** 提取输出字符预算（HTML 文本内容） */
export const IMPORT_MAX_OUTPUT_CHARS = 100_000;

export interface ImportBudgets {
  maxFiles: number;
  maxBatchBytes: number;
  maxTextBytes: number;
  maxPdfPages: number;
  maxDecompressedBytes: number;
  maxSheets: number;
  maxCells: number;
  maxOutputChars: number;
}

export const IMPORT_BUDGETS: ImportBudgets = {
  maxFiles: IMPORT_MAX_FILES,
  maxBatchBytes: IMPORT_MAX_BATCH_BYTES,
  maxTextBytes: IMPORT_MAX_TEXT_BYTES,
  maxPdfPages: IMPORT_MAX_PDF_PAGES,
  maxDecompressedBytes: IMPORT_MAX_DECOMPRESSED_BYTES,
  maxSheets: IMPORT_MAX_SHEETS,
  maxCells: IMPORT_MAX_CELLS,
  maxOutputChars: IMPORT_MAX_OUTPUT_CHARS,
};

/**
 * 入口层整批校验（客户端与服务端共用）。返回用户可读错误；null = 通过。
 * 不静默截断：超限即整体拒绝并说明限制。
 */
export function validateImportBatch(
  files: Pick<File, "name" | "size">[],
): string | null {
  if (!files.length) return "请至少选择一个文件";
  if (files.length > IMPORT_MAX_FILES) return `每次最多导入 ${IMPORT_MAX_FILES} 个文件，请分批`;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > IMPORT_MAX_BATCH_BYTES) {
    return `每批文件合计不能超过 20MB（当前 ${(total / 1024 / 1024).toFixed(1)}MB），请分批`;
  }
  for (const file of files) {
    if (!file.size) return `「${file.name}」为空文件`;
  }
  return null;
}
