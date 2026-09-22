/**
 * 文件导入（阶段 D）共享类型。
 *
 * 三份内容分离（任务书 §八）：原始文件（import-files 桶）→ 提取正文（reading_items）
 * → 可选 AI 整理稿（既有 AI 链路）。ExtractedDocument 只是「提取正文」这一步的产物。
 */

/** 导入文件种类（090 import_files.kind 同枚举） */
export type ImportKind =
  | "text"
  | "markdown"
  | "csv"
  | "json"
  | "pdf"
  | "docx"
  | "xlsx"
  | "image"
  | "audio";

/** 解析产物：正文已转义为安全 HTML（阅读条目 content 列直存）。 */
export interface ExtractedDocument {
  title: string;
  html: string;
  excerpt: string;
  /** PDF 页数等提取元数据（入 import_files.page_count） */
  pageCount?: number;
}

/** 客户端可见的逐文件导入结果（与 090 表 / API 响应逐字段对齐）。 */
export interface ImportFileResult {
  id: string;
  taskId: string;
  fileName: string;
  kind: ImportKind;
  size: number;
  status: "pending" | "uploading" | "parsing" | "saved" | "failed";
  error: string | null;
  readingItemId: string | null;
  pageCount: number | null;
  createdAt: string;
}
