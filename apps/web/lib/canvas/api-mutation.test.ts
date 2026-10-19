import { describe, expect, it } from "vitest";
import { CANVAS_SCHEMA_VERSION, type CanvasDoc } from "./model";
import { parseJsonBody, validateCanvasPatchBody } from "./api-mutation";

const emptyDoc: CanvasDoc = { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [], freeItems: [] };

function req(body: string): Request {
  return new Request("http://localhost/api/canvases/x", {
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
      if (!result.ok) expect(result.rejection).toEqual({ status: 400, error: "请求格式错误" });
    }
  });
});

describe("validateCanvasPatchBody", () => {
  it("非对象 body → 400 请求格式错误（mock shim 的 body 已在外层解析）", () => {
    for (const body of [undefined, null, 42, "text", [], true]) {
      const result = validateCanvasPatchBody(body);
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("title + content + expected_revision → ok", () => {
    const result = validateCanvasPatchBody({ title: "画布", content: emptyDoc, expected_revision: 3 });
    expect(result).toEqual({ ok: true, title: "画布", content: emptyDoc, expectedRevision: 3 });
  });

  it("title 缺省 → ok 且 title 为 undefined（保留原标题，由 route/shim 补齐）", () => {
    const result = validateCanvasPatchBody({ content: emptyDoc, expected_revision: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBeUndefined();
      expect(result.content).toEqual(emptyDoc);
      expect(result.expectedRevision).toBe(1);
    }
  });

  it("仅 title（仅改名）→ ok 且 content 为 undefined", () => {
    const result = validateCanvasPatchBody({ title: "新名", expected_revision: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe("新名");
      expect(result.content).toBeUndefined();
    }
  });

  it("title 超过 200 字符 → 截断（与既有行为一致）", () => {
    const result = validateCanvasPatchBody({ title: "x".repeat(300) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.title).toHaveLength(200);
  });

  it("title 提供了但不是字符串 → 400 画布标题格式错误", () => {
    for (const title of [123, null, {}, [], true]) {
      const result = validateCanvasPatchBody({ title });
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "画布标题格式错误" },
      });
    }
  });

  it("title 与 content 都没提供 → 400 没有可更新的内容", () => {
    for (const body of [{}, { expected_revision: 1 }]) {
      const result = validateCanvasPatchBody(body);
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "没有可更新的内容" },
      });
    }
  });

  it("content 非法 → 400 画布内容校验失败并带 errors", () => {
    const result = validateCanvasPatchBody({ content: { schemaVersion: 2 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.status).toBe(400);
      expect(result.rejection.error).toBe("画布内容校验失败");
      expect(Array.isArray(result.rejection.errors)).toBe(true);
      expect(result.rejection.errors!.length).toBeGreaterThan(0);
    }
  });

  it("expected_revision 非数字 / 缺省 → null（缺省兜底覆盖语义不变）；小数取整", () => {
    for (const body of [
      { title: "t" },
      { title: "t", expected_revision: "3" },
      { title: "t", expected_revision: null },
      { title: "t", expected_revision: Number.NaN },
    ]) {
      const result = validateCanvasPatchBody(body);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.expectedRevision).toBeNull();
    }
    const truncated = validateCanvasPatchBody({ title: "t", expected_revision: 3.9 });
    expect(truncated.ok).toBe(true);
    if (truncated.ok) expect(truncated.expectedRevision).toBe(3);
  });
});
