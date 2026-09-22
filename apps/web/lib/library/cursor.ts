/**
 * 资料库统一列表的稳定游标编解码（纯函数，/api/library/items 与 mock shim 共用）。
 *
 * 排序语义（089 library_items RPC）：created_at DESC, source_type ASC, id ASC，
 * 游标 = 上一页末行的 (created_at, source_type, id) 三元组。
 * 编码格式：版本前缀 + base64url(JSON)，带版本前缀便于将来换格式时优雅降级。
 */

export const LIBRARY_CURSOR_PREFIX = "lib1.";

export interface LibraryCursor {
  created_at: string;
  source_type: string;
  id: string;
}

const SOURCE_TYPES = new Set(["reading", "memo"]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

export class LibraryCursorError extends Error {}

function assertValid(cursor: LibraryCursor): void {
  if (!ISO_RE.test(cursor.created_at)) {
    throw new LibraryCursorError("cursor.created_at 无效");
  }
  if (!SOURCE_TYPES.has(cursor.source_type)) {
    throw new LibraryCursorError("cursor.source_type 无效");
  }
  // id 在真实路由是 uuid（PostgREST 对 p_cursor_id 参数强转，非法值天然 400）；
  // mock 种子的 id 是 "item-1" 形态，这里只要求非空短字符串
  if (!cursor.id || cursor.id.length > 64) {
    throw new LibraryCursorError("cursor.id 无效");
  }
}

export function encodeLibraryCursor(cursor: LibraryCursor): string {
  assertValid(cursor);
  const json = JSON.stringify({
    c: cursor.created_at,
    s: cursor.source_type,
    i: cursor.id,
  });
  const base64 = typeof btoa !== "undefined"
    ? btoa(json)
    : Buffer.from(json, "utf-8").toString("base64");
  return LIBRARY_CURSOR_PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 解码游标。null/空串返回 null（第一页）；格式错误抛 LibraryCursorError（路由转 400）。
 */
export function decodeLibraryCursor(raw: string | null): LibraryCursor | null {
  if (raw === null || raw === "") return null;
  if (!raw.startsWith(LIBRARY_CURSOR_PREFIX)) {
    throw new LibraryCursorError("cursor 版本不支持");
  }
  const body = raw.slice(LIBRARY_CURSOR_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
  let json: string;
  try {
    json = typeof atob !== "undefined"
      ? atob(body)
      : Buffer.from(body, "base64").toString("utf-8");
  } catch {
    throw new LibraryCursorError("cursor 无法解码");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new LibraryCursorError("cursor 不是有效 JSON");
  }
  const value = parsed as Record<string, unknown>;
  const cursor: LibraryCursor = {
    created_at: String(value?.c ?? ""),
    source_type: String(value?.s ?? ""),
    id: String(value?.i ?? ""),
  };
  assertValid(cursor);
  return cursor;
}
