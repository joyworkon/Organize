import { describe, expect, it } from "vitest";
import {
  deleteBlockResult,
  parseJsonBody,
  validateCreateBody,
  validatePatchBody,
} from "./api-mutation";

function req(body: string): Request {
  return new Request("http://localhost/api/synced-blocks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("parseJsonBody", () => {
  it("合法 JSON 对象 → ok", async () => {
    const result = await parseJsonBody(req(JSON.stringify({ content: [] })));
    expect(result).toEqual({ ok: true, body: { content: [] } });
  });

  it("非法 JSON → 400 请求格式错误", async () => {
    const result = await parseJsonBody(req("{not json"));
    expect(result).toEqual({
      ok: false,
      rejection: { status: 400, error: "请求格式错误" },
    });
  });

  it("空请求体 → 400 请求格式错误", async () => {
    const result = await parseJsonBody(req(""));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.status).toBe(400);
  });

  it("顶层是数组 / 字符串 / null → 400 请求格式错误", async () => {
    for (const raw of ["[]", '"text"', "null", "42"]) {
      const result = await parseJsonBody(req(raw));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.rejection).toEqual({ status: 400, error: "请求格式错误" });
    }
  });
});

describe("validateCreateBody", () => {
  it("content 是数组 → ok，不带 id", () => {
    const result = validateCreateBody({ content: [{ type: "paragraph" }] });
    expect(result).toEqual({ ok: true, content: [{ type: "paragraph" }] });
  });

  it("content 是空数组 → ok（显式提供的空数组合法）", () => {
    const result = validateCreateBody({ content: [] });
    expect(result).toEqual({ ok: true, content: [] });
  });

  it("content 缺失 → 400 同步区块内容格式错误", () => {
    const result = validateCreateBody({});
    expect(result).toEqual({
      ok: false,
      rejection: { status: 400, error: "同步区块内容格式错误" },
    });
  });

  it("content 非数组 → 400 同步区块内容格式错误", () => {
    for (const content of ["text", 42, { type: "paragraph" }, null]) {
      const result = validateCreateBody({ content });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.rejection).toEqual({ status: 400, error: "同步区块内容格式错误" });
      }
    }
  });

  it("id 是非空字符串 → ok 并带上 id", () => {
    const result = validateCreateBody({ content: [], id: "sb-1" });
    expect(result).toEqual({ ok: true, content: [], id: "sb-1" });
  });

  it("id 提供了但不是非空字符串 → 400 同步区块 id 格式错误", () => {
    for (const id of [123, "", null, {}, []]) {
      const result = validateCreateBody({ content: [], id });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.rejection).toEqual({ status: 400, error: "同步区块 id 格式错误" });
      }
    }
  });
});

describe("validatePatchBody", () => {
  it("content 数组 + 整数 expected_revision → ok", () => {
    const result = validatePatchBody({ content: [{ type: "paragraph" }], expected_revision: 3 });
    expect(result).toEqual({ ok: true, content: [{ type: "paragraph" }], expectedRevision: 3 });
  });

  it("content 缺失或非数组 → 400 同步区块内容格式错误（不覆盖内容）", () => {
    for (const body of [{}, { content: "text" }, { content: null }, { expected_revision: 1 }]) {
      const result = validatePatchBody(body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.rejection).toEqual({ status: 400, error: "同步区块内容格式错误" });
      }
    }
  });

  it("expected_revision 缺省 / 非整数 → null（兜底覆盖语义不变）", () => {
    for (const body of [
      { content: [] },
      { content: [], expected_revision: "3" },
      { content: [], expected_revision: 1.5 },
      { content: [], expected_revision: null },
      { content: [], expected_revision: Number.NaN },
    ]) {
      const result = validatePatchBody(body);
      expect(result).toEqual({ ok: true, content: [], expectedRevision: null });
    }
  });
});

describe("deleteBlockResult", () => {
  it("0 行 → 404 同步区块不存在或已删除", () => {
    expect(deleteBlockResult(0)).toEqual({
      ok: false,
      rejection: { status: 404, error: "同步区块不存在或已删除" },
    });
  });

  it("1 行 → ok", () => {
    expect(deleteBlockResult(1)).toEqual({ ok: true });
  });
});
