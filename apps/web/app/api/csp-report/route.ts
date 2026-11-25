import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/logger";

/**
 * CSP 违规上报端点（安全头第一步：CSP 以仅上报模式下发，见 next.config.mjs）。
 *
 * 只做一件事：把浏览器送来的违规报告压成一行 JSON 落到日志，供收齐真实来源后
 * 再把策略切成强制模式。不落库、不回显内容、不参与任何业务判定。
 *
 * 隐私与滥用面：
 * - 被拦来源保留主机名（诊断价值所在）、去掉 query/hash（可能带签名 URL 的令牌）；
 *   本页地址只留路径；`/s/<token>` 的分享令牌是访问凭证，一律掩码。
 * - 不记录 original-policy（冗长且固定）、referrer、script-sample（可能带页面内容片段）。
 * - 未登录可达（登录页、公开分享页也会上报），所以有体积上限和限流，
 *   不能被当成无限写日志的入口。
 */

/** csp-report 是固定结构的 JSON，正常几百字节；留足余量后仍超限的一律拒收 */
const MAX_BODY_BYTES = 8 * 1024;
/** 单来源每分钟上报上限：浏览器对同一条违规只报一次，正常远低于此值 */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

interface CspReport {
  "blocked-uri"?: unknown;
  "document-uri"?: unknown;
  "effective-directive"?: unknown;
  "violated-directive"?: unknown;
  "source-file"?: unknown;
  "line-number"?: unknown;
  "column-number"?: unknown;
}

/** 取字符串字段；超长值截断，避免把任意内容原样写进日志 */
function textField(value: unknown, max = 200): string | undefined {
  return typeof value === "string" && value ? value.slice(0, max) : undefined;
}

/** 分享令牌是访问凭证：路径里 /s/ 后面那一段一律掩码 */
function maskShareToken(pathOrUrl: string): string {
  return pathOrUrl.replace(/^(\w+:\/\/[^/]+)?\/s\/[^/]+/, "$1/s/:token");
}

/**
 * 被拦来源 → origin + 路径。主机名是这份日志里最有用的信息（哪个外部来源被拦），
 * 必须保留；query/hash 可能带签名 URL 的令牌，去掉。非 URL 值（inline / eval）原样截断。
 */
function sourceField(value: unknown): string | undefined {
  const raw = textField(value, 2000);
  if (!raw) return undefined;
  let clean = raw.split(/[?#]/, 1)[0];
  try {
    const url = new URL(raw);
    // data: / blob: 这类 URL 的 origin 是 "null"，只留协议
    clean = url.origin === "null" ? url.protocol : `${url.origin}${url.pathname}`;
  } catch {
    // 非 URL
  }
  return maskShareToken(clean).slice(0, 200);
}

/** 本页地址 → 只留路径（自己的 origin 没有诊断价值） */
function documentField(value: unknown): string | undefined {
  const raw = textField(value, 2000);
  if (!raw) return undefined;
  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.split(/[?#]/, 1)[0];
  }
  return maskShareToken(path).slice(0, 200);
}

function parseReport(raw: string): CspReport | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const report =
      parsed && typeof parsed === "object"
        ? (parsed as { "csp-report"?: unknown })["csp-report"]
        : null;
    return report && typeof report === "object" ? (report as CspReport) : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  // 与匿名分享路由同口径取来源 IP；XFF 可伪造，这里的限流只是给日志量兜个底
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (!(await checkRateLimit(`csp-report:${ip}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return new NextResponse(null, { status: 429 });
  }

  // 先看声明长度，读完再复核：不让超限请求先把正文整段读进内存
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  const report = parseReport(raw);
  if (!report) {
    return new NextResponse(null, { status: 400 });
  }

  console.warn(
    JSON.stringify({
      level: "warn",
      ts: new Date().toISOString(),
      requestId: getRequestId(request),
      event: "csp-violation",
      directive:
        textField(report["effective-directive"], 60) ??
        textField(report["violated-directive"], 60),
      blockedUri: sourceField(report["blocked-uri"]),
      documentPath: documentField(report["document-uri"]),
      sourceFile: sourceField(report["source-file"]),
      line: typeof report["line-number"] === "number" ? report["line-number"] : undefined,
      column:
        typeof report["column-number"] === "number" ? report["column-number"] : undefined,
    })
  );
  return new NextResponse(null, { status: 204 });
}
