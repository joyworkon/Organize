/**
 * 笔记详情页「关联任务」横幅加载结果落到 UI 状态的纯逻辑（供 LinkedTaskBanner 接线并单测）：
 * - 成功：整体替换并清错，total 取 count（真实总数，横幅只取前 3 条，「等 N 个」必须报真实值），
 *   count 为 null 时退回 data.length（与旧计数行为一致）；
 * - 失败：保留上次成功数据，把失败事实交给 loadError 展示错误条与重试——
 *   把加载失败伪装成「这篇笔记没有关联任务」等于撒谎；
 * - 真·0 条（查询成功且为空）由 shouldHideLinkedTaskBanner 判定不渲染，保持原行为。
 * 与 lib/notes/backlinks-load.ts（#361）同构。
 */

export interface LinkedTaskRow {
  id: string;
  title: string;
  status: string;
}

/** 横幅持有的两份计数态：展示列表（前 3 条）与真实总数（count） */
export interface LinkedTasksState {
  tasks: LinkedTaskRow[];
  total: number;
}

/** nextLinkedTasksAfterLoad 的返回：UI 该落到什么列表、错误提示是否出现 */
export interface LinkedTasksLoadPlan extends LinkedTasksState {
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
}

export const LINKED_TASKS_LOAD_ERROR_MESSAGE = "关联任务加载失败";

export function nextLinkedTasksAfterLoad({
  previous,
  data,
  error,
  count,
}: {
  previous: LinkedTasksState;
  data: readonly LinkedTaskRow[] | null;
  /** supabase-js 的 error 即失败事实；只用真值判断，不吞成 null */
  error: unknown;
  count: number | null;
}): LinkedTasksLoadPlan {
  if (!error) {
    const tasks = (data ?? []) as LinkedTaskRow[];
    return { tasks, total: count ?? tasks.length, loadError: null };
  }
  return {
    tasks: previous.tasks,
    total: previous.total,
    loadError: LINKED_TASKS_LOAD_ERROR_MESSAGE,
  };
}

/**
 * 横幅是否应当隐藏：仅在无错且列表为空（真·没有关联任务）时隐藏。
 * 加载失败时即使列表为空也必须保留横幅展示错误提示与重试，不得 return null 谎报。
 */
export function shouldHideLinkedTaskBanner({
  tasks,
  loadError,
}: {
  tasks: readonly LinkedTaskRow[];
  loadError: string | null;
}): boolean {
  return tasks.length === 0 && loadError === null;
}

/**
 * 「等 N 个」溢出文案：真实总数超过已展示条数时如实报总数（N 是 count，不是被 limit 截断的长度），
 * 否则不显示（null）。
 */
export function linkedTasksOverflowLabel(total: number, shown: number): string | null {
  return total > shown ? `等 ${total} 个` : null;
}
