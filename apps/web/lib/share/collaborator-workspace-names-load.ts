/**
 * 分享对话框协作者视图「授权空间名称」组装的纯逻辑（供 resource-share-dialog.tsx 的
 * CollaboratorGrants 接线并单测）：
 * - 成功：按 grant 顺序组装 rows，查不到名字的行保留「协作空间」真·缺名回退，无错误；
 * - 失败（workspaces 名称查询 error）：仍组装 rows（授权行本身已成功，不清空列表），
 *   缺名回退「协作空间」+ 错误文案——把名称查询失败静默成全部「协作空间」等于撒谎。
 * 与 collaborator-grants-load.ts（ACL 主加载）同构但独立，不要合并：那是「保旧快照」，
 * 这是「授权已成功、仅名称降级」，形状与失败语义不同。
 */

import type { CollaboratorGrantRow } from "./collaborator-grants-load";

export const COLLABORATOR_WORKSPACE_NAMES_LOAD_ERROR_MESSAGE = "协作空间名称加载失败";

/** resource_acl select("workspace_id, access_role") 的行形状 */
export interface CollaboratorGrantAclRow {
  workspace_id: string;
  access_role: string;
}

/**
 * 失败时 rows 照常组装（每行缺名回退「协作空间」），调用方仍 setRows 展示授权列表；
 * error 只用真值判断，不吞成 null。
 */
export function nextCollaboratorWorkspaceNamesAfterLoad({
  grantRows,
  nameById,
  error,
}: {
  grantRows: readonly CollaboratorGrantAclRow[];
  /** workspaces 查询成功行转成的 id → name 映射（失败时通常为空 Map） */
  nameById: Map<string, string> | Record<string, string>;
  /** supabase-js workspaces 查询的 error 即失败事实 */
  error: unknown;
}): {
  rows: CollaboratorGrantRow[];
  loadError: string | null;
} {
  const names = nameById instanceof Map ? nameById : new Map(Object.entries(nameById));
  return {
    rows: grantRows.map((row) => ({
      wsName: names.get(row.workspace_id) || "协作空间",
      role: row.access_role,
    })),
    loadError: error ? COLLABORATOR_WORKSPACE_NAMES_LOAD_ERROR_MESSAGE : null,
  };
}
