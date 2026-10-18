import { describe, expect, it } from "vitest";
import type { Tag } from "@organize/shared";
import { nextResourceTagsAfterLoad } from "./resource-tags-load";

function tag(id: string, name: string): Tag {
  return { id, user_id: "u1", name };
}

describe("nextResourceTagsAfterLoad", () => {
  it("成功时替换列表并清除错误", () => {
    const previous = [tag("t1", "旧标签")];
    const fresh = [tag("t2", "新标签"), tag("t3", "另一标签")];

    const next = nextResourceTagsAfterLoad(previous, { ok: true, tags: fresh });

    expect(next).toEqual({ tags: fresh, loadError: null });
  });

  it("失败时保留上次成功列表并记录错误", () => {
    const previous = [tag("t1", "旧标签")];

    const next = nextResourceTagsAfterLoad(previous, {
      ok: false,
      error: "标签读取失败（HTTP 500）",
    });

    expect(next).toEqual({ tags: previous, loadError: "标签读取失败（HTTP 500）" });
  });

  it("从未成功过的失败返回空列表和错误", () => {
    const next = nextResourceTagsAfterLoad([], { ok: false, error: "标签读取失败" });

    expect(next).toEqual({ tags: [], loadError: "标签读取失败" });
  });

  it("失败时返回 previous 的同一引用", () => {
    const previous = [tag("t1", "旧标签")];

    const next = nextResourceTagsAfterLoad(previous, { ok: false, error: "网络错误" });

    expect(next.tags).toBe(previous);
  });

  it("成功返回空列表时仍为成功且无错误", () => {
    const previous = [tag("t1", "旧标签")];

    const next = nextResourceTagsAfterLoad(previous, { ok: true, tags: [] });

    expect(next).toEqual({ tags: [], loadError: null });
  });
});
