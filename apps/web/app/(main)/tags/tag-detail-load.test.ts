import { describe, expect, it } from "vitest";
import type { LessonWithTags, NoteWithTags, ReadingItem, Tag, TaskWithTags } from "@organize/shared";
import { buildTagDetailItems, type DetailLoadResult } from "./tag-detail-load";

const ok = <T,>(data: T[]): DetailLoadResult<T> => ({ data, error: null });
const emptyOk = <T,>(): DetailLoadResult<T> => ({ data: [] });
const failed = <T,>(message = "boom"): DetailLoadResult<T> => ({ data: null, error: { message } });

const tag = (id: string, name: string): Tag => ({ id, user_id: "u1", name, color: "blue" });

const reading = (id: string): ReadingItem => ({
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
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const note = (id: string, tags: Tag[]): NoteWithTags => ({
  id,
  user_id: "u1",
  title: `笔记 ${id}`,
  content: null,
  reading_item_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  tags,
});

const task = (id: string): TaskWithTags => ({
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
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const lesson = (id: string): LessonWithTags => ({
  id,
  user_id: "u1",
  title: `复盘 ${id}`,
  content: null,
  lesson_type: "reflection",
  task_id: null,
  reading_item_id: null,
  note_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const allOk = () => ({
  itemLinks: ok([{ item_id: "r1" }, { item_id: "r2" }]),
  noteLinks: ok([{ note_id: "n1" }]),
  taskLinks: ok([{ task_id: "t1" }, { task_id: "t2" }]),
  lessonLinks: ok([{ lesson_id: "l1" }]),
  readings: ok([reading("r1"), reading("r2")]),
  // notes 查询带 tags join，tags 徽章直接来自实体行
  notes: ok([note("n1", [tag("tg1", "工作"), tag("tg2", "稍后读")])]),
  tasks: ok([task("t1"), task("t2")]),
  lessons: ok([lesson("l1")]),
  taskTagLinks: ok([
    { task_id: "t1", tag_id: "tg1" },
    { task_id: "t1", tag_id: "tg2" },
    // tagMap 未命中的关联（对应 tag 已被删）按原逻辑忽略，不产生幽灵徽章
    { task_id: "t2", tag_id: "tg404" },
  ]),
  lessonTagLinks: ok([{ lesson_id: "l1", tag_id: "tg2" }]),
  allTags: ok([tag("tg1", "工作"), tag("tg2", "稍后读")]),
});

describe("buildTagDetailItems", () => {
  it("四类关联 + 实体都成功时 items 正确，任务/复盘挂上 tags 徽章且 loadError 为 null", () => {
    const { items, loadError } = buildTagDetailItems(allOk());

    expect(loadError).toBeNull();
    expect(items.readings.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(items.notes).toHaveLength(1);
    expect(items.notes[0].tags?.map((t) => t.id)).toEqual(["tg1", "tg2"]);
    expect(items.tasks).toHaveLength(2);
    expect(items.tasks[0].id).toBe("t1");
    expect(items.tasks[0].tags?.map((t) => t.id)).toEqual(["tg1", "tg2"]);
    expect(items.tasks[1].id).toBe("t2");
    expect(items.tasks[1].tags).toEqual([]);
    expect(items.lessons).toHaveLength(1);
    expect(items.lessons[0].tags?.map((t) => t.id)).toEqual(["tg2"]);
  });

  it("某一类关联查询 error 时 loadError 非空（取 error.message）", () => {
    const results = allOk();
    results.noteLinks = failed("note_tags down");

    const { loadError } = buildTagDetailItems(results);

    expect(loadError).toBe("note_tags down");
  });

  it("某一类实体查询 error 时 loadError 非空", () => {
    const results = allOk();
    results.readings = failed();

    const { loadError } = buildTagDetailItems(results);

    expect(loadError).toBe("boom");
  });

  it("allTags 或二次 tag link 查询 error 时 loadError 非空（否则任务/复盘会丢标签徽章）", () => {
    const tagsFail = allOk();
    tagsFail.allTags = failed("tags down");
    expect(buildTagDetailItems(tagsFail).loadError).toBe("tags down");

    const taskLinkFail = allOk();
    taskLinkFail.taskTagLinks = failed();
    expect(buildTagDetailItems(taskLinkFail).loadError).toBe("boom");

    const lessonLinkFail = allOk();
    lessonLinkFail.lessonTagLinks = failed();
    expect(buildTagDetailItems(lessonLinkFail).loadError).toBe("boom");
  });

  it("全部成功且无关联 id（空 id 分支不发请求）时 items 全为空数组、loadError 为 null", () => {
    const { items, loadError } = buildTagDetailItems({
      itemLinks: emptyOk(),
      noteLinks: emptyOk(),
      taskLinks: emptyOk(),
      lessonLinks: emptyOk(),
      // 空 id 时页面传的是 Promise.resolve({ data: [] })（无 error 字段），也算成功空集
      readings: { data: [] },
      notes: { data: [] },
      tasks: { data: [] },
      lessons: { data: [] },
      taskTagLinks: { data: [] },
      lessonTagLinks: { data: [] },
      allTags: ok([]),
    });

    expect(loadError).toBeNull();
    expect(items).toEqual({ readings: [], notes: [], tasks: [], lessons: [] });
  });

  it("error 无 message 时 loadError 用默认文案兜底", () => {
    const results = allOk();
    results.lessonLinks = { data: null, error: { message: "" } };

    const { loadError } = buildTagDetailItems(results);

    expect(loadError).toBe("加载标签内容失败");
  });
});
