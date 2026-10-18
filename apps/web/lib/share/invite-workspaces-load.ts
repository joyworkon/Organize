/**
 * 分享对话框「邀请协作者」工作区下拉加载结果落到 UI 状态的纯逻辑（供 resource-share-dialog.tsx 接线并单测）：
 * - 成功：只留 team 空间（邀请目标只能是 team；个人空间天然只有自己一人），保持查询顺序，
 *   建议选择首个 team 空间，没有则 "__new__"；
 * - 失败：保留上次成功列表（previous，同引用）并把 preferredChoice 置 null（调用方据此
 *   不改用户当前选择）——把加载失败伪装成「没有已有协作空间」等于撒谎。
 * 与 #381/#401 的 load-honesty 纯函数同构但独立，不要合并：行形状与过滤约定不同。
 */

/** workspaces 表 select("id, name, kind") 的行形状（与组件内 WorkspaceRow 对齐） */
export interface InviteWorkspaceRow {
  id: string;
  name: string;
  kind: string;
}

export const INVITE_WORKSPACES_LOAD_ERROR_MESSAGE = "协作空间加载失败";

/**
 * previous 为空数组时也照常返回（首次加载即失败：无旧列表可保留，只报错）。
 * 失败时 workspaces 与 previous 同引用，调用方 set 同引用 React 会 bail out，等效「不覆盖」。
 */
export function nextInviteWorkspacesAfterLoad({
  previous,
  data,
  error,
}: {
  previous: InviteWorkspaceRow[];
  data: readonly InviteWorkspaceRow[] | null;
  /** supabase-js 的 error 即失败事实；只用真值判断，不吞成 null */
  error: unknown;
}): {
  workspaces: InviteWorkspaceRow[];
  loadError: string | null;
  /** 成功时的建议选择；失败时为 null = 保持现状，调用方不要 set */
  preferredChoice: string | null;
} {
  if (!error) {
    const teamOnly = (data ?? []).filter((ws) => ws.kind === "team");
    return {
      workspaces: teamOnly,
      loadError: null,
      preferredChoice: teamOnly.length > 0 ? teamOnly[0].id : "__new__",
    };
  }
  return {
    workspaces: previous,
    loadError: INVITE_WORKSPACES_LOAD_ERROR_MESSAGE,
    preferredChoice: null,
  };
}
