import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// CSP 违规上报端点：合法报告 204 并落一行日志；畸形 400、超限 413、限流 429。
// 重点断言日志形态——分享令牌、query、script-sample 都不得进入日志。

const checkRateLimit = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/api/rate-limit", () => ({ checkRateLimit }));

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      body,
      headers: { "content-type": "application/csp-report", ...headers },
    })
  );
}

describe("POST /api/csp-report", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    warn.mockClear();
    checkRateLimit.mockClear();
    checkRateLimit.mockResolvedValue(true);
  });

  it("合法报告：204，日志只含掩码与裁剪后的字段", async () => {
    const response = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "http://localhost:54321/s/abc123SECRETtoken?x=1#frag",
          "blocked-uri": "https://evil.example/track.js?secret=1",
          "effective-directive": "script-src",
          "violated-directive": "script-src",
          "source-file": "https://evil.example/track.js",
          "line-number": 12,
          "column-number": 3,
          "original-policy": "default-src 'self'; …",
          "script-sample": "alert(document.cookie)",
          referrer: "http://localhost/notes/1",
        },
      })
    );

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0][0] as string;
    expect(logged.split("\n")).toHaveLength(1);
    expect(logged).toContain('"event":"csp-violation"');
    expect(logged).toContain('"directive":"script-src"');
    expect(logged).toContain('"documentPath":"/s/:token"');
    expect(logged).toContain('"blockedUri":"https://evil.example/track.js"');
    expect(logged).toContain('"sourceFile":"https://evil.example/track.js"');
    expect(logged).toContain('"line":12');
    expect(logged).not.toContain("SECRETtoken");
    expect(logged).not.toContain("secret=1");
    expect(logged).not.toContain("document.cookie");
    expect(logged).not.toContain("original-policy");
  });

  it("兼容只带 violated-directive 的旧格式报告", async () => {
    const response = await post(
      JSON.stringify({ "csp-report": { "violated-directive": "img-src", "blocked-uri": "inline" } })
    );

    expect(response.status).toBe(204);
    expect(warn.mock.calls[0][0]).toContain('"directive":"img-src"');
  });

  it("被拦来源保留主机名；非 URL 与 data: 值不产生垃圾输出", async () => {
    await post(
      JSON.stringify({
        "csp-report": {
          "blocked-uri": "https://evil.example/",
          "source-file": "eval",
        },
      })
    );
    expect(warn.mock.calls[0][0]).toContain('"blockedUri":"https://evil.example/"');
    expect(warn.mock.calls[0][0]).toContain('"sourceFile":"eval"');

    await post(
      JSON.stringify({ "csp-report": { "blocked-uri": "data:image/png;base64,AAAA" } })
    );
    expect(warn.mock.calls[1][0]).toContain('"blockedUri":"data:"');
  });

  it("畸形请求：非 JSON、缺 csp-report 一律 400 且不落日志", async () => {
    expect((await post("not-json")).status).toBe(400);
    expect((await post(JSON.stringify({ hello: 1 }))).status).toBe(400);
    expect((await post(JSON.stringify({ "csp-report": "x" }))).status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it("超限：声明长度或实际体积超上限都返回 413", async () => {
    const declared = await post("{}", { "content-length": String(9 * 1024) });
    expect(declared.status).toBe(413);

    const actual = await post(JSON.stringify({ "csp-report": { "blocked-uri": "x".repeat(9 * 1024) } }));
    expect(actual.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it("限流：超过单来源上限返回 429，无来源 IP 时归入 unknown 档", async () => {
    checkRateLimit.mockResolvedValue(false);

    const response = await post(JSON.stringify({ "csp-report": { "blocked-uri": "inline" } }));

    expect(response.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith(
      "csp-report:unknown",
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("限流键取自 x-forwarded-for 的第一段", async () => {
    await post(JSON.stringify({ "csp-report": {} }), {
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    });

    expect(checkRateLimit).toHaveBeenCalledWith(
      "csp-report:203.0.113.7",
      expect.any(Number),
      expect.any(Number)
    );
  });
});
