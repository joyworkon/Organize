/**
 * 纯文本路径的导入解析（阶段 D）——text / markdown / csv / json。
 *
 * 无任何外部依赖与 AI，浏览器（mock shim）与服务端共用同一份实现，
 * 保证真实/mock 输出形状一致（任务书 §九）。
 *
 * 产出为安全 HTML（lib/imports/html.ts 全量转义）。
 * 预算：单文本文件 ≤200KB（入口校验）；输出 ≤10 万字符（enforceOutputBudget）。
 */
import { IMPORT_MAX_TEXT_BYTES } from "./budgets";
import { ImportError } from "./errors";
import { enforceOutputBudget, h, makeExcerpt, titleFromFileName } from "./html";
import type { ExtractedDocument } from "./types";

export function decodeUtf8(bytes: Uint8Array, fileName: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportError("not-utf8", `「${fileName}」不是 UTF-8 编码文本，请转换编码后重试`);
  }
}

// ---------- Markdown（保留层级与列表的轻量转换，不承诺完整 CommonMark） ----------

const MD_HEADING = /^(#{1,6})\s+(.+)$/;
const MD_UL = /^[-*•]\s+/;
const MD_OL = /^\d+[.、)]\s+/;

export function markdownToHtml(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const parts: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushList = () => {
    if (list) { parts.push(h.list(list.tag, list.items)); list = null; }
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      parts.push(h.paragraph(paragraph.join("\n")));
      paragraph = [];
    }
  };

  // 管道表格：| a | b | 行 + |---|---| 分隔行（mammoth convertToMarkdown 的表格形态）
  const isTableLine = (line: string) => line.trim().startsWith("|") && line.trim().endsWith("|");
  const isTableDivider = (line: string) => /^\|[\s\-:|]+\|$/.test(line.trim());
  const parseTableRow = (line: string) =>
    line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) { flushList(); flushParagraph(); continue; }

    // 表格块（当前行是表格行且下一行是分隔行）
    if (isTableLine(trimmed) && i + 1 < lines.length && isTableDivider(lines[i + 1].trim())) {
      flushList(); flushParagraph();
      const header = parseTableRow(trimmed);
      const rows = [header];
      i += 2; // 跳过表头与分隔行
      while (i < lines.length && isTableLine(lines[i].trim())) {
        rows.push(parseTableRow(lines[i].trim()));
        i++;
      }
      i--; // 回退到最后一行表格行（for 会 ++）
      parts.push(h.table(rows));
      continue;
    }

    const heading = trimmed.match(MD_HEADING);
    if (heading) {
      flushList(); flushParagraph();
      // 阅读页大标题是条目名：正文层级整体降一档（# → h2，## 及以下 → h3）
      parts.push(h.heading(heading[1].length === 1 ? 2 : 3, heading[2].trim()));
      continue;
    }
    if (MD_UL.test(trimmed)) {
      flushParagraph();
      if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
      list.items.push(trimmed.replace(MD_UL, ""));
      continue;
    }
    if (MD_OL.test(trimmed)) {
      flushParagraph();
      if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
      list.items.push(trimmed.replace(MD_OL, ""));
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushList(); flushParagraph();
  return parts;
}

// ---------- CSV（保留表格结构，不压成摘要） ----------

export function csvToHtml(text: string): string[] {
  const rows = parseCsvRows(text);
  if (!rows.length) throw new ImportError("parse-failed", "CSV 没有有效数据行");
  return [h.table(rows)];
}

/** 极简 CSV 解析：支持引号包裹、转义双引号、逗号/制表符分隔；不把整表压成摘要。 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === "," || ch === "\t") { pushField(); continue; }
    if (ch === "\n") { pushRow(); continue; }
    if (ch === "\r") { if (text[i + 1] === "\n") i++; pushRow(); continue; }
    field += ch;
  }
  pushRow();
  return rows;
}

// ---------- JSON（保留键值层级，不编造计算值） ----------

export function jsonToHtml(text: string): string[] {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new ImportError("corrupted", "JSON 解析失败：文件可能损坏或不是合法 JSON"); }
  const parts: string[] = [];
  const walk = (node: unknown, depth: number): string => {
    if (node === null) return "null";
    if (typeof node === "number" || typeof node === "boolean") return String(node);
    if (typeof node === "string") return node;
    if (Array.isArray(node)) {
      if (depth > 6) return `[数组 ×${node.length}]`;
      const items = node.slice(0, 500).map((item) => walk(item, depth + 1));
      return items.join("；");
    }
    if (typeof node === "object") {
      if (depth > 6) return "{…}";
      return Object.entries(node as Record<string, unknown>)
        .map(([key, val]) => `${key}：${walk(val, depth + 1)}`)
        .join("；");
    }
    return "";
  };
  if (Array.isArray(value) && value.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
    // 对象数组 → 表格（列 = 键并集），保留表格结构
    const keys = Array.from(new Set(value.flatMap((v) => Object.keys(v as object))));
    if (keys.length && keys.length <= 12) {
      const rows = [keys, ...value.map((v) => keys.map((k) => walk((v as Record<string, unknown>)[k], 1)))];
      parts.push(h.table(rows));
      return parts;
    }
  }
  parts.push(h.paragraph(walk(value, 0)));
  return parts;
}

// ---------- 入口 ----------

export interface TextExtractInput {
  fileName: string;
  bytes: Uint8Array;
}

/** 纯文本路径解析：text / markdown / csv / json。image / audio 无正文（原件直存）。 */
export function extractTextDocument(
  kind: "text" | "markdown" | "csv" | "json",
  input: TextExtractInput,
): ExtractedDocument {
  const { fileName, bytes } = input;
  if (kind === "text" || kind === "markdown") {
    if (bytes.byteLength > IMPORT_MAX_TEXT_BYTES) {
      throw new ImportError("too-large", `「${fileName}」超过文本文件 200KB 上限，请拆分后导入`);
    }
  }
  const text = decodeUtf8(bytes, fileName);
  if (!text.trim()) throw new ImportError("empty", `「${fileName}」没有可导入的文字内容`);

  let parts: string[];
  if (kind === "markdown") parts = markdownToHtml(text);
  else if (kind === "csv") parts = csvToHtml(text);
  else if (kind === "json") parts = jsonToHtml(text);
  else parts = text.split(/\r?\n\s*\r?\n/).filter((p) => p.trim()).map((p) => h.paragraph(p.trim()));

  const html = enforceOutputBudget(parts);
  // 标题：markdown 取首个标题/非空行；其余取文件名
  let title = titleFromFileName(fileName);
  if (kind === "markdown") {
    for (const line of text.split(/\r?\n/)) {
      const m = line.trim().match(MD_HEADING);
      const candidate = (m ? m[2] : line).trim();
      if (candidate) { title = candidate.slice(0, 120); break; }
    }
  }
  return { title, html, excerpt: makeExcerpt(text, title) };
}
