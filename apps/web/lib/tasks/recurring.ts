/**
 * 重复任务完成后的下一次实例生成（migration 033 的 complete_recurring_task RPC）。
 *
 * RPC 自身幂等且自检：非重复任务 / 未完成 / 同系列已生成过 → 返回 null，
 * 因此所有"标记完成"路径都可以无条件调用。
 *
 * requestNextRecurringTask 区分三种结果：created（生成了新实例）/ none（本来
 * 就不需要生成：非重复任务或已生成过）/ error（RPC 报错或调用失败）。需要向
 * 用户如实反馈生成失败（data & network：不假装成功）的调用方用它；
 * generateNextRecurringTask 是兼容旧调用方的包装，仍把 none 与 error 一起
 * 折叠成 null，不抛错。
 */
import { createClient } from "@/lib/supabase/client";

type SupabaseClient = ReturnType<typeof createClient>;

export type NextRecurringTaskResult =
  | { status: "created"; id: string }
  | { status: "none" }
  | { status: "error"; message: string };

/**
 * 触发重复任务的下一次实例生成，并区分"无需生成"与"生成失败"。
 * @returns created：生成了新实例（含新任务 id）；none：非重复任务 / 已生成过；
 *          error：RPC 报错或调用抛异常（message 为错误信息，失败时"完成"
 *          本身已成功，调用方不应回滚完成状态，但要如实提示用户）。
 */
export async function requestNextRecurringTask(
  supabase: SupabaseClient,
  taskId: string
): Promise<NextRecurringTaskResult> {
  try {
    const { data, error } = await supabase.rpc("complete_recurring_task", { p_task_id: taskId });
    if (error) {
      return { status: "error", message: error.message || "生成下一次重复任务失败" };
    }
    const id = data as string | null;
    return id ? { status: "created", id } : { status: "none" };
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "生成下一次重复任务失败";
    return { status: "error", message };
  }
}

/**
 * 兼容旧调用方的包装：只关心"是否生成了新实例"。
 * @returns 新任务 id；非重复任务、已生成过或调用失败时返回 null（不抛错，
 *          因为"完成"本身已成功，生成失败不应让 UI 回滚完成状态）。
 */
export async function generateNextRecurringTask(
  supabase: SupabaseClient,
  taskId: string
): Promise<string | null> {
  const result = await requestNextRecurringTask(supabase, taskId);
  return result.status === "created" ? result.id : null;
}
