/**
 * 笔记页面评论的加载轮次与草稿纯逻辑（无 React 依赖，可直接单测）。
 *
 * 组件内所有异步结果（loadThreads / submit / toggleResolved / deleteThread）
 * 在写回 UI 前都要先过 `shouldApplyCommentResult`：只有「发起时的 noteId 仍是
 * 当前 noteId，且没有更新的加载轮次」才允许 setState，否则丢弃——慢请求不得
 * 把已离开笔记的数据写进当前视图。
 */

/** 一次评论加载的身份标识：发起时的 noteId 快照 + 组件内递增的轮次号 */
export interface CommentLoadToken {
  readonly noteId: string;
  readonly seq: number;
}

export function shouldApplyCommentResult(
  token: CommentLoadToken,
  currentNoteId: string,
  currentSeq: number,
): boolean {
  return token.noteId === currentNoteId && token.seq === currentSeq;
}

/** 页面评论草稿态：输入框内容 / 回复目标 / 错误文案，切笔记时整体回到初始值 */
export interface PageCommentsDraftState {
  text: string;
  replyTo: string | null;
  error: string;
}

export const INITIAL_PAGE_COMMENTS_DRAFT: PageCommentsDraftState = {
  text: "",
  replyTo: null,
  error: "",
};

/** 同一笔记重复调用保持原值；切换笔记返回初始草稿（不带草稿/回复目标/旧错误） */
export function nextDraftOnNoteSwitch(
  prevNoteId: string,
  nextNoteId: string,
  draft: PageCommentsDraftState,
): PageCommentsDraftState {
  return prevNoteId === nextNoteId ? draft : INITIAL_PAGE_COMMENTS_DRAFT;
}
