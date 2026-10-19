import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/collections/[id]/digest/route";
import { DigestBudgetError, assertDigestBudget, generateDigestArticle } from "./digest-server";
import { classifyDigestBudgetError, classifyDigestQuery, parseDigestBody } from "./digest-api";

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  single: vi.fn(),
  insert: vi.fn(),
  upsert: vi.fn(),
  from: vi.fn(),
  rateLimit: vi.fn(),
  getAIConfig: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: mocks.from,
  }),
}));
vi.mock("@/lib/env", () => ({ isMockBackend: () => false }));
vi.mock("@/lib/api/logger", () => ({ logApiError: mocks.logError }));
vi.mock("@/lib/api/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/ai/server", () => ({
  getAIConfig: mocks.getAIConfig,
  redactSecret: (message: string, secret: string) => message.replaceAll(secret, "[REDACTED]"),
}));
vi.mock("./digest-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./digest-server")>();
  return {
    ...actual,
    assertDigestBudget: vi.fn(actual.assertDigestBudget),
    generateDigestArticle: vi.fn(),
  };
});

const reading = { id: "source-1", title: "来源", content: "<p>正文</p>", url: "https://example.com" };
const dbError = { code: "XX000", message: "private table/constraint details" };
const internalError = { error: "服务器内部错误", code: "INTERNAL" };
const missing = { data: null, error: null };
const found = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.maybeSingle.mockReset().mockResolvedValue(missing);
  mocks.single.mockReset().mockResolvedValue(found({ id: "digest-1", title: "整理稿" }));
  mocks.upsert.mockReset().mockResolvedValue({ error: null });
  mocks.rateLimit.mockResolvedValue(true);
  mocks.getAIConfig.mockResolvedValue({ apiKey: "provider-secret", textModel: "model" });
  vi.mocked(assertDigestBudget).mockClear();
  vi.mocked(generateDigestArticle).mockReset().mockResolvedValue({
    title: "整理稿", content: "<p>整理稿正文</p>", excerpt: "摘要", tags: [],
  });
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: mocks.insert.mockReturnThis(),
    maybeSingle: mocks.maybeSingle,
    single: mocks.single,
    upsert: mocks.upsert,
  };
  mocks.from.mockReturnValue(query);
});

async function post(body: unknown = { sourceType: "reading", ids: ["source-1"] }, raw?: string) {
  return POST(new NextRequest("http://localhost/api/collections/collection-1/digest", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ id: "collection-1" }) });
}

describe("digest API 纯函数", () => {
  it.each([null, [], 1, "body", true, undefined])("拒绝非对象 body：%j", (body) => {
    expect(parseDigestBody(body)).toBeNull();
  });

  it("对象 body 原样返回，字段校验由 route 保持原合同", () => {
    const body = { sourceType: "memo", ids: ["m1"], preview: true };
    expect(parseDigestBody(body)).toBe(body);
    expect(parseDigestBody({})).toEqual({});
  });

  it("查询错误优先于 data，成功与无行明确区分", () => {
    expect(classifyDigestQuery({ data: reading, error: dbError })).toEqual({ state: "error", error: dbError });
    expect(classifyDigestQuery({ data: null, error: dbError })).toEqual({ state: "error", error: dbError });
    expect(classifyDigestQuery(missing)).toEqual({ state: "missing" });
    expect(classifyDigestQuery(found(reading))).toEqual({ state: "ok", data: reading });
  });

  it("仅 DigestBudgetError 返回 413 与原文案", () => {
    expect(classifyDigestBudgetError(new DigestBudgetError("来源正文超限")))
      .toEqual({ status: 413, error: "来源正文超限" });
    expect(classifyDigestBudgetError(new Error("private details"))).toBeNull();
    expect(classifyDigestBudgetError({ name: "DigestBudgetError", message: "private details" })).toBeNull();
    expect(classifyDigestBudgetError(null)).toBeNull();
  });
});

