/**
 * 反链列表加载结果落到 UI 状态的纯逻辑（供 Backlinks 面板接线并单测）：
 * - 成功：整体替换并清错；
 * - 失败且此前成功过：保留旧列表——把加载失败伪装成「本笔记没有反向链接」等于撒谎；
 * - 失败且从未成功过：只能落到空列表，failed 标记交给调用方展示错误条与重试。
 * 与 lib/notes/note-history-load.ts 的 nextVersionsAfterLoad（#360）同构。
 */

export type BacklinksLoadOutcome<T> = { ok: true; rows: T[] } | { ok: false };

/** nextBacklinksAfterLoad 的返回：UI 该落到什么列表、错误提示、是否沿用旧数据 */
export interface BacklinksLoadPlan<T> {
  rows: T[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
  failed: boolean;
  /** 失败但保留了旧数据（重设同引用是无害的，React 会跳过重渲染） */
  keptPrevious: boolean;
}

export const BACKLINKS_LOAD_ERROR_MESSAGE = "反向链接加载失败";

export interface BacklinksPanelVisibility {
  loading: boolean;
  loadError: string | null;
  /** 关联阅读 / 高亮任务两块的独立错误（backlinks-related-load.ts）；可选，缺省视为无错 */
  relatedLoadError?: string | null;
  hasReading: boolean;
  hasUnavailableReading: boolean;
  hasBacklinks: boolean;
  hasLinkedTasks: boolean;
}

export function nextBacklinksAfterLoad<T>(
  previous: T[] | null,
  outcome: BacklinksLoadOutcome<T>
): BacklinksLoadPlan<T> {
  if (outcome.ok) {
    return { rows: outcome.rows, loadError: null, failed: false, keptPrevious: false };
  }
  if (previous) {
    return {
      rows: previous,
      loadError: BACKLINKS_LOAD_ERROR_MESSAGE,
      failed: true,
      keptPrevious: true,
    };
  }
  return { rows: [], loadError: BACKLINKS_LOAD_ERROR_MESSAGE, failed: true, keptPrevious: false };
}

/**
 * 整个反链面板（含关联阅读 / 高亮任务区块）是否应当隐藏：
 * 仅在无错、非加载中、且四类内容皆空时才隐藏（保持「真没有内容就不占位」的现行为）。
 * 加载失败时必须保留面板展示错误条与重试，不得 return null 谎报「没有反链」；
 * 关联阅读 / 高亮任务自身的加载失败（relatedLoadError）同理。
 */
export function shouldHideBacklinksPanel(state: BacklinksPanelVisibility): boolean {
  return (
    !state.loading &&
    state.loadError === null &&
    (state.relatedLoadError ?? null) === null &&
    !state.hasReading &&
    !state.hasUnavailableReading &&
    !state.hasBacklinks &&
    !state.hasLinkedTasks
  );
}
