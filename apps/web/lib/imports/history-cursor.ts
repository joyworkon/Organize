/**
 * 文件导入历史分页游标（阶段 1，GET /api/imports 与 mock shim 共用）。
 *
 * 排序语义：created_at DESC, id DESC；游标 = 上一页末行的 (created_at, id) 二元组。
 * 编码格式：版本前缀 + base64url(JSON)，与 lib/library/cursor.ts 同款约定。
 */

export const IMPORT_HISTORY_CURSOR_PREFIX = "imp1.";

export interface ImportHistoryCursor {
  created_at: string;
  id: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

export class ImportHistoryCursorError extends Error {}

function assertValid(cursor: ImportHistoryCursor): void {
  if (!ISO_RE.test(cursor.created_at)) {
    throw new ImportHistoryCursorError("cursor.created_at 无效");
  }
  // id 在真实路由是 uuid，mock 种子是短字符串；只要求非空且长度有界（防注入/滥用）
  if (!cursor.id || cursor.id.length > 64 || /[',()"\\]/.test(cursor.id)) {
    throw new ImportHistoryCursorError("cursor.id 无效");
  }
}

export function encodeImportHistoryCursor(cursor: ImportHistoryCursor): string {
  assertValid(cursor);
  const json = JSON.stringify({ c: cursor.created_at, i: cursor.id });
  const base64 = typeof btoa !== "undefined"
    ? btoa(json)
    : Buffer.from(json, "utf-8").toString("base64");
  return IMPORT_HISTORY_CURSOR_PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 解码游标。null/空串返回 null（第一页）；格式错误抛 ImportHistoryCursorError（路由转 400）。 */
export function decodeImportHistoryCursor(raw: string | null): ImportHistoryCursor | null {
  if (raw === null || raw === "") return null;
  if (!raw.startsWith(IMPORT_HISTORY_CURSOR_PREFIX)) {
    throw new ImportHistoryCursorError("cursor 版本不支持");
  }
  const body = raw.slice(IMPORT_HISTORY_CURSOR_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
  let json: string;
  try {
    json = typeof atob !== "undefined"
      ? atob(body)
      : Buffer.from(body, "base64").toString("utf-8");
  } catch {
    throw new ImportHistoryCursorError("cursor 无法解码");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ImportHistoryCursorError("cursor 不是有效 JSON");
  }
  const value = parsed as Record<string, unknown>;
  const cursor: ImportHistoryCursor = {
    created_at: String(value?.c ?? ""),
    id: String(value?.i ?? ""),
  };
  assertValid(cursor);
  return cursor;
}
