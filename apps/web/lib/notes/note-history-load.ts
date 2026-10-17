/**
 * 版本历史列表加载结果落到 UI 状态的纯逻辑（供 NoteHistoryPanel 接线并单测）：
 * - 成功：整体替换并清错；
 * - 失败且此前成功过：保留旧列表——把加载失败伪装成「还没有历史版本」等于撒谎；
 * - 失败且从未成功过：只能落到空列表，failed 标记交给调用方展示错误条与重试。
 * 与 lib/notes/groups.ts 的 nextGroupsStateAfterLoad（#356）同构。
 */

export type VersionsLoadOutcome<T> = { ok: true; versions: T[] } | { ok: false };

/** nextVersionsAfterLoad 的返回：UI 该落到什么列表、错误提示、是否沿用旧数据 */
export interface VersionsLoadPlan<T> {
  versions: T[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
  failed: boolean;
  /** 失败但保留了旧数据（重设同引用是无害的，React 会跳过重渲染） */
  keptPrevious: boolean;
}

export const HISTORY_LOAD_ERROR_MESSAGE = "版本历史加载失败";

export function nextVersionsAfterLoad<T>(
  previous: T[] | null,
  outcome: VersionsLoadOutcome<T>
): VersionsLoadPlan<T> {
  if (outcome.ok) {
    return { versions: outcome.versions, loadError: null, failed: false, keptPrevious: false };
  }
  if (previous) {
    return {
      versions: previous,
      loadError: HISTORY_LOAD_ERROR_MESSAGE,
      failed: true,
      keptPrevious: true,
    };
  }
  return { versions: [], loadError: HISTORY_LOAD_ERROR_MESSAGE, failed: true, keptPrevious: false };
}

/**
 * 「还没有历史版本」空态是否成立：仅在无错、非加载中且列表为空时。
 * 加载失败时（哪怕列表也是空的）必须显示失败而非「还没有历史版本」。
 */
export function shouldShowHistoryEmpty<T>(
  versions: T[],
  loadError: string | null,
  loading: boolean
): boolean {
  return !loading && loadError === null && versions.length === 0;
}
