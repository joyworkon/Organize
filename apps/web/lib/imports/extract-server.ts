/**
 * 服务端导入解析（阶段 D）——PDF / DOCX / XLSX。
 *
 * 全部经动态 import 引入，保证浏览器 bundle（mock shim 只 import extract-text）
 * 不会拉进 pdfjs / mammoth / xlsx。仅允许在 API route（Node runtime）调用。
 *
 * 预算执行（任务 0 定稿，超限明确失败不静默截断）：
 *   PDF ≤200 页；zip 解压后 ≤50MB（防 zip bomb）；XLSX ≤50 工作表 / ≤10 万单元格；
 *   输出 ≤10 万字符（enforceOutputBudget）。
 * 失败分类（lib/imports/errors.ts）：加密 → encrypted；损坏 → corrupted；
 *   扫描型 PDF（无文本层）→ scanned（原件仍保存，不伪造正文）。
 */
import {
  IMPORT_MAX_CELLS,
  IMPORT_MAX_DECOMPRESSED_BYTES,
  IMPORT_MAX_PDF_PAGES,
  IMPORT_MAX_SHEETS,
} from "./budgets";
import { ImportError, isImportError, toImportError } from "./errors";
import { extractTextDocument } from "./extract-text";
import { enforceOutputBudget, h, makeExcerpt, titleFromFileName } from "./html";
import { sanitizeDocHtml } from "./sanitize-doc-html";
import type { ImportKind } from "./types";

export interface ServerExtractInput {
  fileName: string;
  bytes: Uint8Array;
}

/** DOCX 嵌入图片（纳入资产管理：由路由上传到 import-files 桶） */
export interface EmbeddedImage {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ServerExtractedDocument {
  title: string;
  html: string;
  excerpt: string;
  pageCount?: number;
  embeddedImages: EmbeddedImage[];
}

/** zip 中央目录扫描：汇总解压后体积（防 zip bomb；zip64 拒绝） */
export function zipDecompressedSize(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD 固定 22 字节 + 注释；从尾部向前扫描 0x06054b50
  const minEocd = Math.max(0, bytes.byteLength - 22 - 65536);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportError("corrupted", "不是有效的 XLSX 文件（缺少 zip 目录）");
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  let total = 0;
  for (let n = 0; n < entryCount; n++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new ImportError("corrupted", "XLSX 压缩包目录损坏");
    }
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw new ImportError("too-large", "XLSX 使用 zip64 格式，超出导入预算，请拆分后导入");
    }
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    total += uncompressed;
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

// ---------- PDF ----------

async function extractPdf(input: ServerExtractInput): Promise<ServerExtractedDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: input.bytes,
    useSystemFonts: true,
    disableFontFace: true,
  });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    if (name === "PasswordException") {
      throw new ImportError("encrypted", `「${input.fileName}」是加密 PDF，请解除密码后重试`);
    }
    if (name === "InvalidPDFException") {
      throw new ImportError("corrupted", `「${input.fileName}」不是有效的 PDF 文件`);
    }
    throw toImportError(error, "PDF 解析失败");
  }

  try {
    if (doc.numPages > IMPORT_MAX_PDF_PAGES) {
      throw new ImportError(
        "too-many-pages",
        `「${input.fileName}」共 ${doc.numPages} 页，超过 ${IMPORT_MAX_PDF_PAGES} 页预算，请拆分后导入`,
      );
    }

    let metaTitle = "";
    try {
      const meta = await doc.getMetadata();
      const info = (meta as unknown as { info?: Record<string, unknown> }).info ?? {};
      const title = typeof info["Title"] === "string" ? info["Title"].trim() : "";
      if (title && !/^\s*(untitled|无标题)/i.test(title)) metaTitle = title.slice(0, 120);
    } catch { /* 元数据缺失不阻断 */ }

    const parts: string[] = [];
    const plainParts: string[] = [];
    let totalChars = 0;
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? (item as { str: string }).str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      totalChars += text.length;
      // 保留页码对应信息（任务书 §八）
      parts.push(h.heading(3, `第 ${pageNo} 页`));
      parts.push(h.paragraph(text || "（本页无文本）"));
      plainParts.push(text);
    }

    if (totalChars < 30) {
      throw new ImportError(
        "scanned",
        `「${input.fileName}」是扫描型 PDF（没有可提取的文本层），需要 OCR 才能提取正文；原件已保存，可稍后重试或先用 OCR 工具转换`,
      );
    }

    const title = metaTitle || titleFromFileName(input.fileName);
    const html = enforceOutputBudget(parts);
    return {
      title,
      html,
      excerpt: makeExcerpt(plainParts.join(" "), title),
      pageCount: doc.numPages,
      embeddedImages: [],
    };
  } finally {
    void loadingTask.destroy();
  }
}

// ---------- DOCX ----------

