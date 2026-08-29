/**
 * 结构化日志（P2-01）：API 错误不再散落 console.error 文本行，
 * 统一输出单行 JSON（可被日志采集器解析），并携带请求 ID 与请求路径。
 *
 * 请求 ID 由 middleware 为每个请求生成（x-request-id 响应头可回溯），
 * route handler 里通过 getRequestId(request) 取出后传给 logApiError。
 */

export interface ApiErrorContext {
  requestId?: string;
  path?: string;
  method?: string;
}

export function getRequestId(request: Request): string | undefined {
  return request.headers.get("x-request-id") ?? undefined;
}

export function logApiError(err: unknown, ctx: ApiErrorContext = {}): void {
  const payload = {
    level: "error" as const,
    ts: new Date().toISOString(),
    requestId: ctx.requestId,
    path: ctx.path,
    method: ctx.method,
    code:
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined,
    message: err instanceof Error ? err.message : String(err),
  };
  // 单行 JSON 输出到 stderr：Vercel/容器日志管道可直接解析
  console.error(JSON.stringify(payload));
}
