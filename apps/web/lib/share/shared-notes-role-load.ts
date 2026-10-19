import { isCollabRole, type CollabRole } from "@/lib/collab/roles";

export const SHARED_NOTES_ROLE_LOAD_ERROR_MESSAGE = "部分笔记的权限加载失败，请重试";
export const SHARED_NOTE_ROLE_UNVERIFIED_LABEL = "权限未加载";

export interface ResolvedSharedNoteRole {
  myRole: CollabRole;
  /** resource_role 未成功取到有效角色时为真：前端安全兜底 viewer，但 UI 必须标「权限未加载」而不是「仅查看」 */
  roleUnverified: boolean;
}

/**
 * 「与我共享」逐条 resource_role 结果收敛：
 * - 成功（无 error 且 data 是有效 CollabRole）→ 原样采用；
 * - 失败（error 真值，或 data 非法/为 null）→ 安全兜底 viewer + roleUnverified。
 * 兜底保持只读是安全设计，但调用方必须透传 roleUnverified 让 UI 诚实标注。
 */
export function resolveSharedNoteRole({
  data,
  error,
}: {
  data: unknown;
  error: unknown;
}): ResolvedSharedNoteRole {
  if (!error && isCollabRole(data)) {
    return { myRole: data, roleUnverified: false };
  }
  return { myRole: "viewer", roleUnverified: true };
}

/** 任一条目角色未验证 → 汇总提示；全部验证通过（或空列表）→ null */
export function sharedNotesRoleLoadError(
  items: { roleUnverified: boolean }[]
): string | null {
  return items.some((item) => item.roleUnverified)
    ? SHARED_NOTES_ROLE_LOAD_ERROR_MESSAGE
    : null;
}
