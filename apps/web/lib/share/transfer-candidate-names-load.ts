/**
 * 分享对话框「移交属主」候选协作者名称组装的纯逻辑（供 resource-share-dialog.tsx 的
 * TransferOwnershipSection 接线并单测）：
 * - 成功：按 userIds 顺序组装候选，查不到名字的 name 为 null（真·缺名，UI 回退「协作者」），无错误；
 * - 失败（user_profiles 名称查询 error）：仍按顺序组装候选（成员列表本身已成功，不清空列表），
 *   能取到的名字照取、取不到的为 null + 错误文案——把名称查询失败静默成全部「协作者」等于撒谎。
 * 与 transfer-candidates-load.ts（ACL + members 主加载）同构但独立，不要合并：那是「保旧快照」，
 * 这是「成员已成功、仅名称降级」，形状与失败语义不同（对标 #407 collaborator-workspace-names-load）。
 */

import type { TransferCandidate } from "./transfer-candidates-load";

export const TRANSFER_CANDIDATE_NAMES_LOAD_ERROR_MESSAGE = "协作者名称加载失败";

/**
 * 失败时 candidates 照常组装（缺名 null），调用方仍 setCandidates 展示候选列表并更新成功快照；
 * error 只用真值判断，不吞成 null。
 */
export function nextTransferCandidateNamesAfterLoad({
  userIds,
  nameById,
  error,
}: {
  /** ACL + members 成功后去重、排除自己的候选 id（保持查询顺序） */
  userIds: readonly string[];
  /** user_profiles 查询成功行转成的 user_id → display_name 映射（失败时通常为空；display_name 本身可为 null） */
  nameById: Map<string, string | null> | Record<string, string | null>;
  /** supabase-js user_profiles 查询的 error 即失败事实 */
  error: unknown;
}): {
  candidates: TransferCandidate[];
  loadError: string | null;
} {
  const names = nameById instanceof Map ? nameById : new Map(Object.entries(nameById));
  return {
    candidates: userIds.map((uid) => ({ user_id: uid, name: names.get(uid) ?? null })),
    loadError: error ? TRANSFER_CANDIDATE_NAMES_LOAD_ERROR_MESSAGE : null,
  };
}
