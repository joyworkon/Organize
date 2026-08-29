/**
 * 任务原子变更协议的客户端封装（P1-03）。
 *
 * 在线与离线的任务字段更新都走 update_task_atomic RPC：
 * - 携带 expectedSyncVersion（来自本地加载的任务行）→ 服务端原子校验+应用，
 *   双设备并发修改时后到者收到 conflict，绝不静默覆盖；
 * - 携带 mutationId（与离线队列 op_id 同源）→ 响应丢失后的重放返回
 *   already_applied，不会二次应用。
 * expectedSyncVersion 传 null 表示跳过版本校验（人工冲突处理后「以我的字段重放」
 * 的场景）；服务端仍会递增版本。
 */

type AnyClient = ReturnType<typeof import("@/lib/supabase/client").createClient>;

export type AtomicUpdateResult =
  | { status: "applied"; syncVersion: number }
  | { status: "already_applied" }
  | { status: "conflict"; currentSyncVersion: number | null }
  | { status: "not_found" }
  | { status: "error"; error: unknown };

/** 解析 RPC 返回的 jsonb（独立导出便于测试） */
export function parseAtomicUpdateResponse(data: unknown): AtomicUpdateResult {
  if (!data || typeof data !== "object" || typeof (data as { status?: unknown }).status !== "string") {
    return { status: "error", error: new Error("update_task_atomic 返回了无法解析的结果") };
  }
  const raw = data as { status: string; sync_version?: unknown; current_sync_version?: unknown };
  switch (raw.status) {
    case "applied":
      return {
        status: "applied",
        syncVersion: typeof raw.sync_version === "number" ? raw.sync_version : Number(raw.sync_version),
      };
    case "already_applied":
      return { status: "already_applied" };
    case "conflict":
      return {
        status: "conflict",
        currentSyncVersion: typeof raw.current_sync_version === "number" ? raw.current_sync_version : null,
      };
    case "not_found":
      return { status: "not_found" };
    default:
      return { status: "error", error: new Error(`未知的协议状态: ${raw.status}`) };
  }
}

export async function applyTaskUpdate(
  supabase: AnyClient,
  taskId: string,
  patch: Record<string, unknown>,
  expectedSyncVersion: number | null,
  mutationId: string
): Promise<AtomicUpdateResult> {
  let data: unknown;
  let error: unknown = null;
  try {
    const response = await supabase.rpc("update_task_atomic", {
      p_task_id: taskId,
      p_patch: patch,
      p_expected_sync_version: expectedSyncVersion,
      p_mutation_id: mutationId,
    });
    data = response.data;
    error = response.error;
  } catch (caught) {
    error = caught;
  }
  if (error) return { status: "error", error };
  return parseAtomicUpdateResponse(data);
}
