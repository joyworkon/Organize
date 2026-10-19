/**
 * 数据库 CRUD API（/api/databases、/api/databases/[id]、.../rows、.../rows/[rowId]）的
 * 请求解析与结果分类（纯函数，供 route 使用）。
 *
 * 诚实性约定（databases-api-honesty）：
 * - 非法 JSON / 顶层非对象 → 400「请求格式错误」，不发任何数据库写；
 * - 合法空对象的 PATCH 没有任何可写入字段 → 400「没有可更新的字段」（与非法 JSON 分开）；
 * - PATCH 0 行（PGRST116，不存在 / 已删 / 不属于本人）→ 404；
 *   真实数据库故障留给 route 走 serverError（不泄露 message）；
 * - DELETE（mutate_trash RPC）affected === 0 → 404，不再假装成功。
 *
 * mock api-shim 没有 /api/databases* handler，本模块只被 route 引用；
 * 新增 handler 时应复用这里的判定。
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
const DATABASE_NOT_FOUND: MutationRejection = { status: 404, error: "数据库不存在" };
const DATABASE_PATCH_NOT_FOUND: MutationRejection = {
  status: 404,
  error: "数据库不存在或无权限",
};
const ROW_PATCH_NOT_FOUND: MutationRejection = { status: 404, error: "行不存在或已删除" };
const DATABASE_DELETE_NOT_FOUND: MutationRejection = {
  status: 404,
  error: "数据库不存在或已删除",
};
const ROW_DELETE_NOT_FOUND: MutationRejection = { status: 404, error: "行不存在或已删除" };

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

export type PatchBuild =
  | { ok: true; updates: Record<string, unknown> }
  | { ok: false; rejection: MutationRejection };

/**
 * 按既有字段规则构建 PATCH databases 的 updates（title / icon / schema / views）。
 * icon 在场但既非 null 也非 string 时不写入 updates（保持现状语义：不得把
 * undefined 写进 updates 再交给 supabase 序列化丢弃）。没有任何可写入字段 → 400。
 */
export function buildDatabasePatchUpdate(body: Record<string, unknown>): PatchBuild {
  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string") updates.title = body.title;
  if ("icon" in body) {
    if (body.icon === null) updates.icon = null;
    else if (typeof body.icon === "string") updates.icon = body.icon;
  }
  if (Array.isArray(body.schema)) updates.schema = body.schema;
  if (Array.isArray(body.views)) updates.views = body.views;
  if (Object.keys(updates).length === 0) {
    return { ok: false, rejection: EMPTY_PATCH };
  }
  return { ok: true, updates };
}

/**
 * 按既有字段规则构建 PATCH rows 的 updates（values / sort）。
 * values 必须是非数组对象；sort 必须是 number。没有任何可写入字段 → 400。
 */
export function buildRowPatchUpdate(body: Record<string, unknown>): PatchBuild {
  const updates: Record<string, unknown> = {};
  if (body.values && typeof body.values === "object" && !Array.isArray(body.values)) {
    updates.values = body.values;
  }
  if (typeof body.sort === "number") updates.sort = body.sort;
  if (Object.keys(updates).length === 0) {
    return { ok: false, rejection: EMPTY_PATCH };
  }
  return { ok: true, updates };
}

interface SupabaseLikeError {
  code?: string;
}

/** PostgREST「0 行」错误（.single() 未命中：不存在 / 已删 / 不属于本人）。 */
export function isNoRowsError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as SupabaseLikeError).code === "PGRST116"
  );
}

/** PATCH databases 错误分类：0 行 → 404；其它 → null（route 走 serverError）。 */
export function databasePatchRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? DATABASE_PATCH_NOT_FOUND : null;
}

/** PATCH rows 错误分类：0 行 → 404；其它 → null（route 走 serverError）。 */
export function rowPatchRejection(error: unknown): MutationRejection | null {
  return isNoRowsError(error) ? ROW_PATCH_NOT_FOUND : null;
}

/**
 * 父库校验分类（rows 三个路由开头共用）：查询错误 → "server-error"（route 走
 * serverError，不泄露 dbErr.message）；无行 → 404「数据库不存在」；命中 → "ok"。
 */
export type ParentDatabaseCheck =
  | { status: "ok" }
  | { status: "server-error" }
  | { status: "rejected"; rejection: MutationRejection };

export function classifyParentDatabase(error: unknown, db: unknown): ParentDatabaseCheck {
  if (error) return { status: "server-error" };
  if (!db) return { status: "rejected", rejection: DATABASE_NOT_FOUND };
  return { status: "ok" };
}

/**
 * DELETE（mutate_trash RPC）结果分类：
 * - RPC error → "server-error"（route 走 serverError，不泄露 message）；
 * - data 非 number 或 affected === 0 → 404（不存在 / 已删，不再假装成功）；
 * - affected > 0 → "ok"。
 */
export type TrashDeleteResolution =
  | { status: "ok"; affected: number }
  | { status: "server-error" }
  | { status: "rejected"; rejection: MutationRejection };

function resolveTrashDelete(
  error: unknown,
  data: unknown,
  notFound: MutationRejection
): TrashDeleteResolution {
  if (error) return { status: "server-error" };
  const affected = typeof data === "number" ? data : 0;
  if (affected === 0) return { status: "rejected", rejection: notFound };
  return { status: "ok", affected };
}

export function resolveDatabaseDelete(error: unknown, data: unknown): TrashDeleteResolution {
  return resolveTrashDelete(error, data, DATABASE_DELETE_NOT_FOUND);
}

export function resolveRowDelete(error: unknown, data: unknown): TrashDeleteResolution {
  return resolveTrashDelete(error, data, ROW_DELETE_NOT_FOUND);
}
