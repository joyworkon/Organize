/**
 * 重复任务完成后的下一次实例生成（migration 033 的 complete_recurring_task RPC）。
 *
 * RPC 自身幂等且自检：非重复任务 / 未完成 / 同系列已生成过 → 返回 null，
 * 因此所有"标记完成"路径都可以无条件调用。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

/**
 * 触发重复任务的下一次实例生成。
 * @returns 新任务 id；非重复任务、已生成过或调用失败时返回 null（不抛错，
 *          因为"完成"本身已成功，生成失败不应让 UI 回滚完成状态）。
 */
export async function generateNextRecurringTask(
  supabase: AnySupabase,
  taskId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("complete_recurring_task", { p_task_id: taskId });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}
