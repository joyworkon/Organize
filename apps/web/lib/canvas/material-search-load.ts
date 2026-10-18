/**
 * 画布左侧「资料」面板搜索结果落到 UI 状态的纯逻辑。
 *
 * 搜索失败时调用方若直接吞掉（或保留 state 不动 + 渲染按 items.length 判断）会把
 * 加载失败伪装成「没有匹配的资料」，或把上一个关键词的旧结果冒充新关键词的匹配——
 * 用户分不清是资料库真没有、还是网络坏了。这里统一裁决：
 * - 成功：整体替换并清错（成功的空结果是诚实空态，不带错）；
 * - 失败：保留上次成功快照 + 错误文案，由 UI 给出行内提示 + 重试。
 * 与 ./boards-load.ts 的 nextBoardsAfterLoad（#395）同构；不触网、不依赖组件类型。
 */

export const CANVAS_MATERIAL_SEARCH_ERROR_MESSAGE = "资料搜索失败";

/** nextMaterialItemsAfterLoad 的返回：UI 该落到什么搜索结果、错误提示文案 */
export interface MaterialSearchLoadPlan<T> {
  items: T[];
  /** 非空表示当前搜索处于失败状态（items 为上次成功快照）；null 表示无错 */
  loadError: string | null;
}

export function nextMaterialItemsAfterLoad<T>(
  input:
    | {
        /** 上次成功快照；失败时原样返回（同引用，React 跳过重渲染） */
        previous: T[];
        ok: true;
        /** 本次搜索成功返回的结果 */
        items: T[];
      }
    | { previous: T[]; ok: false },
): MaterialSearchLoadPlan<T> {
  if (!input.ok) {
    return { items: input.previous, loadError: CANVAS_MATERIAL_SEARCH_ERROR_MESSAGE };
  }
  return { items: input.items, loadError: null };
}
