/**
 * 集合条目 API（/api/collections/[id]/items）POST 写路径的错误分类（纯函数，供 route 使用）。
 *
 * 诚实性约定（collections-items-api-honesty）：
 * - upsert collection_items 失败：23503（外键，来源不存在/不可访问）→ 400 明确文案；
 *   其它错误返回 null，由 route 走 serverError（500 通用文案，不回显 error.message）。
 * - 集合存在校验：查询 error → "error"（route 走 serverError，不得把 DB 错误伪装成 404）；
 *   无行 → "missing"（404「集合不存在」）；有行 → "ok"。
 */

export const COLLECTION_ITEM_SOURCE_MISSING_MESSAGE = "来源不存在或不可访问";

export interface CollectionItemUpsertClientError {
  status: 400;
  error: string;
}

/** upsert 失败分类：仅 23503 对客户端有意义（400）；其它返回 null 交给 serverError。 */
export function classifyCollectionItemUpsertError(
  error: { code?: string; message?: string } | null,
): CollectionItemUpsertClientError | null {
  if (error?.code === "23503") {
    return { status: 400, error: COLLECTION_ITEM_SOURCE_MISSING_MESSAGE };
  }
  return null;
}

export type CollectionExistsQueryResult = "ok" | "missing" | "error";

/** 集合存在校验分类：DB/网络错误与「不存在」必须区分开。 */
export function classifyCollectionExistsQuery(result: {
  data: unknown;
  error: unknown;
}): CollectionExistsQueryResult {
  if (result.error) return "error";
  if (!result.data) return "missing";
  return "ok";
}
