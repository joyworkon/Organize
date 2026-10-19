import { isCollabRole, type CollabRole } from "@/lib/collab/roles";

export const RESOURCE_ROLE_LOAD_ERROR_MESSAGE = "你的权限未加载，暂按只读显示，请重试";

export interface ResolvedResourceRole {
  role: CollabRole;
  /** resource_role 未成功取到有效角色时为真：前端安全兜底 viewer，但 UI 必须标「权限未加载」而不是「仅查看」 */
  unverified: boolean;
}

/**
 * 详情页 resource_role RPC 结果收敛：
 * - 成功（无 error 且 data 是有效 CollabRole）→ 原样采用；
 * - 失败（error 真值，或 data 非法/为 null）→ 安全兜底 viewer + unverified。
 * 兜底保持只读是安全设计，但调用方必须透传 unverified 让 UI 诚实标注并可重试。
 */
export function resolveResourceRole({
  data,
  error,
}: {
  data: unknown;
  error: unknown;
}): ResolvedResourceRole {
  if (!error && isCollabRole(data)) {
    return { role: data, unverified: false };
  }
  return { role: "viewer", unverified: true };
}
