/**
 * 笔记块评论 API（/api/notes/[id]/comments）请求解析与结果分类（纯函数，供 route 使用）。
 *
 * 诚实性约定（notes-comments-api-honesty）：
 * - 非法 JSON / 顶层非对象 → 400「请求格式错误」（复用 api-mutation 的 parseJsonBody），不发任何数据库写；
 * - POST：blockId / body 必须是字符串（不再 String() 强转），trim 后非空且 ≤5000；
 *   threadId 提供时必须是字符串，否则 400「请求格式错误」；
 * - PATCH：commentId 优先（编辑评论，body 必须字符串），其次 threadId（切换解决态，resolved 必须 boolean）；
 *   字段类型不符 → 400「请求格式错误」，两者皆缺 → 400「无效操作」；
 * - DELETE：commentId / threadId 必须是字符串，两者皆缺 → 400「无效操作」；
 * - note 上下文与 PATCH 的 PGRST116（0 行：不存在 / 不属于本人）→ 404；
 *   其它错误返回 null，route 走 serverError 500（不泄露 message）；
 * - DELETE 0 行 → 404，不再假装 { success: true }。
 */

import {
  isNoRowsError,
  parseJsonBody,
  type MutationRejection,
} from "./api-mutation";

const INVALID_JSON: MutationRejection = { status: 400, error: "请求格式错误" };
const INVALID_COMMENT: MutationRejection = { status: 400, error: "评论内容无效" };
const INVALID_OPERATION: MutationRejection = { status: 400, error: "无效操作" };
const NOTE_NOT_FOUND: MutationRejection = { status: 404, error: "笔记不存在" };
const THREAD_NOT_FOUND: MutationRejection = { status: 404, error: "评论线程不存在" };
const COMMENT_NOT_FOUND: MutationRejection = {
  status: 404,
  error: "评论不存在或无权限",
};

export const MAX_COMMENT_LENGTH = 5000;

type ParseResult<T> =
  | { ok: true; input: T }
  | { ok: false; rejection: MutationRejection };

/** 字段「提供了」的判定：非 undefined / null / 空串。 */
function provided(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

// ---- POST ----

export interface CommentPostInput {
  blockId: string;
  text: string;
  threadId?: string;
}

/** 从已解析的 body 抽出 POST 入参；字段类型 / 取值不合法 → 400。 */
export function resolveCommentPostInput(
  body: Record<string, unknown>
): ParseResult<CommentPostInput> {
  if (provided(body.threadId) && typeof body.threadId !== "string") {
    return { ok: false, rejection: INVALID_JSON };
  }
  if (typeof body.blockId !== "string" || typeof body.body !== "string") {
    return { ok: false, rejection: INVALID_COMMENT };
  }
  const blockId = body.blockId.trim();
  const text = body.body.trim();
  if (!blockId || !text || text.length > MAX_COMMENT_LENGTH) {
    return { ok: false, rejection: INVALID_COMMENT };
  }
  const threadId = provided(body.threadId) ? (body.threadId as string) : undefined;
  return { ok: true, input: { blockId, text, threadId } };
}

/** 解析 POST JSON 请求体；非法 JSON / 非对象 → 400。 */
export async function parseCommentsPostBody(
  request: Request
): Promise<ParseResult<CommentPostInput>> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed;
  return resolveCommentPostInput(parsed.body);
}

// ---- PATCH ----

export type CommentPatchInput =
  | { kind: "edit-comment"; commentId: string; text: string }
  | { kind: "toggle-resolved"; threadId: string; resolved: boolean };

/** 从已解析的 body 判别 PATCH 操作；字段类型不符 / 取值不合法 → 400。 */
export function resolveCommentPatchInput(
  body: Record<string, unknown>
): ParseResult<CommentPatchInput> {
  if (provided(body.commentId)) {
    if (typeof body.commentId !== "string" || typeof body.body !== "string") {
      return { ok: false, rejection: INVALID_JSON };
    }
    const text = body.body.trim();
    if (!text || text.length > MAX_COMMENT_LENGTH) {
      return { ok: false, rejection: INVALID_COMMENT };
    }
    return { ok: true, input: { kind: "edit-comment", commentId: body.commentId, text } };
  }
  if (provided(body.threadId)) {
    if (typeof body.threadId !== "string" || typeof body.resolved !== "boolean") {
      return { ok: false, rejection: INVALID_JSON };
    }
    return {
      ok: true,
      input: { kind: "toggle-resolved", threadId: body.threadId, resolved: body.resolved },
    };
  }
  return { ok: false, rejection: INVALID_OPERATION };
}

/** 解析 PATCH JSON 请求体；非法 JSON / 非对象 → 400。 */
export async function parseCommentsPatchBody(
  request: Request
): Promise<ParseResult<CommentPatchInput>> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed;
  return resolveCommentPatchInput(parsed.body);
}

// ---- DELETE ----

export type CommentDeleteInput =
  | { kind: "comment"; commentId: string }
  | { kind: "thread"; threadId: string };

/** 从已解析的 body 判别 DELETE 目标；字段类型不符 → 400，皆缺 → 400「无效操作」。 */
export function resolveCommentDeleteInput(
  body: Record<string, unknown>
): ParseResult<CommentDeleteInput> {
  if (provided(body.commentId)) {
    if (typeof body.commentId !== "string") {
      return { ok: false, rejection: INVALID_JSON };
    }
    return { ok: true, input: { kind: "comment", commentId: body.commentId } };
  }
  if (provided(body.threadId)) {
    if (typeof body.threadId !== "string") {
      return { ok: false, rejection: INVALID_JSON };
    }
    return { ok: true, input: { kind: "thread", threadId: body.threadId } };
  }
  return { ok: false, rejection: INVALID_OPERATION };
}

/** 解析 DELETE JSON 请求体；非法 JSON / 非对象 → 400。 */
export async function parseCommentsDeleteBody(
  request: Request
): Promise<ParseResult<CommentDeleteInput>> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed;
  return resolveCommentDeleteInput(parsed.body);
}

// ---- Supabase 结果分类（null = route 走 serverError） ----

/** getContext 的 note 查询：0 行 → 404「笔记不存在」；其它错误 → null。 */
export function noteContextRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? NOTE_NOT_FOUND : null;
}

/** POST 回复路径的线程查询：0 行 → 404「评论线程不存在」；其它错误 → null。 */
export function threadLookupRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? THREAD_NOT_FOUND : null;
}

/** PATCH 编辑评论：0 行 → 404「评论不存在或无权限」；其它错误 → null。 */
export function commentPatchRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? COMMENT_NOT_FOUND : null;
}

/** PATCH 切换解决态：0 行 → 404「评论线程不存在」；其它错误 → null。 */
export function threadPatchRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? THREAD_NOT_FOUND : null;
}

/** DELETE 评论：删到 0 行 → 404「评论不存在或无权限」。 */
export function commentDeleteRejection(affected: number): MutationRejection | null {
  return affected === 0 ? COMMENT_NOT_FOUND : null;
}

/** DELETE 线程：删到 0 行 → 404「评论线程不存在」。 */
export function threadDeleteRejection(affected: number): MutationRejection | null {
  return affected === 0 ? THREAD_NOT_FOUND : null;
}