describe("POST digest：响应与副作用边界", () => {
  it.each([null, [], 1, "body", true])("非对象 JSON → 400：%j", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "请求格式无效" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("JSON 语法错误 → 400", async () => {
    const response = await post(null, "{");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "请求格式无效" });
  });

  it.each(["reading", "memo", "file"])("%s 来源查询失败 → serverError，停止 AI/写入", async (sourceType) => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: dbError });
    const response = await post({ sourceType, ids: ["source-1"] });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(internalError);
    expect(mocks.getAIConfig).not.toHaveBeenCalled();
    expect(generateDigestArticle).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each(["reading", "memo", "file"])("%s 来源确实无行 → 400", async (sourceType) => {
    const response = await post({ sourceType, ids: ["source-1"] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "来源不存在或不可访问" });
  });

  it("文件关联正文查询失败不能降级成文件名占位", async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce(found({ id: "f1", file_name: "文件.pdf", reading_item_id: "r1" }))
      .mockResolvedValueOnce({ data: { content: "stale" }, error: dbError });
    const response = await post({ sourceType: "file", ids: ["f1"] });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(internalError);
    expect(generateDigestArticle).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("文件关联正文确实无行时保留原有占位预览", async () => {
    mocks.maybeSingle.mockResolvedValueOnce(found({ id: "f1", file_name: "文件.pdf", reading_item_id: "r1" }));
    const response = await post({ sourceType: "file", ids: ["f1"], preview: true });
    expect(response.status).toBe(200);
    const { preview } = await response.json();
    expect(preview.sources[0].label).toBe("文件.pdf");
    expect(preview.totalChars).toBeGreaterThan(0);
    expect(generateDigestArticle).not.toHaveBeenCalled();
  });

  it("幂等查询失败不能当成无既有稿继续调用 AI", async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce(found(reading))
      .mockResolvedValueOnce({ data: { id: "stale" }, error: dbError });
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(internalError);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.getAIConfig).not.toHaveBeenCalled();
    expect(generateDigestArticle).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("既有稿直接复用，无 AI 与写入", async () => {
    mocks.maybeSingle.mockResolvedValueOnce(found(reading)).mockResolvedValueOnce(found({ id: "existing", title: "既有稿" }));
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ digestId: "existing", title: "既有稿", reused: true });
    expect(generateDigestArticle).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("预算超限 → 413 原文案", async () => {
    mocks.maybeSingle.mockResolvedValueOnce(found({ ...reading, content: "字".repeat(20_001) }));
    const response = await post();
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("单个来源超过");
    expect(generateDigestArticle).not.toHaveBeenCalled();
  });

  it("未知预算错误 → 500，不回显 message", async () => {
    mocks.maybeSingle.mockResolvedValueOnce(found(reading));
    vi.mocked(assertDigestBudget).mockImplementationOnce(() => { throw new Error("private budget details"); });
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(internalError);
    expect(generateDigestArticle).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: dbError },
    { data: { id: "stale" }, error: dbError },
    missing,
  ])("保存失败或未返回行 → serverError，不泄露 DB message：%j", async (result) => {
    mocks.maybeSingle.mockResolvedValueOnce(found(reading));
    mocks.single.mockResolvedValueOnce(result);
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(internalError);
    expect(generateDigestArticle).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("新稿保存成功，溯源失败仍成功并记录日志", async () => {
    mocks.maybeSingle.mockResolvedValueOnce(found(reading));
    mocks.upsert.mockResolvedValueOnce({ error: dbError });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await post();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ digestId: "digest-1", title: "整理稿", reused: false });
      expect(log).toHaveBeenCalledWith("整理稿溯源保存失败", dbError);
    } finally {
      log.mockRestore();
    }
  });

  it("AI 失败仍返回 502 与脱敏后的 provider 文案", async () => {
    mocks.maybeSingle.mockResolvedValueOnce(found(reading));
    vi.mocked(generateDigestArticle).mockRejectedValueOnce(new Error("provider-secret: provider failed"));
    const response = await post();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "[REDACTED]: provider failed" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
