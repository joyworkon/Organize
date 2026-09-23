/**
 * 集合条目游标（阶段 3，/api/collections/[id]/items 与 mock shim 共用）。
 * 排序语义：created_at DESC, id ASC；游标 = 上一页末行 (created_at, id) 二元组。
 * 编码：col1. 前缀 + base64url(JSON)，与 lib/imports/history-cursor.ts 同款约定。
 */

export const COLLECTION_CURSOR_PREFIX = "col1.";

export interface CollectionCursor {
  created_at: string;
  id: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

export class CollectionCursorError extends Error {}

function assertValid(cursor: CollectionCursor): void {
  if (!ISO_RE.test(cursor.created_at)) throw new CollectionCursorError("cursor.created_at 无效");
  if (!cursor.id || cursor.id.length > 64) throw new CollectionCursorError("cursor.id 无效");
}

export function encodeCollectionCursor(cursor: CollectionCursor): string {
  assertValid(cursor);
  const json = JSON.stringify({ c: cursor.created_at, i: cursor.id });
  const base64 = typeof btoa !== "undefined"
    ? btoa(json)
    : Buffer.from(json, "utf-8").toString("base64");
  return COLLECTION_CURSOR_PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 解码游标。null/空串返回 null（第一页）；格式错误抛 CollectionCursorError（路由转 400）。 */
export function decodeCollectionCursor(raw: string | null): CollectionCursor | null {
  if (raw === null || raw === "") return null;
  if (!raw.startsWith(COLLECTION_CURSOR_PREFIX)) {
    throw new CollectionCursorError("cursor 版本不支持");
  }
  const body = raw.slice(COLLECTION_CURSOR_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
  let json: string;
  try {
    json = typeof atob !== "undefined"
      ? atob(body)
      : Buffer.from(body, "base64").toString("utf-8");
  } catch {
    throw new CollectionCursorError("cursor 无法解码");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CollectionCursorError("cursor 不是有效 JSON");
  }
  const cursor: CollectionCursor = {
    created_at: String((parsed as Record<string, unknown>)?.c ?? ""),
    id: String((parsed as Record<string, unknown>)?.i ?? ""),
  };
  assertValid(cursor);
  return cursor;
}
