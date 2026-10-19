import { afterEach, describe, expect, it, vi } from "vitest";
import { CANVAS_SCHEMA_VERSION, type CanvasDoc } from "./model";
import { patchCanvas } from "./repository";

const emptyDoc: CanvasDoc = { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [], freeItems: [] };

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function sentBody(fn: ReturnType<typeof mockFetchOnce>): Record<string, unknown> {
  const init = fn.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("patchCanvas 请求体契约", () => {
  it("发送 expected_revision（下划线），不发驼峰 expectedRevision", async () => {
    const fn = mockFetchOnce(200, { revision: 4, updated_at: "2026-10-19T00:00:00Z" });
    const outcome = await patchCanvas("canvas-1", { title: "标题", content: emptyDoc, expectedRevision: 3 });
    expect(outcome).toEqual({ ok: true, revision: 4, updated_at: "2026-10-19T00:00:00Z" });
    const body = sentBody(fn);
    expect(body.expected_revision).toBe(3);
    expect("expectedRevision" in body).toBe(false);
    expect(body.title).toBe("标题");
    expect(body.content).toEqual(emptyDoc);
  });

  it("不带 title 时请求体不含 title 键（服务端保留原标题）", async () => {
    const fn = mockFetchOnce(200, { revision: 2, updated_at: "2026-10-19T00:00:00Z" });
    const outcome = await patchCanvas("canvas-1", { content: emptyDoc, expectedRevision: 1 });
    expect(outcome.ok).toBe(true);
    const body = sentBody(fn);
    expect("title" in body).toBe(false);
    expect(body.expected_revision).toBe(1);
    expect(body.content).toEqual(emptyDoc);
  });

  it("仅改名：不带 content 时请求体不含 content 键", async () => {
    const fn = mockFetchOnce(200, { revision: 6, updated_at: "2026-10-19T00:00:00Z" });
    const outcome = await patchCanvas("canvas-1", { title: "新名", expectedRevision: 5 });
    expect(outcome.ok).toBe(true);
    const body = sentBody(fn);
    expect("content" in body).toBe(false);
    expect(body.title).toBe("新名");
  });
});

describe("patchCanvas 状态映射", () => {
  it("409 → conflict，带服务端 current.revision", async () => {
    mockFetchOnce(409, { error: "画布已被其他标签页或设备修改", current: { revision: 7 } });
    const outcome = await patchCanvas("canvas-1", { title: "t", expectedRevision: 3 });
    expect(outcome).toEqual({ ok: false, reason: "conflict", currentRevision: 7 });
  });

  it("409 缺 current → currentRevision -1", async () => {
    mockFetchOnce(409, { error: "conflict" });
    const outcome = await patchCanvas("canvas-1", { title: "t", expectedRevision: 3 });
    expect(outcome).toEqual({ ok: false, reason: "conflict", currentRevision: -1 });
  });

  it("404 → not-found；401 → unauthorized", async () => {
    mockFetchOnce(404, { error: "文档不存在" });
    expect(await patchCanvas("canvas-1", { title: "t", expectedRevision: 1 })).toEqual({
      ok: false,
      reason: "not-found",
    });
    mockFetchOnce(401, { error: "未授权" });
    expect(await patchCanvas("canvas-1", { title: "t", expectedRevision: 1 })).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("400 → invalid，带 errors 数组", async () => {
    mockFetchOnce(400, { error: "画布内容校验失败", errors: ["boards 缺失"] });
    const outcome = await patchCanvas("canvas-1", { content: emptyDoc, expectedRevision: 1 });
    expect(outcome).toEqual({ ok: false, reason: "invalid", errors: ["boards 缺失"] });
  });

  it("fetch 抛错 / 其它状态 → network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await patchCanvas("canvas-1", { title: "t", expectedRevision: 1 })).toEqual({
      ok: false,
      reason: "network",
    });
    mockFetchOnce(500, { error: "服务器内部错误" });
    expect(await patchCanvas("canvas-1", { title: "t", expectedRevision: 1 })).toEqual({
      ok: false,
      reason: "network",
    });
  });
});
