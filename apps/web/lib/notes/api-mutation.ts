/**
 * 笔记 CRUD API（/api/notes、/api/notes/[id]）的请求解析与结果分类（纯函数，供 route 使用）。
 *
 * 诚实性约定（notes-api-honesty）：
 * - 非法 JSON / 顶层非对象 → 400「请求格式错误」，不发任何数据库写；
 * - PATCH 没有任何可写入字段 → 400「没有可更新的字段」，不发 update、不递增 content_revision；
 * - PATCH / GET 0 行（PGRST116）→ 404，真实数据库故障留给 route 走 serverError（不泄露 message）；
 * - DELETE affected === 0 → 404「笔记不存在或已删除」，不再假装成功。
 *
 * mock api-shim 没有 /api/notes 的 GET/POST 与 /api/notes/:id 的 GET/PATCH/DELETE handler，
 * 本模块只被 route 引用；新增 handler 时应复用这里的判定。
 */

export interface MutationRejection {
  status: number;
  error: string;
  code?: string;
}

export type BodyParseResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; rejection: MutationRejection };

const INVALID_JSON: MutationRejection = { status: 400, error: "请求格式错误" };
const EMPTY_PATCH: MutationRejection = { status: 400, error: "没有可更新的字段" };
const GET_NOT_FOUND: MutationRejection = { status: 404, error: "笔记不存在" };
const PATCH_NOT_FOUND: MutationRejection = { status: 404, error: "笔记不存在或无权限" };
const DELETE_NOT_FOUND: MutationRejection = { status: 404, error: "笔记不存在或已删除" };
const DELETE_RPC_FAILED: MutationRejection = {
  status: 500,
  error: "删除笔记失败",
  code: "TRASH_MUTATION_FAILED",
};

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

export type NotePatchBuild =
  | { ok: true; updateData: Record<string, unknown> }
  | { ok: false; rejection: MutationRejection };

/**
 * 按既有字段规则构建 PATCH updateData（parent_note_id 的存在性/循环校验需查库，
 * 留在 route；这里只做类型门槛）。没有任何可写入字段 → 400。
 */
export function buildNotePatchUpdate(body: Record<string, unknown>): NotePatchBuild {
  const {
    title,
    content,
    reading_item_id,
    icon,
    cover_url,
    cover_position,
    parent_note_id,
    full_width,
    font_family,
    small_font,
    page_template,
  } = body;

  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title;
  if (content !== undefined) updateData.content = content;
  if (reading_item_id !== undefined) updateData.reading_item_id = reading_item_id;
  if (icon === null || typeof icon === "string") updateData.icon = icon;
  if (cover_url === null || typeof cover_url === "string") {
    updateData.cover_url = cover_url;
  }
  if (typeof cover_position === "number") {
    updateData.cover_position = Math.max(0, Math.min(100, Math.round(cover_position)));
  }
  if (parent_note_id === null || typeof parent_note_id === "string") {
    updateData.parent_note_id = parent_note_id;
  }
  if (typeof full_width === "boolean") updateData.full_width = full_width;
  if (font_family === "default" || font_family === "serif" || font_family === "mono") {
    updateData.font_family = font_family;
  }
  if (typeof small_font === "boolean") updateData.small_font = small_font;
  if (page_template === "default" || page_template === "red-blue") {
    updateData.page_template = page_template;
  }

  if (Object.keys(updateData).length === 0) {
    return { ok: false, rejection: EMPTY_PATCH };
  }
  return { ok: true, updateData };
}

interface SupabaseLikeError {
  code?: string;
}

/** PostgREST「0 行」错误（.single() 未命中：不存在 / 不属于本人）。 */
export function isNoRowsError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as SupabaseLikeError).code === "PGRST116"
  );
}

/** GET [id] 错误分类：0 行 → 404 文案；其它 → null（route 走 serverError）。 */
export function noteGetRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? GET_NOT_FOUND : null;
}

/** PATCH 错误分类：0 行 → 404 文案；其它 → null（route 走 serverError）。 */
export function notePatchRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? PATCH_NOT_FOUND : null;
}

export type NoteDeleteResult =
  | { ok: true; affected: number }
  | { ok: false; rejection: MutationRejection };

/** DELETE（mutate_trash RPC）结果分类：RPC error → 500 通用文案；0 行 → 404；否则成功。 */
export function resolveNoteDelete(error: unknown, affected: number): NoteDeleteResult {
  if (error) return { ok: false, rejection: DELETE_RPC_FAILED };
  if (affected === 0) return { ok: false, rejection: DELETE_NOT_FOUND };
  return { ok: true, affected };
}
