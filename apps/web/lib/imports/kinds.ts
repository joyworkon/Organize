/**
 * 导入文件种类识别（阶段 D）。
 *
 * 只按扩展名 + MIME 归类，不读内容（内容校验在各解析器内做）。
 * 与 090 import_files.kind 枚举一致。
 */
import type { ImportKind } from "./types";

/** 文件选择器 accept（入口沿用任务书预算：每批 ≤6 个、合计 20MB） */
export const IMPORT_ACCEPT = ".txt,.md,.markdown,.csv,.json,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.ogg,.webm";

const KIND_BY_EXT: Record<string, ImportKind> = {
  txt: "text",
  md: "markdown",
  markdown: "markdown",
  csv: "csv",
  json: "json",
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", webm: "audio",
};

const MIME_BY_KIND: Record<ImportKind, string[]> = {
  text: ["text/plain"],
  markdown: ["text/markdown", "text/x-markdown"],
  csv: ["text/csv"],
  json: ["application/json"],
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  image: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  audio: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/ogg", "audio/webm"],
};

export function importKind(file: Pick<File, "name" | "type">): ImportKind | null {
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  for (const [kind, mimes] of Object.entries(MIME_BY_KIND)) {
    if (mimes.includes(mime)) return kind as ImportKind;
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return KIND_BY_EXT[ext] ?? null;
}

/** 是否需要服务端解析器（PDF/DOCX/XLSX）；其余为纯文本路径或原件直存。 */
export function needsServerParser(kind: ImportKind): boolean {
  return kind === "pdf" || kind === "docx" || kind === "xlsx";
}
