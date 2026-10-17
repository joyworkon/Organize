import { describe, expect, it } from "vitest";
import type { TagColor } from "@organize/shared";
import { buildTagCounts, type TagLinkResult, type TagRow } from "./tag-counts";

const tagRow = (id: string, name: string, color?: TagColor | null): TagRow => ({
  id,
  name,
  color: color ?? null,
});

const ok = (tagIds: string[]): TagLinkResult => ({
  data: tagIds.map((tag_id) => ({ tag_id })),
  error: null,
});

const failed: TagLinkResult = { data: null, error: { message: "boom" } };

describe("buildTagCounts", () => {
  it("四类都成功时计数正确：同一标签多条关联累加、无关联标签全 0、color 缺省 blue", () => {
    const { tags, countsFailed } = buildTagCounts(
      [tagRow("t1", "工作", "red"), tagRow("t2", "稍后读"), tagRow("t3", "没人用")],
      "u1",
      {
        reading: ok(["t1", "t1", "t2"]),
        note: ok(["t1", "t2", "t2", "t2"]),
        task: ok(["t1"]),
        lesson: ok([]),
      }
    );

    expect(countsFailed).toBe(false);
    expect(tags).toHaveLength(3);
    const byId = Object.fromEntries(tags.map((t) => [t.id, t]));
    expect(byId.t1).toMatchObject({
      user_id: "u1",
      name: "工作",
      color: "red",
      reading_item_count: 2,
      note_count: 1,
      task_count: 1,
      lesson_count: 0,
    });
    expect(byId.t2).toMatchObject({
      color: "blue",
      reading_item_count: 1,
      note_count: 3,
      task_count: 0,
      lesson_count: 0,
    });
    expect(byId.t3).toMatchObject({
      color: "blue",
      reading_item_count: 0,
      note_count: 0,
      task_count: 0,
      lesson_count: 0,
    });
  });

  it("某一类 error 时 countsFailed 为 true，标签仍照常返回", () => {
    const { tags, countsFailed } = buildTagCounts([tagRow("t1", "工作")], "u1", {
      reading: ok(["t1", "t1"]),
      note: failed,
      task: ok([]),
      lesson: ok([]),
    });

    expect(countsFailed).toBe(true);
    expect(tags).toHaveLength(1);
    // 失败类计数按 0 兜底，但调用方应据 countsFailed 显示「使用数加载失败」而非数字
    expect(tags[0]).toMatchObject({ name: "工作", reading_item_count: 2, note_count: 0 });
  });

  it("四类都成功（无 error 字段的空结果也算成功）时 countsFailed 为 false", () => {
    const { countsFailed } = buildTagCounts([tagRow("t1", "工作")], "u1", {
      reading: { data: [] },
      note: { data: null, error: null },
      task: { data: [] },
      lesson: { data: [] },
    });

    expect(countsFailed).toBe(false);
  });

  it("tagRows 为空时返回空数组", () => {
    const { tags, countsFailed } = buildTagCounts([], "u1", {
      reading: ok(["x"]),
      note: ok([]),
      task: failed,
      lesson: ok([]),
    });

    expect(tags).toEqual([]);
    // 标签列表为空时计数失败无所谓显示，但状态仍如实返回
    expect(countsFailed).toBe(true);
  });
});
