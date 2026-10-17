import { describe, it, expect } from "vitest";
import type { HighlightReferenceState } from "@/lib/reading/highlight-references";
import {
  RELATED_LOAD_ERROR_MESSAGE,
  classifyReadingResult,
  mergeHighlightReferences,
  noteReadingReferenceId,
  type LinkedContentStateRow,
} from "./backlinks-related-load";
import { shouldHideBacklinksPanel } from "./backlinks-load";

interface TestReadingItem {
  id: string;
  title: string;
}

const NOTE_ID = "note-1";
const READING_ID = "reading-1";
const SYNTHETIC_ID = noteReadingReferenceId(NOTE_ID);

const readingItem: TestReadingItem = { id: READING_ID, title: "来源文章" };

function highlight(
  id: string,
  overrides: Partial<HighlightReferenceState> = {}
): HighlightReferenceState {
  return {
    highlight_id: id,
    reading_item_id: READING_ID,
    reading_title: "来源文章",
    reading_state: "active",
    note_id: NOTE_ID,
    note_title: "本笔记",
    note_state: "active",
    task_id: `task-${id}`,
    task_title: `任务 ${id}`,
    task_state: "active",
    ...overrides,
  };
}

const h1 = highlight("h1");
const h2 = highlight("h2");

const deletedReadingRow: LinkedContentStateRow = {
  reading_title: "来源文章",
  reading_state: "deleted",
  note_title: "本笔记",
  note_state: "active",
};

