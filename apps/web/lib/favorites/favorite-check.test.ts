import { describe, expect, it } from "vitest";
import {
  FAVORITE_CHECK_ERROR_TITLE,
  resolveFavoriteCheck,
} from "./favorite-check";

const fakeError = { message: "network down", code: "XX001" } as const;

describe("resolveFavoriteCheck", () => {
  it("查到行 → ok 且 favorited true", () => {
    expect(resolveFavoriteCheck({ data: { id: "fav-1" }, error: null })).toEqual({
      ok: true,
      favorited: true,
    });
  });

  it("无行且无 error → ok 且 favorited false（真的未收藏）", () => {
    expect(resolveFavoriteCheck({ data: null, error: null })).toEqual({
      ok: true,
      favorited: false,
    });
  });

  it("有 error → 失败，message 为固定常量", () => {
    expect(resolveFavoriteCheck({ data: null, error: fakeError })).toEqual({
      ok: false,
      message: FAVORITE_CHECK_ERROR_TITLE,
    });
    expect(FAVORITE_CHECK_ERROR_TITLE).toBe("收藏状态读取失败，点击重试");
  });

  it("有 error 时即使 data 非空也按失败处理", () => {
    expect(resolveFavoriteCheck({ data: { id: "fav-1" }, error: fakeError })).toEqual({
      ok: false,
      message: FAVORITE_CHECK_ERROR_TITLE,
    });
  });
});
