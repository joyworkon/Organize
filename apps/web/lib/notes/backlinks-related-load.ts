/**
 * 反链面板「关联阅读 / 高亮关联任务」两块加载结果落到 UI 状态的纯逻辑（供 Backlinks 面板接线并单测）：
 * - 关联阅读：区分「没有来源阅读」「加载成功」「真的查无此行（PGRST116 / 空数据无错）」「加载失败」，
 *   失败不得冒充「引用已失效」，missing 才走原有失效文案；
 * - 高亮关联任务：成功整体替换；失败保留旧数据但先剔除旧的合成行再按原条件重新前插，
 *   保证 `note-reading:${noteId}` 合成项同 id 只有一份，不随重试堆积。
 * 与 backlinks-load.ts（#361，反链列表主路径）并列；反链列表自身的行为不在本文件范围。
 */

import type { HighlightReferenceState, ReferenceState } from "@/lib/reading/highlight-references";

export const RELATED_LOAD_ERROR_MESSAGE = "关联阅读 / 高亮任务加载失败";

/** PostgREST `.single()` 在 0 行（或多行）时的错误码：这才是真的「引用不可用/已失效」 */
const POSTGREST_SINGLE_NOT_FOUND = "PGRST116";

/** RPC / 查询结果包装：失败不吞成 null（supabase-js 的 error 即失败事实） */
export type RelatedLoadOutcome<T> = { ok: true; data: T } | { ok: false };

export type ReadingClassification<T> =
  | { kind: "none" }
  | { kind: "ok"; item: T }
  | { kind: "missing" }
  | { kind: "failed" };

export interface ClassifyReadingResultInput<T> {
  readingItemId: string | null | undefined;
  data: T | null | undefined;
  error: { code?: string | null } | null | undefined;
}

/**
 * reading_items 单行查询结果的四分类：
 * - none：本笔记没有来源阅读（readingItemId 为空），面板不展示关联阅读块；
 * - ok：查到行；
 * - missing：PGRST116，或空数据且无错（mock client 的 .single() 0 行即此形态）——走「已失效 / 已移入垃圾箱」；
 * - failed：其余错误（网络 / 5xx / RLS）——保留上次成功数据并展示错误条，不得冒充「已失效」。
 */
export function classifyReadingResult<T>({
  readingItemId,
  data,
  error,
}: ClassifyReadingResultInput<T>): ReadingClassification<T> {
  if (!readingItemId) return { kind: "none" };
  if (error) {
    return error.code === POSTGREST_SINGLE_NOT_FOUND ? { kind: "missing" } : { kind: "failed" };
  }
  if (data === null || data === undefined) return { kind: "missing" };
  return { kind: "ok", item: data };
}

/** `get_linked_content_states` 单行结果中本面板用到的字段（042 RPC 返回形状的子集） */
export interface LinkedContentStateRow {
  reading_title: string | null;
  reading_state: ReferenceState | null;
  note_title: string | null;
  note_state: ReferenceState | null;
}

export interface MergeHighlightReferencesInput {
  /** 上一轮落到 UI 的列表（加载失败时保留它，不静默清空） */
  previous: HighlightReferenceState[];
  referenceResult: RelatedLoadOutcome<HighlightReferenceState[]>;
  readingState: RelatedLoadOutcome<LinkedContentStateRow[] | null>;
  noteId: string;
  readingItemId: string | null | undefined;
  /** 关联阅读是否已成功载入：成功时无需合成 note-reading 行（对应原条件 `!readingResult.data`） */
  readingLoaded: boolean;
}

export interface MergeHighlightReferencesPlan {
  rows: HighlightReferenceState[];
  /** referenceResult 或 readingState 任一失败即为真；reading_items 查询失败由 classifyReadingResult 表达 */
  failed: boolean;
}

/** 合成行的 highlight_id：reading_items 直查失败/missing 时用 reading_state 描述「垃圾箱 / 已失效」 */
export function noteReadingReferenceId(noteId: string): string {
  return `note-reading:${noteId}`;
}

/**
 * 高亮关联任务列表的落库计划：
 * - referenceResult 成功：以 RPC 新数据为基础（整体替换语义）；
 * - 失败：以 previous 为基础（保留旧数据），两种情况都先剔除旧的 `note-reading:${noteId}` 合成行；
 * - 再按原条件（有来源阅读且其未直查成功、readingState RPC 有行）前插合成行，同 id 只保留一份。
 */
export function mergeHighlightReferences({
  previous,
  referenceResult,
  readingState,
  noteId,
  readingItemId,
  readingLoaded,
}: MergeHighlightReferencesInput): MergeHighlightReferencesPlan {
  const syntheticId = noteReadingReferenceId(noteId);
  const base = (referenceResult.ok ? referenceResult.data : previous).filter(
    (reference) => reference.highlight_id !== syntheticId
  );
  const stateRow = readingState.ok ? readingState.data?.[0] ?? null : null;
  const rows =
    readingItemId && !readingLoaded && stateRow
      ? [
          {
            highlight_id: syntheticId,
            reading_item_id: readingItemId,
            reading_title: stateRow.reading_title,
            // readingItemId 非空时 042 RPC 的 reading_state 必非空；兜底仅为类型完备
            reading_state: stateRow.reading_state ?? "missing",
            note_id: noteId,
            note_title: stateRow.note_title,
            note_state: stateRow.note_state,
            task_id: null,
            task_title: null,
            task_state: null,
          },
          ...base,
        ]
      : base;
  return { rows, failed: !referenceResult.ok || !readingState.ok };
}
