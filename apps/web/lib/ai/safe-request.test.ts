import { describe, expect, it, vi } from "vitest";
import { AIRequestError, buildMultipartBody, maskApiKey, safeAIRequest } from "./safe-request";
import type { AddressLookup, ResolvedAddress } from "@/lib/scraper/url-safety";

const PUBLIC: ResolvedAddress = { address: "93.184.216.34", family: 4 };

const lookupResolving = (address: ResolvedAddress): AddressLookup => async () => [address];

interface MockResponse {
  status: number;
  headers: Record<string, string>;
  buffer: Buffer;
  text: () => string;
}

interface MockTransportContext {
  address: ResolvedAddress;
  method?: string;
  headers?: Record<string, string>;
  url: URL;
}

type MockTransport = ReturnType<
  typeof vi.fn<(context: MockTransportContext) => Promise<MockResponse>>
>;

const okResponse = (): MockResponse => ({
  status: 200,
  headers: {},
  buffer: Buffer.from("{}"),
  text: (): string => "{}",
});

const ok200: MockTransport = vi.fn(async () => okResponse());

describe("safeAIRequest SSRF 防护", () => {
  it("拒绝非 HTTP(S) 协议", async () => {
    await expect(
      safeAIRequest("file:///etc/passwd", { transport: ok200 })
    ).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(
      safeAIRequest("ftp://example.com/x", { transport: ok200 })
    ).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("拒绝 localhost 主机", async () => {
    await expect(
      safeAIRequest("http://localhost:8080/v1/chat/completions", { transport: ok200 })
    ).rejects.toMatchObject({ code: "URL_BLOCKED" });
  });

  it("拒绝 IPv4 私网 / 环回 / 云元数据字面量", async () => {
    for (const url of [
      "http://10.1.2.3/v1",
      "http://192.168.1.1/v1",
      "http://172.16.0.5/v1",
      "http://127.0.0.1/v1",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1/v1",
    ]) {
      await expect(safeAIRequest(url, { transport: ok200 })).rejects.toMatchObject({
        code: "URL_BLOCKED",
      });
    }
  });

  it("拒绝 IPv6 环回 / 链路本地 / 唯一本地地址", async () => {
    for (const url of ["http://[::1]/v1", "http://[fe80::1]/v1", "http://[fd00::1]/v1"]) {
      await expect(safeAIRequest(url, { transport: ok200 })).rejects.toMatchObject({
        code: "URL_BLOCKED",
      });
    }
  });

  it("拒绝带登录凭据的 URL", async () => {
    await expect(
      safeAIRequest("http://user:pass@example.com/v1", { transport: ok200 })
    ).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("DNS 解析到私网时拒绝", async () => {
    await expect(
      safeAIRequest("http://evil.example.com/v1", {
        lookup: lookupResolving({ address: "10.0.0.5", family: 4 }),
        transport: ok200,
      })
    ).rejects.toMatchObject({ code: "URL_BLOCKED" });
  });

  it("解析出多个地址且任一为私网时拒绝（防混合记录绕过）", async () => {
    const lookup: AddressLookup = async () => [
      PUBLIC,
      { address: "127.0.0.1", family: 4 },
    ];
    await expect(
      safeAIRequest("http://mixed.example.com/v1", { lookup, transport: ok200 })
    ).rejects.toMatchObject({ code: "URL_BLOCKED" });
  });

  it("公网地址放行，且连接钉扎在已校验地址上", async () => {
    const lookup = lookupResolving(PUBLIC);
    const transport: MockTransport = vi.fn(async () => okResponse());
    const response = await safeAIRequest("https://api.example.com/v1/chat/completions", {
      lookup,
      transport,
      method: "POST",
      headers: { Authorization: "Bearer sk-test" },
      body: JSON.stringify({ model: "x" }),
    });
    expect(response.status).toBe(200);
    const [context] = transport.mock.calls[0];
    expect(context?.address).toEqual(PUBLIC);
    expect(context?.method).toBe("POST");
    expect(context?.headers?.Authorization).toBe("Bearer sk-test");
    expect(context?.url.toString()).toBe("https://api.example.com/v1/chat/completions");
  });

  it("重定向到私网时拒绝（逐跳复检）", async () => {
    let call = 0;
    const transport = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
          buffer: Buffer.alloc(0),
          text: () => "",
        };
      }
      return okResponse();
    });
    await expect(
      safeAIRequest("https://public.example.com/v1", {
        lookup: lookupResolving(PUBLIC),
        transport,
      })
    ).rejects.toMatchObject({ code: "URL_BLOCKED" });
  });

  it("公网到公网的重定向链正常完成", async () => {
    let call = 0;
    const transport: MockTransport = vi.fn(async (context) => {
      call += 1;
      if (call === 1) {
        const redirected: MockResponse = {
          status: 302,
          headers: { location: "https://api2.example.com/v1/chat/completions" },
          buffer: Buffer.alloc(0),
          text: (): string => "",
        };
        return redirected;
      }
      return { status: 200, headers: {}, buffer: Buffer.from(`{"hop":${call}}`), text: (): string => `{"hop":${call}}` };
    });
    const response = await safeAIRequest("https://api.example.com/v1", {
      lookup: lookupResolving(PUBLIC),
      transport,
    });
    expect(response.status).toBe(200);
    expect(call).toBe(2);
    // 第二跳是新地址也必须是公网（由 validatePublicUrl 保证），这里只确认链走通
    expect(transport.mock.calls[1][0].url.hostname).toBe("api2.example.com");
  });

  it("重定向次数过多时拒绝", async () => {
    let call = 0;
    const transport = vi.fn(async () => {
      call += 1;
      return {
        status: 302,
        headers: { location: `https://hop${call}.example.com/v1` },
        buffer: Buffer.alloc(0),
        text: () => "",
      };
    });
    await expect(
      safeAIRequest("https://start.example.com/v1", {
        lookup: lookupResolving(PUBLIC),
        transport,
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });

  it("HTTP 4xx/5xx 原样返回响应对象（抛错与脱敏在上层 request 包装）", async () => {
    const transport = vi.fn(async () => ({
      status: 400,
      headers: {},
      buffer: Buffer.from('{"error":"bad request"}'),
      text: () => '{"error":"bad request"}',
    }));
    const response = await safeAIRequest("https://api.example.com/v1/chat/completions", {
      lookup: lookupResolving(PUBLIC),
      transport,
      method: "POST",
      headers: { Authorization: "Bearer sk-secret123" },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(response.text()).toContain("bad request");
  });
});

describe("redactSecret（上层错误消息脱敏，server.ts）", () => {
  it("从 server.ts 导入 redactSecret", async () => {
    const { redactSecret } = await import("@/lib/ai/server");
    // 恶意端点在错误响应里回显 Authorization 头 → 透出的消息必须抹掉密钥
    const echoed = 'AI 请求失败（400）：{"error":"Authorization was Bearer sk-secret123"}';
    expect(redactSecret(echoed, "Bearer sk-secret123")).not.toContain("sk-secret123");
    expect(redactSecret(echoed, "Bearer sk-secret123")).toContain("***");
    // 裸密钥（无 Bearer 前缀）同样抹除
    expect(redactSecret("key=sk-secret123 leaked", "Bearer sk-secret123")).not.toContain("sk-secret123");
    // 无密钥时原样返回
    expect(redactSecret("plain message", "")).toBe("plain message");
  });
});

describe("buildMultipartBody / maskApiKey", () => {
  it("multipart 包含字段、文件名与内容类型", async () => {
    const file = {
      name: "recording.webm",
      type: "audio/webm",
      arrayBuffer: async () => Buffer.from("AUDIO").buffer,
    };
    const { contentType, body } = await buildMultipartBody(file, { model: "whisper-1" });
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    const text = body.toString("utf8");
    expect(text).toContain('name="model"');
    expect(text).toContain("whisper-1");
    expect(text).toContain("recording.webm");
    expect(text).toContain("audio/webm");
  });

  it("maskApiKey 只保留头尾", () => {
    expect(maskApiKey("sk-abcdefghijklmnop")).toBe("sk-****mnop");
    expect(maskApiKey("short")).toBe("***");
    expect(maskApiKey("")).toBe("");
  });
});

// 类型引用占位：AddressLookup 由实现侧导出，保持 import 有效
export type { AddressLookup };
