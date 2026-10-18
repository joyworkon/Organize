/**
 * 分享对话框「移交属主」候选协作者加载结果落到 UI 状态的纯逻辑（供 resource-share-dialog.tsx 接线并单测）：
 * - 成功：候选 = data（保持查询顺序：editor 空间成员去重、排除自己），无错误；
 * - 失败：保留上次成功候选（previous，同引用）并给出错误文案——把加载失败伪装成
 *   「还没有可移交的协作者」等于撒谎（#402 PROGRESS 留下的 follow-up）。
 * 与 #381/#402 的 load-honesty 纯函数同构但独立，不要合并：行形状与流水线约定不同。
 */

/** 移交候选（与组件内 CandidateUser 对齐：user_profiles 查不到名字时 name 为 null） */
export interface TransferCandidate {
  user_id: string;
  name: string | null;
}

export const TRANSFER_CANDIDATES_LOAD_ERROR_MESSAGE = "可移交协作者加载失败";

/**
 * previous 为空数组时也照常返回（首次加载即失败：无旧候选可保留，只报错）。
 * 失败时 candidates 与 previous 同引用，调用方 set 同引用 React 会 bail out，等效「不覆盖」。
 */
export function nextTransferCandidatesAfterLoad({
  previous,
  data,
  error,
}: {
  previous: TransferCandidate[];
  data: readonly TransferCandidate[] | null;
  /** supabase-js 的 error / 流水线任一 throw 即失败事实；只用真值判断，不吞成 null */
  error: unknown;
}): {
  candidates: TransferCandidate[];
  loadError: string | null;
} {
  if (!error) {
    return { candidates: data ? [...data] : [], loadError: null };
  }
  return {
    candidates: previous,
    loadError: TRANSFER_CANDIDATES_LOAD_ERROR_MESSAGE,
  };
}
