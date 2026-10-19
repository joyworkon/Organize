/**
 * 任务清单删除/更新的远端写封装（写诚实性）。
 *
 * supabase 写失败不抛异常（返回 error），RLS 拒绝时 error=null 且影响 0 行——
 * 两条路都必须显式判定，不能靠 try/catch 兜底：
 * - 删除清单第一步（任务移到未分类）：0 行属正常（空清单），只看 error；
 * - 删除清单第二步（软删清单）与更新清单：带 `.select("id")`，error / 0 行 /
 *   抛异常一律视为失败。
 * 异常一律在本模块内捕获，不向外抛未处理 rejection。
 */
import type { TaskList } from "@organize/shared";

type AnyClient = ReturnType<typeof import("@/lib/supabase/client").createClient>;

export type DeleteTaskListResult =
  | { ok: true }
  | { ok: false; stage: "move-tasks" | "delete-list" };

/** 删除清单的两步远端写（任务移到未分类 → 软删清单）；第一步失败不执行第二步 */
export async function deleteTaskListRemote(
  supabase: AnyClient,
  listId: string
): Promise<DeleteTaskListResult> {
  let moveError: unknown = null;
  try {
    const { error } = await supabase
      .from("tasks")
      .update({ list_id: null })
      .eq("list_id", listId);
    moveError = error;
  } catch (error) {
    moveError = error;
  }
  if (moveError) return { ok: false, stage: "move-tasks" };

  try {
    const { data, error } = await supabase
      .from("task_lists")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", listId)
      .select("id");
    if (error || !data || data.length === 0) {
      return { ok: false, stage: "delete-list" };
    }
    return { ok: true };
  } catch {
    return { ok: false, stage: "delete-list" };
  }
}

/** 更新清单（改名/图标/颜色）；RLS 0 行视为失败 */
export async function updateTaskListRemote(
  supabase: AnyClient,
  listId: string,
  patch: Partial<TaskList>
): Promise<{ ok: boolean }> {
  try {
    const { data, error } = await supabase
      .from("task_lists")
      .update(patch)
      .eq("id", listId)
      .select("id");
    if (error || !data || data.length === 0) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
