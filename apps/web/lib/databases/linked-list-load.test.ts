import { describe, expect, it } from "vitest";
import {
  LINKED_DATABASES_EMPTY_MESSAGE,
  LINKED_DATABASES_LOAD_ERROR_MESSAGE,
  resolveLinkedDatabasesLoad,
} from "./linked-list-load";

describe("resolveLinkedDatabasesLoad", () => {
  it("响应失败时返回 error 和固定失败文案", () => {
    expect(LINKED_DATABASES_LOAD_ERROR_MESSAGE).toBe("数据库列表加载失败，请重试");
    expect(resolveLinkedDatabasesLoad({ ok: false })).toEqual({
      kind: "error",
      message: LINKED_DATABASES_LOAD_ERROR_MESSAGE,
    });
  });

  it("响应成功且数据库为空数组时返回 empty", () => {
    expect(LINKED_DATABASES_EMPTY_MESSAGE).toBe("还没有可链接的数据库，请先创建一个数据库");
    expect(resolveLinkedDatabasesLoad({ ok: true, databases: [] })).toEqual({ kind: "empty" });
  });

  it("响应成功且数据库非空时返回 ready 和原内容", () => {
    const databases = [
      { id: "db-1", title: "阅读库" },
      { id: "db-2", title: "项目库" },
    ];
    expect(resolveLinkedDatabasesLoad({ ok: true, databases })).toEqual({
      kind: "ready",
      databases,
    });
  });

  it("响应成功且 databases 为 null 时返回 empty", () => {
    expect(resolveLinkedDatabasesLoad({ ok: true, databases: null })).toEqual({ kind: "empty" });
  });

  it("响应成功且未提供 databases 时返回 empty", () => {
    expect(resolveLinkedDatabasesLoad({ ok: true })).toEqual({ kind: "empty" });
  });

  it("响应失败时即使传入非空数据库也返回 error", () => {
    expect(
      resolveLinkedDatabasesLoad({
        ok: false,
        databases: [{ id: "db-1", title: "阅读库" }],
      }),
    ).toEqual({ kind: "error", message: LINKED_DATABASES_LOAD_ERROR_MESSAGE });
  });
});
