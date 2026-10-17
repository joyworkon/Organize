import { describe, expect, it } from "vitest";
import type { Favorite, FavoriteTargetType, Note, ReadingItem, Task } from "@organize/shared";
import { attachFavoriteItems, type FavoriteWithItem } from "./favorites-load";

const fav = (target_type: FavoriteTargetType, target_id: string): Favorite => ({
  id: `fav-${target_type}-${target_id}`,
  user_id: "u1",
  target_type,
  target_id,
  created_at: "2026-10-17T00:00:00Z",
});

const readingItem = (id: string): ReadingItem => ({
  id,
  user_id: "u1",
  url: `https://example.com/${id}`,
  title: `文章 ${id}`,
  content: null,
  excerpt: null,
  cover_image: null,
  reading_status: "unread",
  reading_progress: 0,
  started_reading_at: null,
  completed_reading_at: null,
  created_at: "2026-10-17T00:00:00Z",
  updated_at: "2026-10-17T00:00:00Z",
});

const noteItem = (id: string): Note => ({
  id,
  user_id: "u1",
  title: `笔记 ${id}`,
  content: null,
  reading_item_id: null,
  created_at: "2026-10-17T00:00:00Z",
  updated_at: "2026-10-17T00:00:00Z",
});

const taskItem = (id: string): Task => ({
  id,
  user_id: "u1",
  title: `任务 ${id}`,
  description: null,
  status: "todo",
  priority: "medium",
  category: "work",
  due_date: null,
  estimated_minutes: null,
  actual_minutes: null,
  reading_item_id: null,
  note_id: null,
  is_pinned: false,
  sort_order: 0,
  completed_at: null,
  created_at: "2026-10-17T00:00:00Z",
  updated_at: "2026-10-17T00:00:00Z",
});

describe("attachFavoriteItems", () => {
  it("三类查询都成功时按类型把 item 挂到对应收藏上", () => {
    const favList = [fav("reading", "r1"), fav("note", "n1"), fav("task", "t1")];

    const { favorites, failedTypes } = attachFavoriteItems(favList, {
      reading: { data: [readingItem("r1")], error: null },
      note: { data: [noteItem("n1")], error: null },
      task: { data: [taskItem("t1")], error: null },
    });

    expect(failedTypes.size).toBe(0);
    expect(favorites[0].item).toEqual(readingItem("r1"));
    expect(favorites[1].item).toEqual(noteItem("n1"));
    expect(favorites[2].item).toEqual(taskItem("t1"));
    favorites.forEach((f) => expect(f.itemLoadFailed).toBeUndefined());
  });

  it("某类查询 error 时该类收藏标记为加载失败（不当成已删除），其它类正常挂载", () => {
    const favList = [fav("reading", "r1"), fav("note", "n1"), fav("task", "t1")];

    const { favorites, failedTypes } = attachFavoriteItems(favList, {
      reading: { data: null, error: { message: "boom" } },
      note: { data: [noteItem("n1")], error: null },
      task: { data: [taskItem("t1")], error: null },
    });

    expect(Array.from(failedTypes)).toEqual(["reading"]);
    expect(favorites[0].item).toBeUndefined();
    expect(favorites[0].itemLoadFailed).toBe(true);
    // 其它类不受影响
    expect(favorites[1].item).toEqual(noteItem("n1"));
    expect(favorites[1].itemLoadFailed).toBeUndefined();
    expect(favorites[2].item).toEqual(taskItem("t1"));
    expect(favorites[2].itemLoadFailed).toBeUndefined();
  });

  it("查询成功但缺某条（真被删）时不挂 item、不标记加载失败", () => {
    const favList = [fav("note", "n1"), fav("note", "n-gone")];

    const { favorites, failedTypes } = attachFavoriteItems(favList, {
      reading: { data: [], error: null },
      note: { data: [noteItem("n1")], error: null },
      task: { data: [], error: null },
    });

    expect(failedTypes.size).toBe(0);
    expect(favorites[0].item).toEqual(noteItem("n1"));
    expect(favorites[1].item).toBeUndefined();
    expect(favorites[1].itemLoadFailed).toBeUndefined();
  });

  it("空 id 列表（Promise.resolve({ data: [] })，无 error 字段）时正常处理", () => {
    const favList: FavoriteWithItem[] = [];

    const { favorites, failedTypes } = attachFavoriteItems(favList, {
      reading: { data: [] },
      note: { data: [] },
      task: { data: [] },
    });

    expect(favorites).toEqual([]);
    expect(failedTypes.size).toBe(0);
  });
});
