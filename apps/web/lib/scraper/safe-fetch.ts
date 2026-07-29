import * as http from "node:http";
import * as https from "node:https";
import type { LookupFunction } from "node:net";
import {
  UrlSafetyError,
  validatePublicUrl,
  type AddressLookup,
  type ResolvedAddress,
} from "./url-safety";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "URL_BLOCKED"
  | "DNS_FAILED"
  | "TIMEOUT"
  | "FETCH_FAILED"
  | "HTTP_ERROR"
  | "TOO_MANY_REDIRECTS"
  | "TOO_LARGE"
  | "NON_HTML";

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface RawHttpResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface RequestContext {
  url: URL;
  address: ResolvedAddress;
  signal: AbortSignal;
  userAgent: string;
  maxBytes: number;
}

export type HttpRequester = (context: RequestContext) => Promise<RawHttpResponse>;

interface SafeFetchOptions {
  timeout: number;
  userAgent: string;
  lookup?: AddressLookup;
  request?: HttpRequester;
  maxBytes?: number;
}

export async function safeFetchHtml(
  input: string,
  options: SafeFetchOptions
): Promise<{ html: string; finalUrl: URL }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout);
  const requester = options.request ?? requestOnce;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  let currentUrl: string | URL = input;

  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      let target;
      try {
        target = await validatePublicUrl(currentUrl, options.lookup);
      } catch (error) {
        if (error instanceof UrlSafetyError) {
          throw new SafeFetchError(error.code, error.message);
        }
        throw error;
      }

      const response = await requester({
        url: target.url,
        address: target.addresses[0],
        signal: controller.signal,
        userAgent: options.userAgent,
        maxBytes,
      });

      if (isRedirect(response.status)) {
        const location = response.headers.location;
        if (!location) {
          throw new SafeFetchError(
            "HTTP_ERROR",
            "上游返回了无效的重定向",
            response.status
          );
        }
        if (redirectCount >= MAX_REDIRECTS) {
          throw new SafeFetchError("TOO_MANY_REDIRECTS", "页面重定向次数过多");
        }
        try {
          currentUrl = new URL(location, target.url);
        } catch {
          throw new SafeFetchError("INVALID_URL", "重定向地址无效");
        }
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new SafeFetchError(
          "HTTP_ERROR",
          `无法访问该页面 (${response.status})`,
          response.status
        );
      }

      const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
      if (
        !contentType.startsWith("text/html") &&
        !contentType.startsWith("application/xhtml+xml")
      ) {
        throw new SafeFetchError("NON_HTML", "目标不是 HTML 页面");
      }

      if (Buffer.byteLength(response.body) > maxBytes) {
        throw new SafeFetchError("TOO_LARGE", "页面内容超过大小限制");
      }

      return { html: response.body, finalUrl: target.url };
    }
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SafeFetchError("TIMEOUT", "请求超时，请稍后重试");
    }
    throw new SafeFetchError("FETCH_FAILED", "无法获取页面内容");
  } finally {
    clearTimeout(timer);
  }
}

function requestOnce(context: RequestContext): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const transport = context.url.protocol === "https:" ? https : http;
    const lookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, context.address.address, context.address.family);
    };

    const request = transport.request(
      context.url,
      {
        method: "GET",
        signal: context.signal,
        lookup,
        headers: {
          "User-Agent": context.userAgent,
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers = normalizeHeaders(response.headers);

        if (isRedirect(status) || status < 200 || status >= 300) {
          response.resume();
          resolve({ status, headers, body: "" });
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > context.maxBytes) {
            response.destroy(
              new SafeFetchError("TOO_LARGE", "页面内容超过大小限制")
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          resolve({
            status,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      }
    );

    request.on("error", reject);
    request.end();
  });
}

function normalizeHeaders(
  headers: http.IncomingHttpHeaders
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    normalized[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}
