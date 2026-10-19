// 标签管理页重命名/删除（page.tsx handleEdit/handleDelete）的写结果判定，集中在一处便于单测。
// 约定：任何失败（Postgres error、0 行命中、抛异常）都返回 { ok: false } 并附失败 toast 文案，
// 由页面按 reason 决定对话框去留与是否刷新，绝不静默或假装成功。

export type TagUpdateFailure = {
  ok: false;
  reason: "duplicate" | "not-found" | "failed";
  toastTitle: string;
};

export type TagUpdateOutcome = { ok: true } | TagUpdateFailure;

export type TagDeleteFailure = {
  ok: false;
  reason: "not-found" | "failed";
  toastTitle: string;
};

export type TagDeleteOutcome = { ok: true } | TagDeleteFailure;

/** supabase .update()/.delete() 带 .select("id") 的结果最小形状 */
export interface TagManageMutationResult {
  error: { code?: string | null } | null;
  data: { id: string }[] | null;
}

/** 重命名/改色：error 优先（23505 重名单列），无 error 但 0 行说明已被删除或无权限 */
export function readUpdateTagResult(result: TagManageMutationResult): TagUpdateOutcome {
  const { error, data } = result;
  if (error) {
    return error.code === "23505"
      ? { ok: false, reason: "duplicate", toastTitle: "已有同名标签" }
      : { ok: false, reason: "failed", toastTitle: "保存标签失败，请重试" };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: "not-found", toastTitle: "标签不存在或无权限编辑" };
  }
  return { ok: true };
}

/** 删除：任何 error 按失败，0 行说明已被删除 */
export function readDeleteTagResult(result: TagManageMutationResult): TagDeleteOutcome {
  const { error, data } = result;
  if (error) {
    return { ok: false, reason: "failed", toastTitle: "删除标签失败，请重试" };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: "not-found", toastTitle: "标签不存在或已被删除" };
  }
  return { ok: true };
}

/** 重命名/改色抛异常（网络等）：与其它 error 同文案，对话框保持打开 */
export function updateTagExceptionOutcome(): TagUpdateFailure {
  return { ok: false, reason: "failed", toastTitle: "保存标签失败，请重试" };
}

/** 删除抛异常（网络等）：与其它 error 同文案 */
export function deleteTagExceptionOutcome(): TagDeleteFailure {
  return { ok: false, reason: "failed", toastTitle: "删除标签失败，请重试" };
}
