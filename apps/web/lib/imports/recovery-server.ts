/**
 * 导入历史/中断恢复的服务端共享逻辑（阶段 1）。
 * 独立成模块的原因：Next.js route 文件只允许导出 route handler，
 * GET（惰性回收+分页）与 POST（同键重试后的任务收口）共用这里的实现。
 */
import { IMPORT_STALE_THRESHOLD_MS, INTERRUPTED_ERROR_MESSAGE } from "@/lib/imports/stale";
import type { ImportFileResult, ImportKind } from "@/lib/imports/types";

type Db = { from: (table: string) => any };

export interface ImportFileRow {
  id: string;
  task_id: string;
  retry_key: string;
  file_name: string;
  kind: string;
  size: number | string;
  status: ImportFileResult["status"];
  error: string | null;
  reading_item_id: string | null;
  page_count: number | null;
  /** DOCX 嵌入图等派生资产路径（091 起一等记录；DB 默认 '{}'） */
  asset_paths?: string[];
  storage_path?: string | null;
  created_at: string;
  updated_at: string;
}

export function toResult(row: ImportFileRow): ImportFileResult {
  return {
    id: row.id, taskId: row.task_id, fileName: row.file_name,
    kind: row.kind as ImportKind, size: Number(row.size),
    status: row.status, error: row.error, readingItemId: row.reading_item_id,
    pageCount: row.page_count, createdAt: row.created_at, retryKey: row.retry_key,
  };
}

/**
 * 任务状态与逐文件状态对齐：全部 saved → saved；全部 failed → failed；
 * 混合 → partial；仍有进行中 → processing；无文件（空任务）→ failed。
 */
export async function recomputeTaskStatus(supabase: Db, userId: string, taskId: string): Promise<string> {
  const { data: rows } = await supabase
    .from("import_files").select("status")
    .eq("user_id", userId).eq("task_id", taskId);
  const list = (rows ?? []) as Array<{ status: string }>;
  let status: string;
  if (list.length === 0) {
    status = "failed";
  } else if (list.some((r) => r.status === "pending" || r.status === "uploading" || r.status === "parsing")) {
    status = "processing";
  } else {
    const saved = list.filter((r) => r.status === "saved").length;
    const failed = list.filter((r) => r.status === "failed").length;
    status = failed === 0 ? "saved" : saved === 0 ? "failed" : "partial";
  }
  await supabase.from("import_tasks").update({ status }).eq("id", taskId).eq("user_id", userId);
  return status;
}

/** 惰性中断回收：把超阈值仍停在 uploading/parsing 的行标记 failed，并收口其任务（GET/POST 共用）。 */
export async function recoverStaleImports(supabase: Db, userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - IMPORT_STALE_THRESHOLD_MS).toISOString();
  const { data: staleRows } = await supabase
    .from("import_files")
    .select("id, task_id")
    .eq("user_id", userId)
    .in("status", ["uploading", "parsing"])
    .lt("updated_at", cutoff);
  if (!staleRows?.length) return 0;
  // 带同一 cutoff 条件更新：select 与 update 之间被在途请求推进的行不会被误杀
  const { data: updated } = await supabase
    .from("import_files")
    .update({ status: "failed", error: INTERRUPTED_ERROR_MESSAGE })
    .eq("user_id", userId)
    .in("id", staleRows.map((r: ImportFileRow) => r.id))
    .lt("updated_at", cutoff)
    .select("id");
  const recoveredIds = new Set((updated ?? []).map((r: { id: string }) => r.id));
  const affectedTaskIds: string[] = staleRows
    .filter((r: { id: string }) => recoveredIds.has(r.id))
    .map((r: { task_id: string }) => r.task_id);
  for (const taskId of [...new Set(affectedTaskIds)]) {
    await recomputeTaskStatus(supabase, userId, taskId);
  }
  return recoveredIds.size;
}
