/**
 * 分享对话框协作者视图「授权空间列表」加载结果落到 UI 状态的纯逻辑（供 resource-share-dialog.tsx 的
 * CollaboratorGrants 接线并单测）：
 * - 成功：rows = data（保持查询顺序），无错误；
 * - 失败：保留上次成功 rows（previous，同引用）并给出错误文案——把 ACL 加载失败伪装成
 *   「这篇内容通过协作空间与你共享」的成功空态等于撒谎（真实失败与真·空不可区分）。
 * 与 #402/#403 的 load-honesty 纯函数同构但独立，不要合并：行形状与流水线约定不同。
 */

/** 协作者侧授权行（与组件内 rows 对齐：workspaces 查不到名字时 wsName 已回退「协作空间」） */
export interface CollaboratorGrantRow {
  wsName: string;
  role: string;
}

export const COLLABORATOR_GRANTS_LOAD_ERROR_MESSAGE = "协作授权加载失败";

/**
 * previous 为空数组时也照常返回（首次加载即失败：无旧快照可保留，只报错）。
 * 失败时 rows 与 previous 同引用，调用方 set 同引用 React 会 bail out，等效「不覆盖」。
 */
export function nextCollaboratorGrantsAfterLoad({
  previous,
  data,
  error,
}: {
  previous: CollaboratorGrantRow[];
  data: readonly CollaboratorGrantRow[] | null;
  /** supabase-js 的 error / 流水线任一 throw 即失败事实；只用真值判断，不吞成 null */
  error: unknown;
}): {
  rows: CollaboratorGrantRow[];
  loadError: string | null;
} {
  if (!error) {
    return { rows: data ? [...data] : [], loadError: null };
  }
  return {
    rows: previous,
    loadError: COLLABORATOR_GRANTS_LOAD_ERROR_MESSAGE,
  };
}
