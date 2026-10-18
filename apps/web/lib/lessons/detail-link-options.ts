/**
 * 复盘详情页「关联任务/阅读/笔记」选项列表加载的纯逻辑（供 lessons/[id] 接线并单测）。
 *
 * 三个下拉的选项来自 tasks / reading_items / notes 三个独立查询；页面若直接
 * `(data || [])` 落 state，任一查询失败都会把下拉伪装成「没有任何可选条目」。
 * 这里统一裁决（与 lib/lessons/detail-tags.ts（#404）同构）：
 * - 失败的那一路保留 previous 对应列表（页面传上次成功的快照），成功的那一路用 data 替换；
 * - 任一路失败 → loadError 非空（取首个非空 error.message，trim 后为空则回退常量）；
 * - 三路都成功才清错——成功返回的空数组是真空态，不是失败。
 */

export const LESSON_LINK_OPTIONS_LOAD_ERROR_MESSAGE = "关联选项加载失败";

/** 单路查询结果：error 非空或 data 为 null 即失败事实 */
export interface LinkOptionsQueryResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

/** nextLinkOptionsAfterLoad 的返回：三份列表快照 + 错误提示文案 */
export interface LinkOptionsLoadPlan<T, R, N> {
  tasks: T[];
  readingItems: R[];
  notes: N[];
  /** 非空表示关联选项处于加载失败状态（下拉可能不完整）；null 表示无错 */
  loadError: string | null;
}

function resolveRoute<T>(
  result: LinkOptionsQueryResult<T>,
  previousList: T[]
): { failed: boolean; list: T[] } {
  if (result.error || result.data === null) {
    return { failed: true, list: previousList };
  }
  return { failed: false, list: result.data };
}

export function nextLinkOptionsAfterLoad<T, R, N>({
  previous,
  tasks,
  readings,
  notes,
}: {
  previous: { tasks: T[]; readingItems: R[]; notes: N[] };
  tasks: LinkOptionsQueryResult<T>;
  readings: LinkOptionsQueryResult<R>;
  notes: LinkOptionsQueryResult<N>;
}): LinkOptionsLoadPlan<T, R, N> {
  const tasksRoute = resolveRoute(tasks, previous.tasks);
  const readingsRoute = resolveRoute(readings, previous.readingItems);
  const notesRoute = resolveRoute(notes, previous.notes);

  const failedMessages: Array<string | undefined> = [];
  if (tasksRoute.failed) failedMessages.push(tasks.error?.message);
  if (readingsRoute.failed) failedMessages.push(readings.error?.message);
  if (notesRoute.failed) failedMessages.push(notes.error?.message);

  const firstNonBlank = failedMessages
    .map((message) => message?.trim())
    .find((message): message is string => Boolean(message));

  const loadError =
    failedMessages.length === 0
      ? null
      : firstNonBlank ?? LESSON_LINK_OPTIONS_LOAD_ERROR_MESSAGE;

  return {
    tasks: tasksRoute.list,
    readingItems: readingsRoute.list,
    notes: notesRoute.list,
    loadError,
  };
}
