/**
 * 构思画布 PATCH 写路径的请求解析与校验（纯函数，route 与 mock api-shim 共用）。
 *
 * 诚实性约定（canvas-patch-cas-honesty）：
 * - 非法 JSON / 顶层非对象 → 400「请求格式错误」，不调 RPC、不覆盖；
 * - title 提供了但不是字符串 → 400「画布标题格式错误」（缺省 = 保留原标题）；
 * - title 与 content 都没提供 → 400「没有可更新的内容」（不再静默清空标题）；
 * - content 提供了 → 走 validateCanvasContent（v1 自动迁移 v2），失败 400 带 errors；
 * - expected_revision 语义不变：非数字当 null（缺省兜底覆盖），数字取整。
 */

import { validateCanvasContent, type CanvasValidationOptions } from "./validation";
import type { CanvasDoc } from "./model";

export interface MutationRejection {
  status: number;
  error: string;
  /** content 校验失败时的逐条错误（形状与既有 400 响应一致）。 */
  errors?: string[];
}

export type BodyParseResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; rejection: MutationRejection };

const INVALID_JSON: MutationRejection = { status: 400, error: "请求格式错误" };
const INVALID_TITLE: MutationRejection = { status: 400, error: "画布标题格式错误" };
const EMPTY_PATCH: MutationRejection = { status: 400, error: "没有可更新的内容" };

/** 解析 JSON 请求体；非法 JSON 或顶层非对象 → 400。 */
export async function parseJsonBody(request: Request): Promise<BodyParseResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, rejection: INVALID_JSON };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, rejection: INVALID_JSON };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

export type PatchCanvasInput =
  | { ok: true; title?: string; content?: CanvasDoc; expectedRevision: number | null }
  | { ok: false; rejection: MutationRejection };

/** PATCH 入参校验；body 非对象同样 400（mock shim 的 body 已在外层解析）。 */
export function validateCanvasPatchBody(
  body: unknown,
  options?: CanvasValidationOptions,
): PatchCanvasInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, rejection: INVALID_JSON };
  }
  const input = body as Record<string, unknown>;

  let title: string | undefined;
  if (input.title !== undefined) {
    if (typeof input.title !== "string") {
      return { ok: false, rejection: INVALID_TITLE };
    }
    title = input.title.slice(0, 200);
  }

  let content: CanvasDoc | undefined;
  if (input.content !== undefined) {
    const validation = validateCanvasContent(input.content, options);
    if (!validation.ok) {
      return {
        ok: false,
        rejection: { status: 400, error: "画布内容校验失败", errors: validation.errors },
      };
    }
    // v1 输入迁移后的 v2 落库（validation.doc 恒为 v2）
    content = validation.doc ?? (input.content as CanvasDoc);
  }

  if (title === undefined && content === undefined) {
    return { ok: false, rejection: EMPTY_PATCH };
  }

  const expectedRevision =
    typeof input.expected_revision === "number" && Number.isFinite(input.expected_revision)
      ? Math.trunc(input.expected_revision)
      : null;
  return { ok: true, title, content, expectedRevision };
}
