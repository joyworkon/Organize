import { describe, expect, it } from "vitest";
import { readMutationError, resolveBlockMutationResult } from "./block-mutation-result";

describe("resolveBlockMutationResult", () => {
  it("ok 时返回成功，忽略 fallback", () => {
    expect(resolveBlockMutationResult({ ok: true, fallback: "添加行失败" })).toEqual({ ok: true });
  });

  it("非 ok 且 body 带 error 文案时优先用服务端文案", () => {
    expect(
      resolveBlockMutationResult({ ok: false, bodyError: "行数超出配额", fallback: "添加行失败" })
    ).toEqual({ ok: false, message: "行数超出配额" });
  });

  it("非 ok 且 bodyError 缺失/非字符串/空白时回退固定文案", () => {
    expect(resolveBlockMutationResult({ ok: false, fallback: "保存视图失败" })).toEqual({
      ok: false,
      message: "保存视图失败",
    });
    expect(resolveBlockMutationResult({ ok: false, bodyError: 42, fallback: "删除行失败" })).toEqual({
      ok: false,
      message: "删除行失败",
    });
    expect(resolveBlockMutationResult({ ok: false, bodyError: "   ", fallback: "保存失败" })).toEqual({
      ok: false,
      message: "保存失败",
    });
  });
});

describe("readMutationError", () => {
  it("响应 json 含 error 字符串时返回该文案", async () => {
    const res = new Response(JSON.stringify({ error: "未授权" }), { status: 401 });
    await expect(readMutationError(res)).resolves.toBe("未授权");
  });

  it("响应非 json 或无 error 字段时返回 undefined", async () => {
    await expect(readMutationError(new Response("boom", { status: 500 }))).resolves.toBeUndefined();
    await expect(
      readMutationError(new Response(JSON.stringify({ detail: "x" }), { status: 400 }))
    ).resolves.toBeUndefined();
  });
});
