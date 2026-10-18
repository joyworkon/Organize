/**
 * 「添加到画布」对话框选中已有画布后，getCanvas 拉页面（boards）结果落到 UI 状态的纯逻辑。
 *
 * getCanvas 失败时调用方若直接 `setBoards([])` 会把加载失败伪装成「该画布没有页面」——
 * 用户看到空下拉、提交被禁，却分不清是真 0 页还是网络坏了。这里统一裁决：
 * - 成功：整体替换并清错（成功的空列表是诚实空态，不带错）；
 * - 失败：保留上次成功快照 + 错误文案，由 UI 给出重试。
 * 与 ./list-load.ts 的 nextCanvasItemsAfterLoad（#394）同构；不触网、不依赖组件类型。
 */

export const CANVAS_BOARDS_LOAD_ERROR_MESSAGE = "画布页面加载失败";

/** nextBoardsAfterLoad 的返回：UI 该落到什么页面列表、错误提示文案 */
export interface BoardsLoadPlan<T> {
  boards: T[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

export function nextBoardsAfterLoad<T>(
  input:
    | {
        /** 上次成功快照；失败时原样返回（同引用，React 跳过重渲染） */
        previous: T[];
        ok: true;
        /** getCanvas 成功后映射出的页面选项 */
        boards: T[];
      }
    | { previous: T[]; ok: false },
): BoardsLoadPlan<T> {
  if (!input.ok) {
    return { boards: input.previous, loadError: CANVAS_BOARDS_LOAD_ERROR_MESSAGE };
  }
  return { boards: input.boards, loadError: null };
}

/**
 * 加载落定后该选中哪个页面：当前选中项仍在列表里就保留（失败保留快照 / 重试成功都不丢用户的选择），
 * 否则落到第一页；空列表则 ""（由 canSubmit 禁提交）。
 */
export function nextBoardIdAfterLoad<T extends { id: string }>(
  boards: T[],
  currentBoardId: string,
): string {
  if (currentBoardId !== "" && boards.some((b) => b.id === currentBoardId)) {
    return currentBoardId;
  }
  return boards[0]?.id ?? "";
}
