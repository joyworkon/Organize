/**
 * 复盘详情页保存写路径的纯逻辑（供 lessons/[id] 的 handleSave 接线并单测）。
 *
 * 背景（lesson-detail-save-honesty）：保存链路曾把失败伪装成成功——
 * - insert/update 返回 error 直接 throw，页面只有 try/finally，用户看不到任何提示；
 * - update 不带 .select("id")，RLS/已删除导致 0 行更新时 error 为 null，照样跳转；
 * - 未登录（登录过期）静默 return。
 * 这里统一裁决「写结果 → 是否成功/文案」，页面只按结果分支：失败一律 toast 且不跳转，
 * 成功路径行为不变。文案与 detail-tags.ts 的 LESSON_TAGS_LOAD_ERROR_MESSAGE 同口径。
 */

/** 正文保存失败（insert/update error、网络异常）的通用文案 */
export const LESSON_SAVE_ERROR_MESSAGE = "保存复盘失败，请重试";
/** 编辑分支 update 命中 0 行（RLS 拦截或复盘已删除）的文案 */
export const LESSON_SAVE_NOT_FOUND_MESSAGE = "复盘不存在或无权限编辑";
/** 未登录 / 登录过期的文案 */
export const LESSON_SAVE_UNAUTHORIZED_MESSAGE = "登录已过期，请重新登录";
/** 新建分支 lesson_tags 关联插入失败的文案（正文已保存，不阻断跳转；与编辑分支同口径） */
export const LESSON_TAG_LINK_SAVE_ERROR_MESSAGE = "标签保存失败";

export type LessonSaveUserPlan =
  | { kind: "ok"; userId: string }
  | { kind: "failed"; message: string };

/** 保存前置：未登录不给写，返回提示文案（不再静默 return） */
export function resolveLessonSaveUser(userId: string | null): LessonSaveUserPlan {
  if (!userId) {
    return { kind: "failed", message: LESSON_SAVE_UNAUTHORIZED_MESSAGE };
  }
  return { kind: "ok", userId };
}

export type LessonSaveResultPlan =
  | { kind: "saved"; id: string }
  | { kind: "failed"; message: string };

/**
 * 新建分支 lessons.insert(...).select("id").single() 的裁决：
 * error 非空或 data 为 null（无 id 可用）都是失败事实，不伪装成已保存。
 */
export function resolveLessonInsertResult({
  data,
  error,
}: {
  /** insert().select("id").single() 的返回行；失败或异常时为 null */
  data: { id: string } | null;
  error: { message?: string } | null;
}): LessonSaveResultPlan {
  if (error || data === null) {
    return { kind: "failed", message: LESSON_SAVE_ERROR_MESSAGE };
  }
  return { kind: "saved", id: data.id };
}

/**
 * 编辑分支 lessons.update(...).eq("id", lessonId).select("id") 的裁决：
 * error 非空 → 通用失败；data 为 null 或 0 行（RLS 拦截 / 复盘已删除，error 为 null）
 * → 不存在或无权限，不得继续跳转假装保存成功。
 */
export function resolveLessonUpdateResult({
  data,
  error,
  lessonId,
}: {
  /** update().select("id") 的返回行数组；0 行更新为空数组，异常时为 null */
  data: { id: string }[] | null;
  error: { message?: string } | null;
  /** 编辑目标复盘 id（成功时原样返回作为 savedId） */
  lessonId: string;
}): LessonSaveResultPlan {
  if (error) {
    return { kind: "failed", message: LESSON_SAVE_ERROR_MESSAGE };
  }
  if (data === null || data.length === 0) {
    return { kind: "failed", message: LESSON_SAVE_NOT_FOUND_MESSAGE };
  }
  return { kind: "saved", id: lessonId };
}

export type LessonTagLinkSavePlan =
  | { kind: "ok" }
  | { kind: "failed"; message: string };

/**
 * 新建分支 lesson_tags.insert(links) 的裁决：正文已保存成功，标签关联失败
 * 不阻断跳转，但必须给出 toast（与编辑分支 tagSaveFailed 同口径），不再静默吞掉。
 */
export function resolveLessonTagLinkResult({
  error,
}: {
  error: { message?: string } | null;
}): LessonTagLinkSavePlan {
  if (error) {
    return { kind: "failed", message: LESSON_TAG_LINK_SAVE_ERROR_MESSAGE };
  }
  return { kind: "ok" };
}
