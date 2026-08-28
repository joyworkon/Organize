/**
 * 任务离线队列的回放 writer（由 supabase client 构造）。
 * 任务工作台与任务详情页共用，保证两条入口的回放语义一致：
 * - 软删除补丁路由到 mutate_trash RPC（直写 deleted_at 被 RLS 拒绝）；
 * - 「update 后 delete」合并补丁先落其余字段再软删，避免修改被静默丢弃；
 * - 重复任务离线期间被勾完成，回放后补生成下一次实例；
 * - 清单操作直写 task_checklists（与在线行为一致，行不存在时 0 行不报错）。
 */
import type { TaskQueueWriter } from "@/lib/offline/task-queue";
import { createClient } from "@/lib/supabase/client";
import { generateNextRecurringTask } from "./recurring";

type SupabaseClient = ReturnType<typeof createClient>;

export function createTaskQueueWriter(supabase: SupabaseClient): TaskQueueWriter {
  return {
    insertTask: async (task) => {
      const { error } = await supabase.from("tasks").insert(task);
      return { error };
    },
    updateTask: async (id, patch) => {
      // 「update 后 delete」合并成的补丁：先落其余字段再软删，直接软删会把
      // 这些修改静默丢弃（离线先改标题/日期、再删除同一任务的真实路径）
      if (patch.deleted_at !== undefined) {
        const { deleted_at: _deletedAt, ...rest } = patch;
        if (Object.keys(rest).length > 0) {
          const { error } = await supabase.from("tasks").update(rest).eq("id", id);
          if (error) return { error };
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
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) return { error };
      // 重复任务在离线期间被勾完成：回放后必须补生成下一次实例
      // （RPC 自检幂等，非重复任务返回 null），否则该重复链就此断链
      if (patch.status === "done") {
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
