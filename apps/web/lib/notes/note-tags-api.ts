/**
 * 笔记标签 API（/api/notes/[id]/tags）POST 请求体解析（纯函数，供 route 使用）。
 *
 * 诚实性约定（notes-tags-api-honesty）：
 * - 非法 JSON / 顶层非对象 → 400「请求格式错误」（复用 api-mutation 的 parseJsonBody），不发任何数据库写；
 * - 缺 tag_id 且 name 为空 → 400「需要提供 tag_id 或 name」，不发 upsert；
 * - 抽取语义与原 route 内联实现完全一致：tag_id 真值优先；name 经 toString().trim()，空串视为未提供。
 */

import { parseJsonBody, type MutationRejection } from "./api-mutation";

export interface NoteTagRef {
  tagId?: string;
  tagName?: string;
}

export type NoteTagPostParse =
  | { ok: true; ref: NoteTagRef }
  | { ok: false; rejection: MutationRejection };

const MISSING_TAG_REF: MutationRejection = {
  status: 400,
  error: "需要提供 tag_id 或 name",
};

/** 从已解析的 body 抽出 tag 引用；两者皆缺 → 400。 */
export function resolveNoteTagRef(body: Record<string, unknown>): NoteTagPostParse {
  const tagId = (body.tag_id as string | undefined) || undefined;
  const rawName = body.name;
  const trimmed =
    rawName === undefined || rawName === null ? undefined : String(rawName).trim();
  const tagName = trimmed || undefined;

  if (!tagId && !tagName) {
    return { ok: false, rejection: MISSING_TAG_REF };
  }
  return { ok: true, ref: { tagId, tagName } };
}

/** 解析 POST JSON 请求体并抽出 tag 引用；非法 JSON / 非对象 → 400。 */
export async function parseNoteTagPostBody(request: Request): Promise<NoteTagPostParse> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed;
  return resolveNoteTagRef(parsed.body);
}
