import { describe, expect, it } from "vitest";
import {
  buildDatabasePatchUpdate,
  buildRowPatchUpdate,
  classifyParentDatabase,
  databasePatchRejection,
  isNoRowsError,
  parseJsonBody,
  resolveDatabaseDelete,
  resolveRowDelete,
  rowPatchRejection,
} from "./api-mutation";

function req(body: string): Request {
  return new Request("http://localhost/api/databases/db-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("parseJsonBody", () => {
  it("合法 JSON 对象 → ok", async () => {
    const result = await parseJsonBody(req(JSON.stringify({ title: "t" })));
    expect(result).toEqual({ ok: true, body: { title: "t" } });
  });

  it("合法空对象 → ok（空 PATCH 与非法 JSON 分开：由 build*Update 判 400 没有可更新的字段）", async () => {
    const result = await parseJsonBody(req("{}"));
    expect(result).toEqual({ ok: true, body: {} });
  });

  it("非法 JSON / 空请求体 → 400 请求格式错误", async () => {
    for (const raw of ["{not json", ""]) {
      const result = await parseJsonBody(req(raw));
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("顶层是数组 / 字符串 / null / 数字 → 400 请求格式错误", async () => {
    for (const raw of ["[]", '"text"', "null", "42"]) {
      const result = await parseJsonBody(req(raw));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.rejection).toEqual({ status: 400, error: "请求格式错误" });
      }
    }
  });
});

describe("buildDatabasePatchUpdate", () => {
  it("空 body → 400 没有可更新的字段", () => {
    expect(buildDatabasePatchUpdate({})).toEqual({
      ok: false,
      rejection: { status: 400, error: "没有可更新的字段" },
    });
  });

  it("只有不识别 / 类型不合法字段 → 400 没有可更新的字段", () => {
    for (const body of [
      { nope: 1 },
      { title: 42 },
      { schema: "not-array" },
      { views: { length: 1 } },
    ]) {
      expect(buildDatabasePatchUpdate(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "没有可更新的字段" },
      });
    }
  });

  it("icon 在场但既非 null 也非 string → 不写入 updates（其它字段也没有时 → 400）", () => {
    expect(buildDatabasePatchUpdate({ icon: 42 })).toEqual({
      ok: false,
      rejection: { status: 400, error: "没有可更新的字段" },
    });
    const result = buildDatabasePatchUpdate({ icon: 42, title: "t" });
    expect(result).toEqual({ ok: true, updates: { title: "t" } });
  });

  it("常规字段进入 updates（icon: null 表示清除）", () => {
    const schema = [{ id: "prop_name", name: "名称", type: "text" }];
    const views = [{ id: "default_view", type: "table", config: {} }];
    expect(
      buildDatabasePatchUpdate({ title: "库", icon: null, schema, views })
    ).toEqual({ ok: true, updates: { title: "库", icon: null, schema, views } });
    expect(buildDatabasePatchUpdate({ icon: "🗄️" })).toEqual({
      ok: true,
      updates: { icon: "🗄️" },
    });
  });
});

describe("buildRowPatchUpdate", () => {
  it("空 body → 400 没有可更新的字段", () => {
    expect(buildRowPatchUpdate({})).toEqual({
      ok: false,
      rejection: { status: 400, error: "没有可更新的字段" },
    });
  });

  it("values 是数组 / null / 非对象 → 不写入；sort 非 number → 不写入", () => {
    for (const body of [
      { values: [] },
      { values: null },
      { values: "text" },
      { sort: "3" },
    ]) {
      expect(buildRowPatchUpdate(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "没有可更新的字段" },
      });
    }
  });

  it("values 对象 / sort 数字进入 updates", () => {
    expect(buildRowPatchUpdate({ values: { prop_name: "行" }, sort: 3 })).toEqual({
      ok: true,
      updates: { values: { prop_name: "行" }, sort: 3 },
    });
    expect(buildRowPatchUpdate({ values: {} })).toEqual({
      ok: true,
      updates: { values: {} },
    });
  });
});

describe("isNoRowsError / PATCH 错误分类", () => {
  it("PGRST116 → true；其它 → false", () => {
    expect(isNoRowsError({ code: "PGRST116", message: "0 rows" })).toBe(true);
    expect(isNoRowsError({ code: "23505" })).toBe(false);
    expect(isNoRowsError(null)).toBe(false);
    expect(isNoRowsError("PGRST116")).toBe(false);
  });

  it("PATCH databases：0 行 → 404 数据库不存在或无权限；其它错误 → null（走 serverError）", () => {
    expect(databasePatchRejection({ code: "PGRST116" })).toEqual({
      status: 404,
      error: "数据库不存在或无权限",
    });
    expect(databasePatchRejection({ code: "23505", message: "dup" })).toBeNull();
  });

  it("PATCH rows：0 行 → 404 行不存在或已删除；其它错误 → null（走 serverError）", () => {
    expect(rowPatchRejection({ code: "PGRST116" })).toEqual({
      status: 404,
      error: "行不存在或已删除",
    });
    expect(rowPatchRejection(new Error("boom"))).toBeNull();
  });
});

describe("classifyParentDatabase（rows 路由的父库校验）", () => {
  it("查询错误 → server-error（route 走 serverError，不泄露 dbErr.message）", () => {
    expect(classifyParentDatabase({ message: "connection reset" }, null)).toEqual({
      status: "server-error",
    });
  });

  it("无错误但无行 → 404 数据库不存在", () => {
    expect(classifyParentDatabase(null, null)).toEqual({
      status: "rejected",
      rejection: { status: 404, error: "数据库不存在" },
    });
  });

  it("命中 → ok", () => {
    expect(classifyParentDatabase(null, { id: "db-1" })).toEqual({ status: "ok" });
  });
});

describe("resolveDatabaseDelete / resolveRowDelete（mutate_trash affected）", () => {
  it("RPC error → server-error（route 走 serverError）", () => {
    expect(resolveDatabaseDelete({ message: "rls denied" }, 1)).toEqual({
      status: "server-error",
    });
    expect(resolveRowDelete({ message: "rls denied" }, 0)).toEqual({
      status: "server-error",
    });
  });

  it("affected === 0 / data 非 number → 404，不假装成功", () => {
    expect(resolveDatabaseDelete(null, 0)).toEqual({
      status: "rejected",
      rejection: { status: 404, error: "数据库不存在或已删除" },
    });
    expect(resolveDatabaseDelete(null, null)).toEqual({
      status: "rejected",
      rejection: { status: 404, error: "数据库不存在或已删除" },
    });
    expect(resolveRowDelete(null, 0)).toEqual({
      status: "rejected",
      rejection: { status: 404, error: "行不存在或已删除" },
    });
  });

  it("affected > 0 → ok 且带 affected", () => {
    expect(resolveDatabaseDelete(null, 1)).toEqual({ status: "ok", affected: 1 });
    expect(resolveRowDelete(null, 3)).toEqual({ status: "ok", affected: 3 });
  });
});
