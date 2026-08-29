// AI 模块的 SSRF 安全请求层（P0-03）：
// 用户可在「设置 › AI 服务」自定义 base_url，服务端会代为请求——必须阻止
// localhost / 私网 / 云元数据 / DNS 解析到内网 / 重定向绕过。
// 复用抓取模块的 validatePublicUrl（协议、凭据、主机与全部解析地址校验），
// 并把连接钉扎在已校验地址上（防 DNS 重绑定 TOCTOU）；逐跳重定向重新校验。
import * as http from "node:http";
import * as https from "node:https";
import type { LookupFunction } from "node:net";
import {
  UrlSafetyError,
  validatePublicUrl,
  type AddressLookup,
  type ResolvedAddress,
} from "@/lib/scraper/url-safety";

export type SafeAIErrorCode =
  | "INVALID_URL"
  | "URL_BLOCKED"
  | "DNS_FAILED"
  | "TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "REQUEST_FAILED"
  | "HTTP_ERROR";

export class AIRequestError extends Error {
  constructor(
    public readonly code: SafeAIErrorCode,
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "AIRequestError";
  }
}

export interface SafeAIResponse {
  status: number;
  headers: Record<string, string | undefined>;
  buffer: Buffer;
  text: () => string;
}

export interface SafeAIRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** 请求体（JSON 字符串或已构建好的 multipart Buffer） */
  body?: Buffer | string;
  timeoutMs?: number;
  maxRedirects?: number;
  lookup?: AddressLookup;
  /** 测试注入：替换底层 HTTP 传输 */
  transport?: (context: SafeAIRequestContext) => Promise<SafeAIResponse>;
}

export interface SafeAIRequestContext {
  url: URL;
  address: ResolvedAddress;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: Buffer | string;
  signal: AbortSignal;
}

const MAX_REDIRECTS = 5;
// 转写/摘要响应体积上限（与音频输入 25MB 同量级）
const MAX_RESPONSE_BYTES = 30 * 1024 * 1024;

export async function safeAIRequest(
  input: string,
  options: SafeAIRequestOptions = {}
): Promise<SafeAIResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
  const transport =
    options.transport ??
    ((context: SafeAIRequestContext) => pinnedRequest(context, options.body));
  let currentUrl: string = input;

  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      const target = await validateTarget(currentUrl, options.lookup);
      const response = await transport({
        url: target.url,
        address: target.addresses[0],
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        body: options.body,
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location) {
          throw new AIRequestError("HTTP_ERROR", "AI 服务返回了无效的重定向", response.status);
        }
        if (redirectCount >= (options.maxRedirects ?? MAX_REDIRECTS)) {
          throw new AIRequestError("TOO_MANY_REDIRECTS", "AI 服务重定向次数过多");
        }
        try {
          currentUrl = new URL(location, target.url).toString();
        } catch {
          throw new AIRequestError("INVALID_URL", "AI 服务重定向地址无效");
        }
        continue;
      }

      if (response.buffer.byteLength > MAX_RESPONSE_BYTES) {
        throw new AIRequestError("REQUEST_FAILED", "AI 服务响应超过大小限制");
      }
      return response;
    }
  } catch (error) {
    if (error instanceof AIRequestError) throw error;
    if (error instanceof UrlSafetyError) {
      throw new AIRequestError(error.code, error.message);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new AIRequestError("TIMEOUT", "AI 请求超时，请稍后重试");
    }
    throw new AIRequestError("REQUEST_FAILED", "AI 请求失败，请稍后重试");
  } finally {
    clearTimeout(timer);
  }
}

async function validateTarget(url: string, lookup?: AddressLookup) {
  try {
    return await validatePublicUrl(url, lookup);
  } catch (error) {
    if (error instanceof UrlSafetyError) {
      throw new AIRequestError(error.code, error.message);
    }
    throw error;
  }
}

async function pinnedRequest(
  context: SafeAIRequestContext,
  body?: Buffer | string
): Promise<SafeAIResponse> {
  return new Promise((resolve, reject) => {
    const transport = context.url.protocol === "https:" ? https : http;
    // 地址钉扎：连接直接使用已校验的解析结果，防止校验后 DNS 重绑定绕过
    const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [context.address]);
        return;
      }
      callback(null, context.address.address, context.address.family);
    };

    const request = transport.request(
      context.url,
      {
        method: context.method,
        signal: context.signal,
        lookup,
        headers: context.headers,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
        }

        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, headers, buffer: Buffer.alloc(0), text: () => "" });
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            response.destroy(new AIRequestError("REQUEST_FAILED", "AI 服务响应超过大小限制"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status, headers, buffer, text: () => buffer.toString("utf8") });
        });
        response.on("error", reject);
      }
    );

    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/** 语音转写的 multipart 请求体（node:http 不支持 FormData，手工构建） */
export function buildMultipartBody(
  file: { name?: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> },
  fields: Record<string, string>
): Promise<{ contentType: string; body: Buffer }> {
  const boundary = `organize-ai-${Math.random().toString(36).slice(2)}`;
  const encoder = (text: string) => Buffer.from(text, "utf8");
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      encoder(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  return file.arrayBuffer().then((arrayBuffer) => {
    const fileBuffer = Buffer.from(arrayBuffer);
    const filename = (file.name || "recording.webm").replace(/["\r\n]/g, "");
    const mime = (file.type || "application/octet-stream").replace(/["\r\n]/g, "");
    parts.push(
      encoder(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
      ),
      fileBuffer,
      encoder(`\r\n--${boundary}--\r\n`)
    );
    return {
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: Buffer.concat(parts),
    };
  });
}

/** 密钥掩码：只暴露前 3 位与后 4 位，中间一律打码 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "***";
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}
