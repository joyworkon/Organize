// 插件 API（/api/plugins、/api/plugins/[id]）与插件页开关写路径的判定逻辑，集中在一处便于单测。
// 约定：非法 JSON、空 PATCH、0 行写入都显式分类，route 只按结果分支；
// 数据库错误一律走 serverError 通用文案，不把 error.message 原样泄露给前端。

/** request.json() 的纯函数等价：非法 JSON / 空体 → { ok: false }，非对象（null、标量）按空对象处理 */
export type JsonBodyOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false };

export function parseJsonBody(text: string): JsonBodyOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { ok: true, body: {} };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

/** PATCH 字段判定：config / enabled 都未提供时不发 update */
export type PluginPatchOutcome =
  | { ok: true; updateData: Record<string, unknown> }
  | { ok: false };

export function buildPluginPatch(body: Record<string, unknown>): PluginPatchOutcome {
  const updateData: Record<string, unknown> = {};
  if (body.config !== undefined) updateData.config = body.config;
  if (body.enabled !== undefined) updateData.enabled = body.enabled;
  return Object.keys(updateData).length > 0 ? { ok: true, updateData } : { ok: false };
}

export type PluginRouteOutcome = "ok" | "not-found" | "server-error";

/** PATCH .update().select().maybeSingle() 的结果最小形状 */
export interface PluginPatchResult {
  data: { id: string } | null;
  error: { code?: string | null } | null;
}

/** error 优先（PGRST116 = .single() 0 行，归为 not-found）；无 error 但 data 为 null（.maybeSingle() 0 行）也是 not-found */
export function readPluginPatchResult(result: PluginPatchResult): PluginRouteOutcome {
  if (result.error) {
    return result.error.code === "PGRST116" ? "not-found" : "server-error";
  }
  return result.data ? "ok" : "not-found";
}

/** DELETE .delete().select("id") 的结果最小形状 */
export interface PluginDeleteResult {
  data: { id: string }[] | null;
  error: { code?: string | null } | null;
}

/** 删除：任何 error 按 server-error，0 行说明不存在 / 已卸载 / 不属于本人 */
export function readPluginDeleteResult(result: PluginDeleteResult): PluginRouteOutcome {
  if (result.error) return "server-error";
  return result.data && result.data.length > 0 ? "ok" : "not-found";
}

export const PLUGIN_RECORDS_LOAD_ERROR = "加载插件配置失败，请重试";

/** 插件页 togglePlugin 的 GET /api/plugins 结果判定：非 2xx 或返回不是数组时给可读错误，不再 .find 抛 TypeError */
export type PluginRecordsOutcome =
  | { ok: true; records: { id: string; package_name: string }[] }
  | { ok: false; message: string };

export function readPluginRecords(responseOk: boolean, body: unknown): PluginRecordsOutcome {
  if (!responseOk || !Array.isArray(body)) {
    return { ok: false, message: PLUGIN_RECORDS_LOAD_ERROR };
  }
  return { ok: true, records: body as { id: string; package_name: string }[] };
}
