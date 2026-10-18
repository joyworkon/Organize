/**
 * 复盘详情页标签加载/保存的纯逻辑（供 lessons/[id] 接线并单测）。
 *
 * 详情页标签来自两个查询：全部标签（tags）与该复盘的标签关联（lesson_tags）。
 * 任一查询失败时 data 为 null / error 非空——页面若直接 `(tagLinks || [])` 过滤，
 * 会把加载失败伪装成「这条复盘没有标签」，且保存时会把库里已有标签全部删掉。
 * 这里统一裁决（与 lib/lessons/list-load.ts 的 nextLessonsAfterLoad（#388）同构）：
 * - 编辑态加载：任一失败 → tags 置空并给出错误文案（不伪装成空标签）；
 * - 新建态加载：没有 lesson_tags 可查，只裁决 tags 全量——失败保留上次成功快照
 *   （nextAllTagsAfterLoad），不伪装成「一个标签都没有」；
 * - 保存：加载失败期间 skip——不碰 lesson_tags，保留库里原有标签。
 */

import type { Tag } from "@organize/shared";

export const LESSON_TAGS_LOAD_ERROR_MESSAGE = "标签加载失败";

/** resolveLessonTagsAfterLoad / nextAllTagsAfterLoad 的返回：UI 该落的标签快照、错误提示文案 */
export interface LessonTagsLoadPlan {
  tags: Tag[];
  /** 非空表示标签处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

export function resolveLessonTagsAfterLoad({
  allTags,
  allTagsError,
  links,
  linksError,
}: {
  /** tags 全量查询结果（按 name 排序）；error 非空或 data 为 null 即失败事实 */
  allTags: Tag[] | null;
  allTagsError: { message?: string } | null;
  /** lesson_tags 关联查询结果；error 非空或 data 为 null 即失败事实 */
  links: { tag_id: string }[] | null;
  linksError: { message?: string } | null;
}): LessonTagsLoadPlan {
  if (allTagsError || allTags === null || linksError || links === null) {
    const message = allTagsError?.message?.trim() || linksError?.message?.trim();
    return { tags: [], loadError: message || LESSON_TAGS_LOAD_ERROR_MESSAGE };
  }
  const tagIds = new Set(links.map((l) => l.tag_id));
  return { tags: allTags.filter((t) => tagIds.has(t.id)), loadError: null };
}

/**
 * 新建态只查 tags 全量（没有 lesson_tags）：失败时保留下次成功前的旧快照
 * （首屏为空数组），不把 TagSelector 伪装成「一个标签都没有」。
 * 与 nextLinkOptionsAfterLoad（#405）的 resolveRoute 同构。
 */
export function nextAllTagsAfterLoad({
  previous,
  data,
  error,
}: {
  /** 上次成功加载的全量标签（页面传 ref 里的快照，首屏为空数组） */
  previous: Tag[];
  /** tags 全量查询结果；error 非空或 data 为 null 即失败事实 */
  data: Tag[] | null;
  error: { message?: string } | null;
}): LessonTagsLoadPlan {
  if (error || data === null) {
    const message = error?.message?.trim();
    return { tags: previous, loadError: message || LESSON_TAGS_LOAD_ERROR_MESSAGE };
  }
  return { tags: data, loadError: null };
}

export type LessonTagSavePlan =
  | { kind: "skip" }
  | { kind: "replace"; tagIds: string[] };

/**
 * 保存时怎么处理 lesson_tags：加载失败期间（tagsLoadError 非空）skip，
 * 不执行 delete/insert——否则会用残缺的 selectedTags 覆盖掉库里已有标签。
 */
export function planLessonTagSave({
  tagsLoadError,
  selectedTagIds,
}: {
  tagsLoadError: string | null;
  selectedTagIds: string[];
}): LessonTagSavePlan {
  if (tagsLoadError) return { kind: "skip" };
  return { kind: "replace", tagIds: selectedTagIds };
}
