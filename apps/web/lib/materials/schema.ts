import type { MaterialBlock, MaterialRequest, MaterialResult } from "@organize/plugin-sdk";

export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;
export const MAX_MATERIAL_TEXT = 40_000;
export const MAX_MATERIAL_FILES = 6;
export const MATERIAL_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json,.mp3,.wav,.m4a,.ogg,.webm";
const IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const AUDIO = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg"]);
const TEXT = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", webm: "audio/webm",
};

export function materialMime(file: Pick<File, "name" | "type">): string {
  const mime = file.type.split(";")[0].toLowerCase();
  return IMAGES.has(mime) || AUDIO.has(mime) || TEXT.has(mime)
    ? mime : MIME_BY_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? mime;
}

export function materialKind(file: Pick<File, "name" | "type">) {
  const mime = materialMime(file);
  if (IMAGES.has(mime)) return "image";
  if (AUDIO.has(mime)) return "audio";
  if (TEXT.has(mime)) return "text";
  return null;
}

export function validateMaterialRequest(request: MaterialRequest): void {
  if (!["extract", "organize"].includes(request.mode)) throw new Error("不支持的整理模式");
  if (!request.files.length && !request.text?.trim()) throw new Error("请添加文件或粘贴文字");
  if (request.files.length > MAX_MATERIAL_FILES) throw new Error("每次最多整理 6 个文件");
  if ((request.text?.length ?? 0) > MAX_MATERIAL_TEXT) throw new Error("文字不能超过 4 万字符，请分批整理");
  if (request.files.reduce((sum, file) => sum + file.size, 0) > MAX_MATERIAL_BYTES) {
    throw new Error("每批文件合计不能超过 20MB");
  }
  for (const file of request.files) {
    if (!file.size) throw new Error(`「${file.name}」为空文件`);
    const kind = materialKind(file);
    if (!kind) throw new Error(`暂不支持「${file.name}」：可整理图片、TXT / Markdown / CSV / JSON 和录音；其他格式请作为附件插入`);
    if (kind === "image" && file.size > 8 * 1024 * 1024) throw new Error(`「${file.name}」超过图片 8MB 上限`);
    if (kind === "text" && file.size > 200_000) throw new Error(`「${file.name}」过大，请拆分文本文件`);
  }
}

/** 同时校验模型和插件返回值，丢弃未定义的属性，不接受任意 TipTap JSON。 */
export function validateMaterialResult(value: unknown): MaterialResult {
  const invalid = () => { throw new Error("整理结果格式不完整，请重试或减少物料"); };
  const string = (v: unknown, max: number): string => {
    if (typeof v !== "string" || !v.trim() || v.length > max) return invalid();
    return v.trim();
  };
  if (!value || typeof value !== "object") return invalid();
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.blocks) || !data.blocks.length || data.blocks.length > 200) return invalid();
  if (!Array.isArray(data.tags) || data.tags.length > 8) return invalid();
  const blocks: MaterialBlock[] = data.blocks.map((raw) => {
    if (!raw || typeof raw !== "object") return invalid();
    const b = raw as Record<string, unknown>;
    if (b.type === "paragraph" || b.type === "heading") return { type: b.type, text: string(b.text, 12_000) };
    if (b.type === "bulletList" || b.type === "orderedList" || b.type === "taskList") {
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100) return invalid();
      return { type: b.type, items: b.items.map((v) => string(v, 4000)) };
    }
    if (b.type === "table") {
      if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 100) return invalid();
      const rows = b.rows.map((row) => {
        if (!Array.isArray(row) || !row.length || row.length > 12) return invalid();
        return row.map((cell) => cell === "" ? "" : string(cell, 2000));
      });
      if (!rows.every((row) => row.length === rows[0].length)) return invalid();
      return { type: "table", rows };
    }
    return invalid();
  });
  const result = {
    title: string(data.title, 120), category: string(data.category, 40),
    tags: data.tags.map((v) => string(v, 30)), blocks,
  };
  if (JSON.stringify(result).length > 120_000) return invalid();
  return result;
}

export function parseMaterialResult(raw: string): MaterialResult {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return validateMaterialResult(JSON.parse(json)); }
  catch { throw new Error("模型未返回完整的整理结果，请重试或减少物料"); }
}
