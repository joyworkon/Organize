import type { Tag } from "@organize/shared";

export const RESOURCE_TAGS_LOAD_ERROR_HINT = "标签读取失败，显示可能不准确";

export type ResourceTagsLoadOutcome =
  | { ok: true; tags: Tag[] }
  | { ok: false; error: string };

export function nextResourceTagsAfterLoad(
  previous: Tag[],
  outcome: ResourceTagsLoadOutcome
): { tags: Tag[]; loadError: string | null } {
  if (outcome.ok) {
    return { tags: outcome.tags, loadError: null };
  }
  return { tags: previous, loadError: outcome.error };
}
