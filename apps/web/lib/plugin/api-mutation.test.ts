import { describe, expect, it } from "vitest";
import {
  buildPluginPatch,
  parseJsonBody,
  PLUGIN_RECORDS_LOAD_ERROR,
  readPluginDeleteResult,
  readPluginPatchResult,
  readPluginRecords,
} from "./api-mutation";

describe("parseJsonBody", () => {
  it("合法 JSON 对象解析成功并保留字段", () => {
    expect(parseJsonBody('{"enabled":false}')).toEqual({
      ok: true,
      body: { enabled: false },
    });
  });

  it("非法 JSON 判定为失败（route 返回 400）", () => {
    expect(parseJsonBody("{not json")).toEqual({ ok: false });
  });

  it("空字符串判定为失败", () => {
    expect(parseJsonBody("")).toEqual({ ok: false });
  });

  it("JSON null / 标量按空对象处理（走后续必填校验而非抛错）", () => {
    expect(parseJsonBody("null")).toEqual({ ok: true, body: {} });
    expect(parseJsonBody("42")).toEqual({ ok: true, body: {} });
  });
});

describe("buildPluginPatch", () => {
  it("只给 enabled 时更新 enabled", () => {
    expect(buildPluginPatch({ enabled: false })).toEqual({
      ok: true,
      updateData: { enabled: false },
    });
  });

  it("只给 config 时更新 config", () => {
    const config = { theme: "dark" };
    expect(buildPluginPatch({ config })).toEqual({ ok: true, updateData: { config } });
  });

  it("config 和 enabled 都给时都更新", () => {
    const config = { a: 1 };
    expect(buildPluginPatch({ config, enabled: true })).toEqual({
      ok: true,
      updateData: { config, enabled: true },
    });
  });

  it("config / enabled 都未提供时判定为空 PATCH（route 返回 400，不发 update）", () => {
    expect(buildPluginPatch({})).toEqual({ ok: false });
    expect(buildPluginPatch({ name: "x" })).toEqual({ ok: false });
  });
});

describe("readPluginPatchResult", () => {
  it("更新到 1 行判定成功", () => {
    expect(readPluginPatchResult({ error: null, data: { id: "p1" } })).toBe("ok");
  });

  it("PGRST116（.single() 0 行）判定为 not-found", () => {
    expect(readPluginPatchResult({ error: { code: "PGRST116" }, data: null })).toBe(
      "not-found"
    );
  });

  it("无 error 但 data 为 null（.maybeSingle() 0 行）判定为 not-found", () => {
    expect(readPluginPatchResult({ error: null, data: null })).toBe("not-found");
  });

  it("其它数据库 error 判定为 server-error（走 serverError 通用文案）", () => {
    expect(readPluginPatchResult({ error: { code: "42501" }, data: null })).toBe(
      "server-error"
    );
    expect(readPluginPatchResult({ error: { code: null }, data: null })).toBe("server-error");
  });
});

describe("readPluginDeleteResult", () => {
  it("删除到 1 行判定成功", () => {
    expect(readPluginDeleteResult({ error: null, data: [{ id: "p1" }] })).toBe("ok");
  });

  it("0 行（空数组）判定为 not-found（不存在 / 已卸载 / 不属于本人）", () => {
    expect(readPluginDeleteResult({ error: null, data: [] })).toBe("not-found");
  });

  it("data 为 null 判定为 not-found", () => {
    expect(readPluginDeleteResult({ error: null, data: null })).toBe("not-found");
  });

  it("数据库 error 判定为 server-error（走 serverError 通用文案）", () => {
    expect(readPluginDeleteResult({ error: { code: "42501" }, data: null })).toBe(
      "server-error"
    );
  });
});

describe("readPluginRecords", () => {
  it("2xx + 数组返回记录列表", () => {
    const records = [{ id: "p1", package_name: "@organize/plugin-ai-summary" }];
    expect(readPluginRecords(true, records)).toEqual({ ok: true, records });
  });

  it("非 2xx 判定失败并给可读中文文案", () => {
    expect(readPluginRecords(false, { error: "服务器内部错误" })).toEqual({
      ok: false,
      message: PLUGIN_RECORDS_LOAD_ERROR,
    });
  });

  it("2xx 但返回不是数组（如 {error} 对象）判定失败，不再 .find 抛 TypeError", () => {
    expect(readPluginRecords(true, { error: "x" })).toEqual({
      ok: false,
      message: PLUGIN_RECORDS_LOAD_ERROR,
    });
    expect(readPluginRecords(true, null)).toEqual({
      ok: false,
      message: PLUGIN_RECORDS_LOAD_ERROR,
    });
  });
});
