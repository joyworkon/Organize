/**
 * 笔记块建议 API（/api/notes/[id]/suggestions）请求解析与结果分类（纯函数，供 route 使用）。
 *
 * 诚实性约定（notes-suggestions-api-honesty）：
 * - 非法 JSON / 顶层非对象 → 400「请求格式错误」（复用 api-mutation 的 parseJsonBody），不发任何数据库写；
 * - POST：blockId 必须是非空字符串，originalBlock / proposedBlock 必须是对象 → 400「建议内容不完整」；
 * - PATCH：suggestionId 必须是非空字符串、status 必须是 accepted / rejected → 400「无效状态」；
 * - PATCH 更新的 PGRST116（0 行：建议不存在 / 已处理 / 不属于本笔记）→ 409「建议不存在或已处理」；
 *   其它错误返回 null，route 走 serverError 500（不泄露 message）。
 */

import {
  isNoRowsError,
  parseJsonBody,
  type MutationRejection,
} from "./api-mutation";

const INVALID_SUGGESTION: MutationRejection = { status: 400, error: "建议内容不完整" };
const INVALID_STATUS: MutationRejection = { status: 400, error: "无效状态" };
const NOTE_NOT_FOUND: MutationRejection = { status: 404, error: "笔记不存在" };
const SUGGESTION_CONFLICT: MutationRejection = { status: 409, error: "建议不存在或已处理" };

export const SUGGESTION_STATUSES = ["accepted", "rejected"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

type ParseResult<T> =
  | { ok: true; input: T }
  | { ok: false; rejection: MutationRejection };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// ---- POST ----

export interface SuggestionPostInput {
  blockId: string;
  originalBlock: Record<string, unknown>;
  proposedBlock: Record<string, unknown>;
}

/** 从已解析的 body 抽出 POST 入参；字段缺失 / 类型不符 → 400「建议内容不完整」。 */
export function resolveSuggestionPostInput(
  body: Record<string, unknown>
): ParseResult<SuggestionPostInput> {
  if (typeof body.blockId !== "string") {
    return { ok: false, rejection: INVALID_SUGGESTION };
  }
  const blockId = body.blockId.trim();
  if (!blockId || !isPlainObject(body.originalBlock) || !isPlainObject(body.proposedBlock)) {
    return { ok: false, rejection: INVALID_SUGGESTION };
  }
  return {
    ok: true,
    input: { blockId, originalBlock: body.originalBlock, proposedBlock: body.proposedBlock },
  };
}

/** 解析 POST JSON 请求体；非法 JSON / 非对象 → 400。 */
export async function parseSuggestionsPostBody(
  request: Request
): Promise<ParseResult<SuggestionPostInput>> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed;
  return resolveSuggestionPostInput(parsed.body);
}

// ---- PATCH ----

export interface SuggestionPatchInput {
  suggestionId: string;
  status: SuggestionStatus;
}

/** 从已解析的 body 抽出 PATCH 入参；suggestionId 非字符串 / status 非法 → 400「无效状态」。 */
export function resolveSuggestionPatchInput(
  body: Record<string, unknown>
): ParseResult<SuggestionPatchInput> {
  if (
    typeof body.suggestionId !== "string" ||
    !body.suggestionId ||
    !SUGGESTION_STATUSES.includes(body.status as SuggestionStatus)
  ) {
    return { ok: false, rejection: INVALID_STATUS };
  }
  return {
    ok: true,
    input: { suggestionId: body.suggestionId, status: body.status as SuggestionStatus },
  };
}

/** 解析 PATCH JSON 请求体；非法 JSON / 非对象 → 400。 */
export async function parseSuggestionsPatchBody(
  request: Request
): Promise<ParseResult<SuggestionPatchInput>> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed;
  return resolveSuggestionPatchInput(parsed.body);
}

// ---- Supabase 结果分类（null = route 走 serverError） ----

/** authorize 的 note 查询：0 行（不存在 / 不属于本人）→ 404；其它错误 → null。 */
export function suggestionNoteRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? NOTE_NOT_FOUND : null;
}

/** PATCH 更新：0 行（建议不存在 / 已处理 / 不属于本笔记）→ 409；其它错误 → null。 */
export function suggestionPatchRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? SUGGESTION_CONFLICT : null;
}
