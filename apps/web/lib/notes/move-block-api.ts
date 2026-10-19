/**
 * 跨笔记移动块 API（/api/notes/[id]/move-block）请求解析与 RPC 错误分类（纯函数，供 route 使用）。
 *
 * 诚实性约定（notes-move-block-api-honesty）：
 * - 非法 JSON / 顶层非对象 → 400「请求格式错误」（复用 api-mutation 的 parseJsonBody），不调用 RPC；
 * - targetNoteId / blockId 必须是非空字符串，且 targetNoteId ≠ 源笔记 id → 400「移动目标无效」（不再 String() 强转）；
 * - RPC move_note_block 主动 raise 的业务错误（见 supabase/migrations/051）映射为稳定中文文案，
 *   不回显原始 message：
 *     'Note not found or access denied'        → 404「笔记不存在或无权限」
 *     'Block not found'                        → 404「块不存在」
 *     'Source and target notes must be different' → 400「移动目标无效」
 *   其它错误返回 null，route 走 serverError 500。
 */

import { parseJsonBody, type MutationRejection } from "./api-mutation";

const INVALID_TARGET: MutationRejection = { status: 400, error: "移动目标无效" };
const NOTE_NOT_FOUND: MutationRejection = { status: 404, error: "笔记不存在或无权限" };
const BLOCK_NOT_FOUND: MutationRejection = { status: 404, error: "块不存在" };

/** move_note_block RPC 主动 raise 的 message（supabase/migrations/051_note_save_status_and_move_revision.sql）。 */
export const RPC_ERR_SAME_NOTE = "Source and target notes must be different";
export const RPC_ERR_NOTE_NOT_FOUND = "Note not found or access denied";
export const RPC_ERR_BLOCK_NOT_FOUND = "Block not found";

type ParseResult<T> =
  | { ok: true; input: T }
  | { ok: false; rejection: MutationRejection };

export interface MoveBlockInput {
  targetNoteId: string;
  blockId: string;
}

/** 从已解析的 body 抽出移动入参；字段非字符串 / 为空 / 目标即源 → 400「移动目标无效」。 */
export function resolveMoveBlockInput(
  body: Record<string, unknown>,
  sourceNoteId: string
): ParseResult<MoveBlockInput> {
  if (typeof body.targetNoteId !== "string" || typeof body.blockId !== "string") {
    return { ok: false, rejection: INVALID_TARGET };
  }
  const targetNoteId = body.targetNoteId.trim();
  const blockId = body.blockId.trim();
  if (!targetNoteId || !blockId || targetNoteId === sourceNoteId) {
    return { ok: false, rejection: INVALID_TARGET };
  }
  return { ok: true, input: { targetNoteId, blockId } };
}

/** 解析 POST JSON 请求体；非法 JSON / 非对象 → 400。 */
export async function parseMoveBlockBody(
  request: Request,
  sourceNoteId: string
): Promise<ParseResult<MoveBlockInput>> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed;
  return resolveMoveBlockInput(parsed.body, sourceNoteId);
}

interface RpcLikeError {
  message?: unknown;
}

/** RPC 错误分类：已知业务错误 → 稳定中文文案；其它 → null（route 走 serverError）。 */
export function moveBlockRpcRejection(error: unknown): MutationRejection | null {
  const message =
    error && typeof error === "object" ? String((error as RpcLikeError).message ?? "") : "";
  if (message.includes(RPC_ERR_NOTE_NOT_FOUND)) return NOTE_NOT_FOUND;
  if (message.includes(RPC_ERR_BLOCK_NOT_FOUND)) return BLOCK_NOT_FOUND;
  if (message.includes(RPC_ERR_SAME_NOTE)) return INVALID_TARGET;
  return null;
}
