// 资源标签写操作（add/remove）的结果判定，集中在一处便于单测。
// 约定：任何失败（HTTP 非 2xx、响应缺 tag_id、JSON 解析失败、mock error）都返回 { ok: false }，
// 由调用方回滚乐观更新并提示，绝不假装成功。

export type AddTagMutationOutcome = { ok: true; tagId: string } | { ok: false };

export type RemoveTagMutationOutcome = { ok: true } | { ok: false };

/** 判定 POST /api/.../tags 的响应；json 解析失败也按失败处理（fetch 对 4xx/5xx 不抛异常） */
export async function readAddTagMutation(res: Response): Promise<AddTagMutationOutcome> {
  if (!res.ok) return { ok: false };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false };
  }
  const tagId = (data as { tag_id?: unknown } | null)?.tag_id;
  return typeof tagId === "string" && tagId ? { ok: true, tagId } : { ok: false };
}

/** mock 路径：mockResolveAndLink 返回 undefined 即失败 */
export function addTagMutationFromMock(tagId: string | undefined): AddTagMutationOutcome {
  return tagId ? { ok: true, tagId } : { ok: false };
}

/** 判定 DELETE /api/.../tags 的响应（只看 HTTP 状态） */
export function removeTagMutationFromResponse(res: Response): RemoveTagMutationOutcome {
  return res.ok ? { ok: true } : { ok: false };
}

/** mock 路径：supabase .delete() 的 error 非空即失败 */
export function removeTagMutationFromMock(error: unknown): RemoveTagMutationOutcome {
  return error ? { ok: false } : { ok: true };
}
