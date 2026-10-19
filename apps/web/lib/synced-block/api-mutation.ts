/**
 * 同步区块 API 写路径的请求解析与校验（纯函数，便于单测）。
 *
 * 诚实性约定（synced-blocks-api-honesty）：
 * - 非法 JSON → 400「请求格式错误」；
 * - content 缺失或不是数组 → 400「同步区块内容格式错误」，绝不静默当空数组
 *   （旧行为会把区块静默覆盖成空内容 / 创建空区块并假装成功）；
 * - POST 的 id 提供了但不是非空字符串 → 400；
 * - DELETE 按实际删除行数判定：0 行 → 404「同步区块不存在或已删除」。
 * route 只按这里的结果分支映射为 NextResponse，响应形状（200/201/409/404）不变。
 */

export interface MutationRejection {
  status: number;
  error: string;
}

export type BodyParseResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; rejection: MutationRejection };

const INVALID_JSON: MutationRejection = { status: 400, error: "请求格式错误" };
const INVALID_CONTENT: MutationRejection = { status: 400, error: "同步区块内容格式错误" };
const INVALID_ID: MutationRejection = { status: 400, error: "同步区块 id 格式错误" };
const DELETE_NOT_FOUND: MutationRejection = { status: 404, error: "同步区块不存在或已删除" };

/** 解析 JSON 请求体；非法 JSON 或非对象顶层 → 400。 */
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

function readContent(body: Record<string, unknown>): unknown[] | null {
  return Array.isArray(body.content) ? body.content : null;
}

export type CreateBlockInput =
  | { ok: true; content: unknown[]; id?: string }
  | { ok: false; rejection: MutationRejection };

/** POST 入参：content 必须是数组；id 可选，但提供了就必须是非空字符串。 */
export function validateCreateBody(body: Record<string, unknown>): CreateBlockInput {
  const content = readContent(body);
  if (!content) return { ok: false, rejection: INVALID_CONTENT };
  if (body.id !== undefined) {
    if (typeof body.id !== "string" || body.id.length === 0) {
      return { ok: false, rejection: INVALID_ID };
    }
    return { ok: true, content, id: body.id };
  }
  return { ok: true, content };
}

export type PatchBlockInput =
  | { ok: true; content: unknown[]; expectedRevision: number | null }
  | { ok: false; rejection: MutationRejection };

/**
 * PATCH 入参：content 必须是数组（缺失/非数组一律 400，不调 RPC、不覆盖）。
 * expected_revision 语义不变：非整数当 null（缺省兜底覆盖）。
 */
export function validatePatchBody(body: Record<string, unknown>): PatchBlockInput {
  const content = readContent(body);
  if (!content) return { ok: false, rejection: INVALID_CONTENT };
  const expectedRevision =
    typeof body.expected_revision === "number" && Number.isInteger(body.expected_revision)
      ? body.expected_revision
      : null;
  return { ok: true, content, expectedRevision };
}

export type DeleteBlockResult = { ok: true } | { ok: false; rejection: MutationRejection };

/** DELETE 结果：0 行（不存在/已删/不属于本人）→ 404，否则 { ok: true }。 */
export function deleteBlockResult(deletedCount: number): DeleteBlockResult {
  if (deletedCount <= 0) return { ok: false, rejection: DELETE_NOT_FOUND };
  return { ok: true };
}
