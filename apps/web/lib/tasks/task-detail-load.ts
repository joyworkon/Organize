/**
 * 任务详情页次要数据（子任务清单/标签/附件/动态）加载结果落到 UI 状态的纯逻辑（供详情页接线并单测）：
 * - 5 个并行查询（task_checklists / task_tags / tags / task_attachments / task_activities）各自可能失败，
 *   失败的部分由页面保留上次成功数据并展示错误条 + 重试，成功的部分照常整体替换；
 * - task_tags 与 tags 任一失败都算「标签」失败（标签列表由两者 join 得出，缺一不可），且去重只报一次；
 * - 返回顺序固定为 子任务 → 标签 → 附件 → 动态，保证拼接文案稳定可测。
 * 与 lib/notes/linked-task-banner-load.ts（#363）同构：把加载失败伪装成「没有数据」等于撒谎。
 */

/** 详情页会展示失败提示的四个区块名（顺序即提示文案顺序） */
export type TaskSecondarySection = "子任务" | "标签" | "附件" | "动态";

/** supabase-js 查询结果的最小形状：只看 error 的真值，data 由调用方按成功分支自行取用 */
interface QueryLike {
  error: unknown;
}

export function failedTaskSecondarySections({
  checklists,
  tagLinks,
  tags,
  attachments,
  activities,
}: {
  checklists: QueryLike;
  tagLinks: QueryLike;
  tags: QueryLike;
  attachments: QueryLike;
  activities: QueryLike;
}): TaskSecondarySection[] {
  const sections: TaskSecondarySection[] = [];
  if (checklists.error) sections.push("子任务");
  if (tagLinks.error || tags.error) sections.push("标签");
  if (attachments.error) sections.push("附件");
  if (activities.error) sections.push("动态");
  return sections;
}

/**
 * 失败区块列表 → 错误条文案。列表为空（全部成功）返回 null，调用方据此不渲染错误条。
 */
export function taskSecondaryLoadErrorMessage(
  sections: readonly TaskSecondarySection[]
): string | null {
  if (sections.length === 0) return null;
  return `${sections.join("、")}加载失败，显示的内容可能不完整`;
}
