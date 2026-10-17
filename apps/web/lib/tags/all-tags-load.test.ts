import { describe, expect, it } from "vitest";
import type { TagWithCount } from "@organize/shared";
import {
  TAGS_EMPTY_MESSAGE,
  TAGS_LOAD_ERROR_MESSAGE,
  nextAllTagsAfterLoad,
  shouldShowTagsEmpty,
  tagsEmptyMessage,
} from "./all-tags-load";

function tag(id: string, name: string): TagWithCount {
  return { id, user_id: "u1", name, note_count: 0, reading_item_count: 0 };
}

describe("nextAllTagsAfterLoad", () => {
  it("成功时整体替换并清除错误", () => {
    const previous = [tag("t1", "旧标签")];
    const fresh = [tag("t2", "新标签"), tag("t3", "另一标签")];

    const next = nextAllTagsAfterLoad(previous, { ok: true, tags: fresh });

    expect(next).toEqual({ tags: fresh, loadError: null });
  });

  it("失败时保留上次成功的数据并记录错误", () => {
    const previous = [tag("t1", "旧标签")];

    const next = nextAllTagsAfterLoad(previous, { ok: false, error: "标签加载失败（HTTP 500）" });

    expect(next.tags).toEqual(previous);
    expect(next.loadError).toBe("标签加载失败（HTTP 500）");
  });

  it("从未成功过的失败：列表为空且标记错误", () => {
    const next = nextAllTagsAfterLoad([], { ok: false, error: "标签加载失败" });

    expect(next).toEqual({ tags: [], loadError: "标签加载失败" });
  });
});

describe("shouldShowTagsEmpty", () => {
  it("无错误、非加载中、列表为空才是真的没有标签", () => {
    expect(shouldShowTagsEmpty([], null, false)).toBe(true);
  });

  it("有 loadError 时不显示「还没有标签」", () => {
    expect(shouldShowTagsEmpty([], "标签加载失败（HTTP 500）", false)).toBe(false);
  });

  it("加载中不显示「还没有标签」", () => {
    expect(shouldShowTagsEmpty([], null, true)).toBe(false);
  });

  it("列表非空时不显示空态", () => {
    expect(shouldShowTagsEmpty([tag("t1", "x")], null, false)).toBe(false);
    expect(shouldShowTagsEmpty([tag("t1", "x")], "标签加载失败", false)).toBe(false);
  });
});

describe("tagsEmptyMessage", () => {
  it("无错误时是「还没有标签」", () => {
    expect(tagsEmptyMessage(null)).toBe(TAGS_EMPTY_MESSAGE);
    expect(tagsEmptyMessage(null)).toBe("还没有标签");
  });

  it("有 loadError 时文案是加载失败，不出现「还没有标签」", () => {
    const message = tagsEmptyMessage("标签加载失败（HTTP 500）");
    expect(message).toBe(TAGS_LOAD_ERROR_MESSAGE);
    expect(message).not.toContain(TAGS_EMPTY_MESSAGE);
  });
});
