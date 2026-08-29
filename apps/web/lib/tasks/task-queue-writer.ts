/**
 * 任务离线队列的回放 writer（由 supabase client 构造）。
 * 任务工作台与任务详情页共用，保证两条入口的回放语义一致：
 * - 字段更新走 update_task_atomic 原子协议（P1-03）：与在线更新共用同一协议，
 *   携带 op 的 expected_sync_version 与 mutation id；conflict/not_found 转成带
 *   code 的错误 → 回放层归类为非网络失败 → dead-letter 人工处理；
 * - 软删除补丁路由到 mutate_trash RPC（直写 deleted_at 被 RLS 拒绝）；
 * - 「update 后 delete」合并补丁先落其余字段（原子 RPC）再软删，避免修改被静默丢弃；
 * - 重复任务离线期间被勾完成，回放后补生成下一次实例（applied 时才补，幂等命中不补）；
 * - 清单操作直写 task_checklists（与在线行为一致，行不存在时 0 行不报错）。
 */
import type { TaskQueueWriter } from "@/lib/offline/task-queue";
import { createClient } from "@/lib/supabase/client";
import { applyTaskUpdate, type AtomicUpdateResult } from "./atomic-update";
import { generateNextRecurringTask } from "./recurring";

type SupabaseClient = ReturnType<typeof createClient>;

/** 把原子协议结果翻译成回放层可分类的 error（null = 成功） */
export function atomicResultToError(result: AtomicUpdateResult): { error: unknown } {
  if (result.status === "applied" || result.status === "already_applied") {
    return { error: null };
  }
  if (result.status === "conflict") {
    return {
      error: {
        code: "TASK_SYNC_CONFLICT",
        message: `任务已在其他设备被修改（当前版本 ${result.currentSyncVersion ?? "未知"}），需要人工确认`,
      },
    };
  }
  if (result.status === "not_found") {
    return {
      error: { code: "TASK_NOT_FOUND", message: "任务不存在或已被删除，无法应用离线更改" },
    };
  }
  return { error: result.error };
}

export function createTaskQueueWriter(supabase: SupabaseClient): TaskQueueWriter {
  return {
    insertTask: async (task) => {
      const { error } = await supabase.from("tasks").insert(task);
      return { error };
    },
    updateTask: async (id, patch, meta) => {
      // 「update 后 delete」合并成的补丁：先落其余字段再软删，直接软删会把
      // 这些修改静默丢弃（离线先改标题/日期、再删除同一任务的真实路径）
      if (patch.deleted_at !== undefined) {
        const { deleted_at: _deletedAt, ...rest } = patch;
        if (Object.keys(rest).length > 0) {
          const result = atomicResultToError(
            await applyTaskUpdate(supabase, id, rest, meta.expectedSyncVersion, meta.mutationId)
          );
          if (result.error) return result;
        }
        // 软删除走 mutate_trash RPC：直写 deleted_at 被 RLS 拒绝；
        // RPC 幂等（目标已删/不存在时更新 0 行，不报错）
        const { error } = await supabase.rpc("mutate_trash", {
          p_action: "soft_delete",
          p_resource_type: "task",
          p_ids: [id],
        });
        return { error };
      }
      const result = await applyTaskUpdate(supabase, id, patch, meta.expectedSyncVersion, meta.mutationId);
      const { error } = atomicResultToError(result);
      if (error) return { error };
      // 重复任务在离线期间被勾完成：回放后必须补生成下一次实例
      // （RPC 自检幂等，非重复任务返回 null），否则该重复链就此断链；
      // 幂等命中（already_applied）说明此前已应用过，不重复补
      if (patch.status === "done" && result.status === "applied") {
        await generateNextRecurringTask(supabase, id);
      }
      return { error: null };
    },
    updateChecklist: async (id, patch) => {
      const { error } = await supabase.from("task_checklists").update(patch).eq("id", id);
      return { error };
    },
    deleteChecklist: async (id) => {
      const { error } = await supabase.from("task_checklists").delete().eq("id", id);
      return { error };
    },
  };
}