describe("classifyReadingResult", () => {
  it("没有 readingItemId：none（即便 data / error 有值也不看）", () => {
    expect(
      classifyReadingResult<TestReadingItem>({ readingItemId: null, data: readingItem, error: null })
    ).toEqual({ kind: "none" });
    expect(
      classifyReadingResult<TestReadingItem>({
        readingItemId: undefined,
        data: null,
        error: { code: "PGRST116" },
      })
    ).toEqual({ kind: "none" });
    expect(
      classifyReadingResult<TestReadingItem>({ readingItemId: "", data: null, error: null })
    ).toEqual({ kind: "none" });
  });

  it("查到行：ok 并带回原 item 引用", () => {
    const result = classifyReadingResult<TestReadingItem>({
      readingItemId: READING_ID,
      data: readingItem,
      error: null,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.item).toBe(readingItem);
  });

  it("PGRST116（PostgREST .single() 0 行）：missing——这才是真的「引用已失效」", () => {
    expect(
      classifyReadingResult<TestReadingItem>({
        readingItemId: READING_ID,
        data: null,
        error: { code: "PGRST116" },
      })
    ).toEqual({ kind: "missing" });
  });

  it("空数据且无错（mock client 的 .single() 0 行形态）：missing", () => {
    expect(
      classifyReadingResult<TestReadingItem>({ readingItemId: READING_ID, data: null, error: null })
    ).toEqual({ kind: "missing" });
    expect(
      classifyReadingResult<TestReadingItem>({
        readingItemId: READING_ID,
        data: undefined,
        error: undefined,
      })
    ).toEqual({ kind: "missing" });
  });

  it("其它错误（网络 / 5xx / RLS）：failed，不得与 missing 混为一谈", () => {
    expect(
      classifyReadingResult<TestReadingItem>({
        readingItemId: READING_ID,
        data: null,
        error: { code: "PGRST301" },
      })
    ).toEqual({ kind: "failed" });
    expect(
      classifyReadingResult<TestReadingItem>({
        readingItemId: READING_ID,
        data: null,
        error: { code: "42501" },
      })
    ).toEqual({ kind: "failed" });
    // 无 code 的错误对象（如 fetch 失败被包装）同样是 failed
    expect(
      classifyReadingResult<TestReadingItem>({ readingItemId: READING_ID, data: null, error: {} })
    ).toEqual({ kind: "failed" });
    expect(
      classifyReadingResult<TestReadingItem>({
        readingItemId: READING_ID,
        data: null,
        error: { code: null },
      })
    ).toEqual({ kind: "failed" });
  });

  it("有 error 时即便 data 有值也按 error 分类（error 是失败事实）", () => {
    expect(
      classifyReadingResult<TestReadingItem>({
        readingItemId: READING_ID,
        data: readingItem,
        error: { code: "PGRST301" },
      })
    ).toEqual({ kind: "failed" });
  });
});

describe("mergeHighlightReferences", () => {
  const base = {
    noteId: NOTE_ID,
    readingItemId: READING_ID,
  };

  it("referenceResult 成功：以 RPC 新数据整体替换 previous，failed=false", () => {
    const plan = mergeHighlightReferences({
      ...base,
      previous: [h1],
      referenceResult: { ok: true, data: [h2] },
      readingState: { ok: true, data: [deletedReadingRow] },
      readingLoaded: true,
    });
    expect(plan.failed).toBe(false);
    expect(plan.rows).toEqual([h2]);
  });

  it("成功 + 来源阅读未直查到 + readingState 有行：前插合成行且恰好一份", () => {
    const plan = mergeHighlightReferences({
      ...base,
      previous: [],
      referenceResult: { ok: true, data: [h1, h2] },
      readingState: { ok: true, data: [deletedReadingRow] },
      readingLoaded: false,
    });
    expect(plan.failed).toBe(false);
    expect(plan.rows.map((row) => row.highlight_id)).toEqual([SYNTHETIC_ID, "h1", "h2"]);
    expect(plan.rows[0]).toMatchObject({
      highlight_id: SYNTHETIC_ID,
      reading_item_id: READING_ID,
      reading_title: "来源文章",
      reading_state: "deleted",
      note_id: NOTE_ID,
      note_title: "本笔记",
      note_state: "active",
      task_id: null,
      task_title: null,
      task_state: null,
    });
  });

  it("成功但来源阅读已直查到：不合成 note-reading 行（原条件 !readingResult.data）", () => {
    const plan = mergeHighlightReferences({
      ...base,
      previous: [],
      referenceResult: { ok: true, data: [h1] },
      readingState: { ok: true, data: [deletedReadingRow] },
      readingLoaded: true,
    });
    expect(plan.rows).toEqual([h1]);
  });

  it("成功时 previous 里残留的旧合成行不会带入（成功=整体替换）", () => {
    const stale = highlight(SYNTHETIC_ID, { task_id: null, task_title: null, task_state: null });
    const plan = mergeHighlightReferences({
      ...base,
      previous: [stale, h1],
      referenceResult: { ok: true, data: [h2] },
      readingState: { ok: true, data: [deletedReadingRow] },
      readingLoaded: false,
    });
    expect(plan.rows.filter((row) => row.highlight_id === SYNTHETIC_ID)).toHaveLength(1);
    expect(plan.rows.map((row) => row.highlight_id)).toEqual([SYNTHETIC_ID, "h2"]);
  });

  it("referenceResult 失败：保留 previous 并标记 failed，不得清空冒充「没有关联任务」", () => {
    const plan = mergeHighlightReferences({
      ...base,
      previous: [h1, h2],
      referenceResult: { ok: false },
      readingState: { ok: true, data: [deletedReadingRow] },
      readingLoaded: false,
    });
    expect(plan.failed).toBe(true);
    expect(plan.rows.map((row) => row.highlight_id)).toEqual([SYNTHETIC_ID, "h1", "h2"]);
  });

  it("referenceResult 连续失败两次：note-reading 合成行不堆积，长度不变", () => {
    const first = mergeHighlightReferences({
      ...base,
      previous: [h1],
      referenceResult: { ok: false },
      readingState: { ok: true, data: [deletedReadingRow] },
      readingLoaded: false,
    });
    expect(first.rows).toHaveLength(2);
    const second = mergeHighlightReferences({
      ...base,
      previous: first.rows,
      referenceResult: { ok: false },
      readingState: { ok: true, data: [deletedReadingRow] },
      readingLoaded: false,
    });
    expect(second.failed).toBe(true);
    expect(second.rows).toHaveLength(2);
    expect(second.rows.filter((row) => row.highlight_id === SYNTHETIC_ID)).toHaveLength(1);
    expect(second.rows.map((row) => row.highlight_id)).toEqual([SYNTHETIC_ID, "h1"]);
    // 第三次也一样（旧代码在此会堆到 3 份）
    const third = mergeHighlightReferences({
      ...base,
      previous: second.rows,
      referenceResult: { ok: false },
      readingState: { ok: true, data: [deletedReadingRow] },
      readingLoaded: false,
    });
    expect(third.rows).toHaveLength(2);
  });

  it("从未成功过的首次失败：rows 为空但 failed=true，与「真的没有关联任务」区分", () => {
    const plan = mergeHighlightReferences({
      ...base,
      previous: [],
      referenceResult: { ok: false },
      readingState: { ok: false },
      readingLoaded: false,
    });
    expect(plan.failed).toBe(true);
    expect(plan.rows).toEqual([]);
  });

  it("readingState 自身失败：计入 failed；不合成 note-reading 行且剔除旧合成行", () => {
    const stale = highlight(SYNTHETIC_ID, { task_id: null, task_title: null, task_state: null });
    const plan = mergeHighlightReferences({
      ...base,
      previous: [stale, h1],
      referenceResult: { ok: true, data: [h1] },
      readingState: { ok: false },
      readingLoaded: false,
    });
    expect(plan.failed).toBe(true);
    expect(plan.rows).toEqual([h1]);
  });

  it("readingState 失败 + referenceResult 失败：以 previous（去掉旧合成行）为准，failed=true", () => {
    const stale = highlight(SYNTHETIC_ID, { task_id: null, task_title: null, task_state: null });
    const plan = mergeHighlightReferences({
      ...base,
      previous: [stale, h1, h2],
      referenceResult: { ok: false },
      readingState: { ok: false },
      readingLoaded: false,
    });
    expect(plan.failed).toBe(true);
    expect(plan.rows).toEqual([h1, h2]);
  });

  it("没有 readingItemId：即便 readingState 有行也不合成 note-reading 行", () => {
    const plan = mergeHighlightReferences({
      noteId: NOTE_ID,
      readingItemId: null,
      previous: [],
      referenceResult: { ok: true, data: [h1] },
      readingState: { ok: true, data: [deletedReadingRow] },
      readingLoaded: false,
    });
    expect(plan.failed).toBe(false);
    expect(plan.rows).toEqual([h1]);
  });

  it("readingState 成功但无行 / data 为 null：不合成，不算失败", () => {
    expect(
      mergeHighlightReferences({
        ...base,
        previous: [],
        referenceResult: { ok: true, data: [h1] },
        readingState: { ok: true, data: [] },
        readingLoaded: false,
      })
    ).toEqual({ rows: [h1], failed: false });
    expect(
      mergeHighlightReferences({
        ...base,
        previous: [],
        referenceResult: { ok: true, data: [h1] },
        readingState: { ok: true, data: null },
        readingLoaded: false,
      })
    ).toEqual({ rows: [h1], failed: false });
  });

  it("合成行 reading_state 为 null 时兜底为 missing（类型完备）", () => {
    const plan = mergeHighlightReferences({
      ...base,
      previous: [],
      referenceResult: { ok: true, data: [] },
      readingState: {
        ok: true,
        data: [{ ...deletedReadingRow, reading_state: null }],
      },
      readingLoaded: false,
    });
    expect(plan.rows[0]?.reading_state).toBe("missing");
  });

  it("合成行 id 与 noteId 绑定", () => {
    expect(noteReadingReferenceId("abc")).toBe("note-reading:abc");
  });
});

describe("shouldHideBacklinksPanel（relatedLoadError 可选字段）", () => {
  const allEmpty = {
    loading: false,
    loadError: null,
    hasReading: false,
    hasUnavailableReading: false,
    hasBacklinks: false,
    hasLinkedTasks: false,
  };

  it("relatedLoadError 非空时不得隐藏——即使其余全空，失败不得谎报为「没有关联内容」", () => {
    expect(
      shouldHideBacklinksPanel({ ...allEmpty, relatedLoadError: RELATED_LOAD_ERROR_MESSAGE })
    ).toBe(false);
  });

  it("未传 relatedLoadError：行为与原来一致（全空隐藏）", () => {
    expect(shouldHideBacklinksPanel(allEmpty)).toBe(true);
  });

  it("显式传 null / undefined：等同未传", () => {
    expect(shouldHideBacklinksPanel({ ...allEmpty, relatedLoadError: null })).toBe(true);
    expect(shouldHideBacklinksPanel({ ...allEmpty, relatedLoadError: undefined })).toBe(true);
  });

  it("relatedLoadError 与 loadError 互不影响：任一非空都不隐藏", () => {
    expect(
      shouldHideBacklinksPanel({ ...allEmpty, loadError: "x", relatedLoadError: null })
    ).toBe(false);
    expect(
      shouldHideBacklinksPanel({ ...allEmpty, loadError: null, relatedLoadError: "y" })
    ).toBe(false);
  });
});
