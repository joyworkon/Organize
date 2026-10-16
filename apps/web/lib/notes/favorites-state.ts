/**
 * 笔记收藏状态纯函数（N04 列表批量收藏 + 卡片回退共用）。
 * 失败路径必须诚实：加载失败保留旧值（不清空星星）、写失败保持现状（星星不得
 * 停在与服务器相反的一侧），供列表页与卡片接线并对失败语义写单测。
 */

/**
 * 收藏状态查询结果归并。查询失败必须保留旧值：
 * 把失败当空集清空星星，等于向用户谎报「全部未收藏」。
 */
export function favoriteIdsAfterLoad(
  prev: ReadonlySet<string>,
  query: { data: { target_id: string }[] | null; error: { message: string } | null }
): Set<string> {
  if (query.error) return new Set(prev);
  return new Set((query.data ?? []).map((row) => row.target_id));
}

/**
 * 收藏切换后的本地状态。写失败返回 null：调用方保持现状，
 * 不得让星星停在与服务器相反的一侧。
 */
export function favoriteIdsAfterToggle(
  prev: ReadonlySet<string>,
  id: string,
  writeFailed: boolean
): Set<string> | null {
  if (writeFailed) return null;
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** 收藏切换失败文案：按点击时状态区分方向，不用含糊的「操作失败」 */
export function favoriteToggleFailureTitle(wasFavorited: boolean): string {
  return wasFavorited ? "取消收藏失败" : "收藏失败";
}
