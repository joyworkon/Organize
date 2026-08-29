/**
 * 统一的 API 错误处理工具。
 *
 * 问题背景：原来所有 route 把 `error.message` 原样返回给前端，
 * 可能泄露 SQL 错误、约束名、表名等敏感信息。
 *
 * 用法：
 *   const { data, error } = await supabase...
 *   if (error) return serverError(error);  // 自动判定是 4xx 还是 5xx
 */

import { NextResponse } from "next/server";
import { logApiError, type ApiErrorContext } from "./logger";

interface SupabaseLikeError {
  code?: string;
  message: string;
}

/**
 * 把数据库/Supabase 错误转成对前端友好的响应：
 * - 已知的客户端错误（约束冲突、外键、RLS）→ 4xx + 结构化 code
 * - 其它 → 500 + 通用文案（不泄露细节）
 */
export function serverError(
  err: SupabaseLikeError | unknown,
  fallbackStatus = 500,
  ctx: ApiErrorContext = {}
) {
  // 服务端结构化日志（不会返回给客户端）；route 有 request 对象时传 requestId/path
  logApiError(err, ctx);

  if (err && typeof err === "object" && "code" in err) {
    const code = (err as SupabaseLikeError).code;
    const msg = (err as SupabaseLikeError).message || "";

    // 唯一约束冲突（重复打标签等）
    if (code === "23505") {
      return NextResponse.json(
        { error: "数据已存在", code: "DUPLICATE" },
        { status: 409 }
      );
    }
    // 外键约束失败
    if (code === "23503") {
      return NextResponse.json(
        { error: "关联资源不存在", code: "FOREIGN_KEY" },
        { status: 400 }
      );
    }
    // RLS 拒绝 / 权限不足
    if (code === "42501") {
      return NextResponse.json(
        { error: "无权操作该资源", code: "FORBIDDEN" },
        { status: 403 }
      );
    }
    // 无效输入（如 UUID 格式错）
    if (code === "22P02") {
      return NextResponse.json(
        { error: "参数格式错误", code: "INVALID_INPUT" },
        { status: 400 }
      );
    }
    // 其它已知错误，message 可能含细节，不直接返回
    void msg;
  }

  return NextResponse.json(
    { error: "服务器内部错误", code: "INTERNAL" },
    { status: fallbackStatus }
  );
}
