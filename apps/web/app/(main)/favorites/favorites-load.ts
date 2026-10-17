import type { Favorite, FavoriteTargetType, Note, ReadingItem, Task } from "@organize/shared";

/** 收藏条目：item 是按类型查回的实体；查询失败时 item 缺失但 itemLoadFailed=true（加载失败 ≠ 已删除） */
export interface FavoriteWithItem extends Favorite {
  item?: ReadingItem | Note | Task;
  itemLoadFailed?: boolean;
}

/** 单类条目查询结果：supabase 的 `{ data, error }`，或空 id 列表时的 `Promise.resolve({ data: [] })` */
export interface ItemLoadResult<T> {
  data: T[] | null;
  error?: { message: string } | null;
}

/**
 * 按类型把条目查询结果挂到收藏上。
 * 某类查询 error 非空时：该类所有收藏标记 itemLoadFailed、不挂 item——渲染成「内容加载失败」，
 * 不能当成已删除；查询成功但查不到的条目（真被删了）不挂 item 也不标记失败。
 */
export function attachFavoriteItems(
  favList: FavoriteWithItem[],
  results: {
    reading: ItemLoadResult<ReadingItem>;
    note: ItemLoadResult<Note>;
    task: ItemLoadResult<Task>;
  }
): { favorites: FavoriteWithItem[]; failedTypes: Set<FavoriteTargetType> } {
  const failedTypes = new Set<FavoriteTargetType>();
  (["reading", "note", "task"] as const).forEach((type) => {
    if (results[type].error) failedTypes.add(type);
  });

  const maps = {
    reading: new Map((results.reading.data ?? []).map((r) => [r.id, r])),
    note: new Map((results.note.data ?? []).map((n) => [n.id, n])),
    task: new Map((results.task.data ?? []).map((t) => [t.id, t])),
  };

  const favorites = favList.map((fav) => ({
    ...fav,
    item: maps[fav.target_type].get(fav.target_id),
    itemLoadFailed: failedTypes.has(fav.target_type) || undefined,
  }));

  return { favorites, failedTypes };
}
