import { describe, it, expect } from "vitest";
import {
  favoriteIdsAfterLoad,
  favoriteIdsAfterToggle,
  favoriteToggleFailureTitle,
} from "./favorites-state";

describe("favoriteIdsAfterLoad", () => {
  it("查询失败保留旧值，不清空星星（不得谎报全员未收藏）", () => {
    const prev = new Set(["a", "b"]);
    const next = favoriteIdsAfterLoad(prev, {
      data: null,
      error: { message: "Failed to fetch" },
    });
    expect(next).toEqual(new Set(["a", "b"]));
    // 返回副本：后续变更不污染旧 Set
    expect(next).not.toBe(prev);
  });

  it("查询成功用服务端结果整体替换", () => {
    const prev = new Set(["a", "b"]);
    const next = favoriteIdsAfterLoad(prev, {
      data: [{ target_id: "b" }, { target_id: "c" }],
      error: null,
    });
    expect(next).toEqual(new Set(["b", "c"]));
  });

  it("查询成功且无收藏时才是空集（空集是合法语义，失败不是）", () => {
    expect(favoriteIdsAfterLoad(new Set(["a"]), { data: [], error: null })).toEqual(new Set());
    expect(favoriteIdsAfterLoad(new Set(["a"]), { data: null, error: null })).toEqual(new Set());
  });
});

describe("favoriteIdsAfterToggle", () => {
  it("写失败返回 null：调用方保持现状，星星不停在错误一侧", () => {
    expect(favoriteIdsAfterToggle(new Set(["a"]), "a", true)).toBeNull();
    expect(favoriteIdsAfterToggle(new Set(["a"]), "b", true)).toBeNull();
  });

  it("写成功按当前状态切换：已收藏移除、未收藏加入", () => {
    expect(favoriteIdsAfterToggle(new Set(["a", "b"]), "a", false)).toEqual(new Set(["b"]));
    expect(favoriteIdsAfterToggle(new Set(["a"]), "c", false)).toEqual(new Set(["a", "c"]));
  });

  it("不可变更新，不改动传入的 Set", () => {
    const prev = new Set(["a"]);
    favoriteIdsAfterToggle(prev, "a", false);
    expect(prev).toEqual(new Set(["a"]));
  });
});

describe("favoriteToggleFailureTitle", () => {
  it("按点击时状态区分失败方向，不用含糊的「操作失败」", () => {
    expect(favoriteToggleFailureTitle(true)).toBe("取消收藏失败");
    expect(favoriteToggleFailureTitle(false)).toBe("收藏失败");
  });
});
