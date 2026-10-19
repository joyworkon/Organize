import { describe, expect, it } from "vitest";
import {
  COLLECTION_ITEM_SOURCE_MISSING_MESSAGE,
  classifyCollectionExistsQuery,
  classifyCollectionItemUpsertError,
} from "./items-api";

describe("classifyCollectionItemUpsertError", () => {
  it("23503 外键错误 → 400「来源不存在或不可访问」", () => {
    const result = classifyCollectionItemUpsertError({
      code: "23503",
      message: "insert or update on table violates foreign key constraint",
    });
    expect(result).toEqual({ status: 400, error: COLLECTION_ITEM_SOURCE_MISSING_MESSAGE });
  });

  it("其它数据库错误 → null（交给 serverError，不泄露 message）", () => {
    expect(classifyCollectionItemUpsertError({ code: "23505", message: "duplicate key" })).toBeNull();
    expect(classifyCollectionItemUpsertError({ code: "42501", message: "permission denied" })).toBeNull();
    expect(classifyCollectionItemUpsertError({ message: "connection reset" })).toBeNull();
    expect(classifyCollectionItemUpsertError(null)).toBeNull();
  });
});

describe("classifyCollectionExistsQuery", () => {
  it("查询 error → error（不得把 DB 错误伪装成 404）", () => {
    expect(
      classifyCollectionExistsQuery({ data: null, error: { message: "network down" } }),
    ).toBe("error");
    expect(
      classifyCollectionExistsQuery({ data: { id: "c1" }, error: { message: "boom" } }),
    ).toBe("error");
  });

  it("无 error 且无行 → missing（404「集合不存在」）", () => {
    expect(classifyCollectionExistsQuery({ data: null, error: null })).toBe("missing");
  });

  it("无 error 且有行 → ok", () => {
    expect(classifyCollectionExistsQuery({ data: { id: "c1" }, error: null })).toBe("ok");
  });
});
