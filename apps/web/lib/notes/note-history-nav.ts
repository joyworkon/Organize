/**
 * 版本历史侧栏的键盘移动、Esc 两段式退出、深链参数，以及预览请求序号。
 * 列表顺序与面板展示一致：从新到旧。Home = 最新（下标 0），End = 最早。
 */

export type HistoryEscapeAction = "exit-preview" | "close";

export interface HistoryListMove {
  index: number;
  /** 下标变了，或 Enter/Space：要立刻预览。停在边界的方向键不再重复请求。 */
  preview: boolean;
}

const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "]);

export function historyListMove(key: string, currentIndex: number, length: number): HistoryListMove | null {
  if (length <= 0 || !MOVE_KEYS.has(key)) return null;
  let index = currentIndex;
  if (key === "Home") index = 0;
  else if (key === "End") index = length - 1;
  else if (key === "ArrowDown") index = currentIndex < 0 ? 0 : Math.min(length - 1, currentIndex + 1);
  else if (key === "ArrowUp") index = currentIndex < 0 ? length - 1 : Math.max(0, currentIndex - 1);
  else index = currentIndex < 0 ? 0 : currentIndex;
  const preview = key === "Enter" || key === " " || index !== currentIndex;
  return { index, preview };
}

/** 预览中先退出预览；没有预览时关闭侧栏 */
export function historyEscapeAction(previewing: boolean): HistoryEscapeAction {
  return previewing ? "exit-preview" : "close";
}

/** 只采纳最后一次预览请求。旧请求序号不等于当前序号时丢弃。 */
export function isCurrentPreviewRequest(requestId: number, latestId: number): boolean {
  return requestId === latestId;
}

/** 列表卡片「历史」进入笔记页并展开侧栏 */
export function noteHistoryHref(noteId: string): string {
  return `/notes/${noteId}?panel=history`;
}

/**
 * `?panel=history` 用过即弃。不是这个参数时返回 null（调用方不要改 URL）。
 * 其它查询参数保留。
 */
export function nextUrlWithoutHistoryPanel(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("panel") !== "history") return null;
  params.delete("panel");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
