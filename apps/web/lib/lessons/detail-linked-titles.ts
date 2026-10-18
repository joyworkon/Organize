/**
 * 复盘详情页「已关联条目标题」补取的纯逻辑（供 lessons/[id] 接线并单测）。
 *
 * lesson 行带 task_id / reading_item_id / note_id 时，页面各发一次
 * `.select("id, title").eq("id", …).single()` 补标题；原页面只解构 data，
 * 失败即把 linked* 置 null，三路全失败时只读态「关联内容」整块消失，
 * 与「这篇复盘本来就没有关联」不可区分。这里统一裁决（与 detail-link-options.ts（#405）
 * 同构，但那边是下拉选项列表、这边是单行芯片，形状不同故分文件）：
 * - 无 id → 该路 null（诚实清空；不算失败，也不看 error）；
 * - 有 id + 成功（error 假且 data 非 null）→ 用 data；
 * - 有 id + 零行（PostgREST `.single()` 的 PGRST116，或无错但 data 为 null——mock client
 *   零行即此形态）→ 该路 null，不算 loadError：关联目标已删是真·无链接；
 * - 有 id + 其它失败 → 优先保留 previous（须 previous.id === id），否则给最小 stub
 *   （只含 id + title: null；reading 另带 url: ""），并计入失败——芯片仍可点进目标页；
 * - 任一路「其它失败」→ loadError 取首个非空 error.message（trim 后空则回退常量）；全无则 null。
 */

export const LESSON_LINKED_TITLES_LOAD_ERROR_MESSAGE = "关联内容加载失败";

/** PostgREST `.single()` 命中 0 行（或多行）时的错误码：关联目标已删，是真·无链接 */
const POSTGREST_SINGLE_NOT_FOUND = "PGRST116";

/** task / note 补取行的最小形状（页面 select 的就是 id, title） */
export interface LinkedTitleRow {
  id: string;
  title: string | null;
}

/** reading 补取行的最小形状：只读芯片用 `title || url` 兜底文案 */
export interface LinkedReadingRow extends LinkedTitleRow {
  url: string;
}

/** 单路 `.single()` 结果；无对应 id 时传 `{ data: null, error: null }` 即可，不计入失败 */
export interface LinkedTitleQueryResult<T> {
  data: T | null;
  error: { message?: string; code?: string } | null;
}

/** lesson 行上的三个外键；空串视为 null */
export interface LinkedTitleIds {
  taskId: string | null;
  readingId: string | null;
  noteId: string | null;
}

/** 上次完整成功的三路快照（页面用 ref 持有，切 lessonId 时清空） */
export interface LinkedTitlesSnapshot<T, R, N> {
  task: T | null;
  reading: R | null;
  note: N | null;
}

export interface LinkedTitlesLoadPlan<T, R, N> {
  linkedTask: T | null;
  linkedReading: R | null;
  linkedNote: N | null;
  /** 非空表示至少一路「其它失败」（对应芯片可能是旧快照或 stub）；null 表示无错 */
  loadError: string | null;
}

interface RouteOutcome<T> {
  value: T | null;
  failed: boolean;
  message?: string;
}

function normalizeId(id: string | null | undefined): string | null {
  return id ? id : null;
}

function resolveRoute<T extends LinkedTitleRow>(
  id: string | null,
  result: LinkedTitleQueryResult<T>,
  previous: T | null,
  makeStub: (id: string) => T
): RouteOutcome<T> {
  if (!id) return { value: null, failed: false };
  if (result.error) {
    if (result.error.code === POSTGREST_SINGLE_NOT_FOUND) {
      return { value: null, failed: false };
    }
    const value = previous && previous.id === id ? previous : makeStub(id);
    return { value, failed: true, message: result.error.message };
  }
  if (result.data === null || result.data === undefined) {
    return { value: null, failed: false };
  }
  return { value: result.data, failed: false };
}

export function nextLinkedTitlesAfterLoad<
  T extends LinkedTitleRow,
  R extends LinkedReadingRow,
  N extends LinkedTitleRow,
>({
  ids,
  previous,
  task,
  reading,
  note,
}: {
  ids: LinkedTitleIds;
  previous: LinkedTitlesSnapshot<T, R, N>;
  task: LinkedTitleQueryResult<T>;
  reading: LinkedTitleQueryResult<R>;
  note: LinkedTitleQueryResult<N>;
}): LinkedTitlesLoadPlan<T, R, N> {
  const taskRoute = resolveRoute(
    normalizeId(ids.taskId),
    task,
    previous.task,
    (id) => ({ id, title: null }) as T
  );
  const readingRoute = resolveRoute(
    normalizeId(ids.readingId),
    reading,
    previous.reading,
    (id) => ({ id, title: null, url: "" }) as R
  );
  const noteRoute = resolveRoute(
    normalizeId(ids.noteId),
    note,
    previous.note,
    (id) => ({ id, title: null }) as N
  );

  const failedMessages: Array<string | undefined> = [];
  if (taskRoute.failed) failedMessages.push(taskRoute.message);
  if (readingRoute.failed) failedMessages.push(readingRoute.message);
  if (noteRoute.failed) failedMessages.push(noteRoute.message);

  const firstNonBlank = failedMessages
    .map((message) => message?.trim())
    .find((message): message is string => Boolean(message));

  const loadError =
    failedMessages.length === 0
      ? null
      : firstNonBlank ?? LESSON_LINKED_TITLES_LOAD_ERROR_MESSAGE;

  return {
    linkedTask: taskRoute.value,
    linkedReading: readingRoute.value,
    linkedNote: noteRoute.value,
    loadError,
  };
}
