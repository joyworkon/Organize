export const FAVORITE_CHECK_ERROR_TITLE = "收藏状态读取失败，点击重试";

/** favorites 存在性查询（.maybeSingle()）的最小结果形状，便于纯函数测试注入 */
export interface FavoriteCheckInput {
  data: unknown;
  error: unknown;
}

export type FavoriteCheckResult =
  | { ok: true; favorited: boolean }
  | { ok: false; message: string };

/**
 * maybeSingle() 在「没有这行」时返回 { data: null, error: null }——那是真的未收藏；
 * 只有 error 非空才算读取失败，不得降级成未收藏展示。
 */
export function resolveFavoriteCheck({
  data,
  error,
}: FavoriteCheckInput): FavoriteCheckResult {
  if (error) {
    return { ok: false, message: FAVORITE_CHECK_ERROR_TITLE };
  }
  return { ok: true, favorited: !!data };
}
