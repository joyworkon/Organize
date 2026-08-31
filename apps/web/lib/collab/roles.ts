/**
 * 协作角色（P5-02 卡 4 前端）
 *
 * 与 063 的 public.resource_role('note', id) 返回值对齐：
 *   'owner'  笔记属主（本人拥有该业务行）
 *   'editor' 被授权可编辑的协作空间成员
 *   'viewer' 被授权只读的协作空间成员
 *   null     无任何授权（RLS 下根本读不到行，理论上是防御值）
 *
 * 权限事实源在数据库（唯一判定链 resource_role），前端只消费结论：
 * 这里不得出现任何「按 workspace_members/resource_acl 自行推导角色」的逻辑。
 */

export type CollabRole = "owner" | "editor" | "viewer";

export function isCollabRole(value: unknown): value is CollabRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

/** editor 与 owner 都可保存（分别走 v2 / v1 RPC）；viewer 只读 */
export function canEditRole(role: CollabRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

/** 角色展示名（分享面板 / /shared 列表 / 只读角标共用） */
export function collabRoleLabel(role: CollabRole): string {
  switch (role) {
    case "owner":
      return "所有者";
    case "editor":
      return "可编辑";
    case "viewer":
      return "仅查看";
  }
}

/**
 * workspace_members.role（063 成员管理面）：owner / member / guest。
 * 与资源侧 access_role（上面的 CollabRole）是两套正交角色：
 *   成员角色管「谁能管这个空间」，access_role 管「对被授权的资源能做什么」。
 */
export type WorkspaceMemberRole = "owner" | "member" | "guest";

export function isWorkspaceMemberRole(value: unknown): value is WorkspaceMemberRole {
  return value === "owner" || value === "member" || value === "guest";
}

/** 成员角色展示名（协作空间管理页共用） */
export function workspaceMemberRoleLabel(role: WorkspaceMemberRole): string {
  switch (role) {
    case "owner":
      return "所有者";
    case "member":
      return "成员";
    case "guest":
      return "访客";
  }
}

/**
 * flushSave 按角色选保存 RPC：属主走 v1（保持单用户主链不变），
 * editor 走 065 的 v2（同一 jsonb 状态契约，前端解析逻辑完全复用）。
 * mock 后端永远是 'owner'（mock 单用户世界真实成立），v2 在 mock 下不可达。
 */
export function saveRpcNameForRole(role: CollabRole): "save_note_with_tasks" | "save_note_with_tasks_v2" {
  return role === "owner" ? "save_note_with_tasks" : "save_note_with_tasks_v2";
}
