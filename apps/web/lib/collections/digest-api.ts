/** 整理稿 API 的输入与错误分类；数据库细节仅交给 route 的 serverError 记录。 */
import { DigestBudgetError } from "./digest-server";

interface DigestBody {
  sourceType?: unknown;
  ids?: unknown;
  /** 只预览预算与来源，不调用 AI、不写库。 */
  preview?: unknown;
}

export function parseDigestBody(value: unknown): DigestBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

type DigestQueryResult<T> =
  | { state: "error"; error: unknown }
  | { state: "missing" }
  | { state: "ok"; data: NonNullable<T> };

/** 来源、幂等与保存查询均先判 error，不能把失败当成无行或成功。 */
export function classifyDigestQuery<T extends {
  data: unknown;
  error: unknown;
}>(result: T): DigestQueryResult<T["data"]> {
  if (result.error) return { state: "error", error: result.error };
  if (!result.data) return { state: "missing" };
  return { state: "ok", data: result.data };
}

/** 只有明确的预算超限可回显；未知异常交给 serverError。 */
export function classifyDigestBudgetError(error: unknown): { status: 413; error: string } | null {
  if (error instanceof DigestBudgetError) return { status: 413, error: error.message };
  return null;
}