async function extractDocx(input: ServerExtractInput): Promise<ServerExtractedDocument> {
  const mammoth = (await import("mammoth")).default;
  const buffer = Buffer.from(input.bytes);
  const embeddedImages: EmbeddedImage[] = [];

  // convertToHtml 一遍完成：内容 + 嵌入图片收集（imgElement 拦截字节，src 占位符
  // 随后被白名单消毒器剥掉）；externalFileAccess 全禁（任务 0 选型：防目录穿越）
  let html: string;
  try {
    const result = await mammoth.convertToHtml({ buffer }, {
      externalFileAccess: { allowNetwork: false, allowFileSystem: false },
      convertImage: mammoth.images.imgElement(async (image) => {
        const bytes = new Uint8Array(await image.readAsArrayBuffer());
        embeddedImages.push({
          name: `嵌入图片 ${embeddedImages.length + 1}`,
          mime: image.contentType || "image/png",
          bytes,
        });
        return { src: "organize-embedded-image://" };
      }),
    });
    if (!result.value.trim()) {
      throw new ImportError("parse-failed", `「${input.fileName}」没有可提取的文字内容`);
    }
    html = sanitizeDocHtml(result.value);
  } catch (error) {
    if (isImportError(error)) throw error;
    throw toImportError(error, "DOCX 解析失败（文件可能损坏）");
  }

  const title = titleFromFileName(input.fileName);
  const parts = [html];
  if (embeddedImages.length) {
    parts.push(h.paragraph(`（本文档含 ${embeddedImages.length} 张嵌入图片，已存入资料原件）`));
  }
  const finalHtml = enforceOutputBudget(parts);
  const plain = finalHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    title,
    html: finalHtml,
    excerpt: makeExcerpt(plain, title),
    embeddedImages,
  };
}

// ---------- XLSX ----------

async function extractXlsx(input: ServerExtractInput): Promise<ServerExtractedDocument> {
  const decompressed = zipDecompressedSize(input.bytes);
  if (decompressed > IMPORT_MAX_DECOMPRESSED_BYTES) {
    throw new ImportError(
      "too-large",
      `「${input.fileName}」解压后约 ${Math.round(decompressed / 1024 / 1024)}MB，超过 50MB 预算，请拆分后导入`,
    );
  }

  const XLSX = await import("xlsx");
  let workbook: ReturnType<typeof XLSX.read>;
  try {
    workbook = XLSX.read(Buffer.from(input.bytes), { type: "buffer" });
  } catch (error) {
    throw toImportError(error, "XLSX 解析失败（文件可能损坏）");
  }
  if (workbook.SheetNames.length > IMPORT_MAX_SHEETS) {
    throw new ImportError(
      "too-many-sheets",
      `「${input.fileName}」含 ${workbook.SheetNames.length} 个工作表，超过 ${IMPORT_MAX_SHEETS} 个预算，请拆分后导入`,
    );
  }

  const title = titleFromFileName(input.fileName);
  const parts: string[] = [];
  const plainParts: string[] = [];
  let cells = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // raw:false = 按可取得的结果（缓存值/格式化文本）展示，不编造计算值
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1, raw: false, defval: "", blankrows: false,
    });
    cells += rows.reduce((sum, row) => sum + row.length, 0);
    if (cells > IMPORT_MAX_CELLS) {
      throw new ImportError(
        "too-many-cells",
        `「${input.fileName}」单元格超过 ${Math.round(IMPORT_MAX_CELLS / 1000)} 万预算，请拆分工作表后导入`,
      );
    }
    parts.push(h.heading(3, `工作表：${sheetName}`));
    if (rows.length) {
      parts.push(h.table(rows.map((row) => row.map((cell) => String(cell ?? "")))));
      plainParts.push(...rows.slice(0, 10).map((row) => row.join(" ")));
    } else {
      parts.push(h.paragraph("（空工作表）"));
    }
  }

  const html = enforceOutputBudget(parts);
  return {
    title,
    html,
    excerpt: makeExcerpt(plainParts.join(" "), title),
    embeddedImages: [],
  };
}

// ---------- 入口 ----------

/** 纯文本路径直接复用 extract-text（mock shim 与服务端同一实现）。 */
export async function extractServerDocument(
  kind: ImportKind,
  input: ServerExtractInput,
): Promise<ServerExtractedDocument> {
  if (kind === "text" || kind === "markdown" || kind === "csv" || kind === "json") {
    const doc = extractTextDocument(kind, input);
    return { ...doc, embeddedImages: [] };
  }
  if (kind === "pdf") return extractPdf(input);
  if (kind === "docx") return extractDocx(input);
  if (kind === "xlsx") return extractXlsx(input);
  throw new ImportError("unsupported", `「${input.fileName}」格式暂不支持提取正文，仅保存原件`);
}
