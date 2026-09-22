"use client";

/**
 * 构思画布编辑器 store（zustand 工厂，每文档一个实例）。
 *
 * 职责：持有文档/选区/焦点/视口/历史/保存状态；apply() 是唯一的变更入口
 * （变更前 push 历史，命令纯函数产出新文档）。副作用（保存、上传、草稿）
 * 一律不在这里——工作区组件订阅 doc/title/localSeq 变化后执行（规格 §6.2）。
 */

import { create } from "zustand";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBlock,
  CanvasDoc,
  CanvasFocus,
  emptyDoc,
  findBlockLocation,
  findRegion,
} from "@/lib/canvas/model";
import { CanvasHistory } from "@/lib/canvas/history";
import type { LastActiveTarget } from "@/lib/canvas/insert-target";

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export type CanvasSelection =
  | { kind: "block"; blockId: string }
  | { kind: "free"; itemId: string }
  | { kind: "board"; boardId: string }
  | { kind: "region"; boardId: string; regionId: string }
  | null;

/** 保存状态：saving/idle(已保存)/local(仅本机)/error/conflict；unknown=加载中。 */
export type CanvasSaveStatus = "unknown" | "saving" | "saved" | "local" | "error" | "conflict";

export interface CanvasEditorState {
  doc: CanvasDoc;
  title: string;
  revision: number;
  localSeq: number;
  history: CanvasHistory;
  viewport: CanvasViewport;
  selection: CanvasSelection;
  /** 结构命令给出的焦点目标（新块应聚焦编辑）。 */
  focus: CanvasFocus;
  editingBlockId: string | null;
  /** IME 组合计数：每次 composition 结束 +1，用于拆分撤销事务。 */
  compositionSeq: number;
  previewMode: boolean;
  readOnly: boolean;
  saveStatus: CanvasSaveStatus;
  conflictCurrentRevision: number | null;
  recoveredFromDraft: boolean;
  /** 场景重算签名（字体就绪等触发强制重测）。 */
  measureEpoch: number;
  /** 资产展示地址缓存（mock 本机图 / pending 预览的对象 URL）。 */
  assetUrls: Record<string, string>;
  /** 智能比例重算请求计数（图片插入/版面宽变/文本编辑结束触发）。 */
  smartRecomputeSeq: number;
  /**
   * 最近有效的插入落点（页面 + 区块）：无选中时添加入口的解析依据
   * （B2 统一插入规则 6）。由 select/apply/startEdit 自动维护，内存持久不落盘。
   */
  lastActiveTarget: LastActiveTarget | null;

  init: (payload: {
    doc: CanvasDoc;
    title: string;
    revision: number;
    readOnly?: boolean;
    recoveredFromDraft?: boolean;
  }) => void;
  apply: (
    label: string,
    command: (doc: CanvasDoc) => { doc: CanvasDoc; focus?: CanvasFocus },
    opts?: { coalesceKey?: string; skipHistory?: boolean },
  ) => void;
  /** 智能比例等布局性调整：改文档但不进历史（非内容事务）。 */
  applyLayoutOnly: (command: (doc: CanvasDoc) => { doc: CanvasDoc; focus?: CanvasFocus }) => void;
  undo: () => void;
  redo: () => void;
  setViewport: (viewport: Partial<CanvasViewport>) => void;
  select: (selection: CanvasSelection) => void;
  clearFocus: () => void;
  /** 进入编辑态：传版面模块 id 或自由容器 id（自由容器选区保持 {kind:"free"}）。 */
  startEdit: (id: string) => void;
  stopEdit: () => void;
  bumpComposition: () => void;
  setTitle: (title: string) => void;
  togglePreview: () => void;
  setSaveStatus: (status: CanvasSaveStatus, conflictCurrentRevision?: number) => void;
  markSaved: (revision: number) => void;
  bumpMeasureEpoch: () => void;
  setAssetUrl: (key: string, url: string) => void;
  requestSmartRecompute: () => void;
}

export function createCanvasStore(initial?: {
  doc?: CanvasDoc;
  title?: string;
  revision?: number;
  readOnly?: boolean;
}) {
  return create<CanvasEditorState>((set, get) => ({
    doc: initial?.doc ?? { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [], freeItems: [] },
    title: initial?.title ?? "",
    revision: initial?.revision ?? 1,
    localSeq: 0,
    history: new CanvasHistory(),
    viewport: { x: 40, y: 40, zoom: 1 },
    selection: null,
    focus: null,
    editingBlockId: null,
    compositionSeq: 0,
    previewMode: false,
    readOnly: initial?.readOnly ?? false,
    saveStatus: "unknown",
    conflictCurrentRevision: null,
    recoveredFromDraft: false,
    measureEpoch: 0,
    assetUrls: {},
    smartRecomputeSeq: 0,
    lastActiveTarget: null,

    init: ({ doc, title, revision, readOnly, recoveredFromDraft }) =>
      set({
        doc,
        title,
        revision,
        localSeq: 0,
        readOnly: readOnly ?? false,
        recoveredFromDraft: recoveredFromDraft ?? false,
        saveStatus: "saved",
        history: new CanvasHistory(),
      }),

    apply: (label, command, opts) => {
      const state = get();
      if (state.readOnly || state.previewMode) return;
      const preFocus: CanvasFocus = state.editingBlockId
        ? { kind: "block", boardId: "", regionId: "", sectionId: "", columnId: "", blockId: state.editingBlockId }
        : null;
      if (!opts?.skipHistory) {
        state.history.push(state.doc, label, {
          coalesceKey: opts?.coalesceKey,
          preFocus,
        });
      }
      const result = command(state.doc);
      const nextSelection =
        result.focus?.kind === "block"
          ? { kind: "block" as const, blockId: result.focus.blockId }
          : result.focus?.kind === "free"
            ? { kind: "free" as const, itemId: result.focus.itemId }
            : result.focus?.kind === "region"
              ? { kind: "region" as const, boardId: result.focus.boardId, regionId: result.focus.regionId }
              : result.focus?.kind === "board"
                ? { kind: "board" as const, boardId: result.focus.boardId }
                : state.selection;
      const activeTarget = activeTargetFromSelection(result.doc, nextSelection);
      set({
        doc: result.doc,
        focus: result.focus ?? null,
        localSeq: state.localSeq + 1,
        ...(activeTarget ? { lastActiveTarget: activeTarget } : {}),
        // 文本输入保留既有选区与编辑态
      });
      if (result.focus?.kind === "block") {
        set({ selection: { kind: "block", blockId: result.focus.blockId } });
        if (result.focus.edit) {
          set({ editingBlockId: result.focus.blockId });
        }
      } else if (result.focus?.kind === "free") {
        set({ selection: { kind: "free", itemId: result.focus.itemId }, editingBlockId: null });
      } else if (result.focus?.kind === "region") {
        set({
          selection: { kind: "region", boardId: result.focus.boardId, regionId: result.focus.regionId },
          editingBlockId: null,
        });
      } else if (result.focus?.kind === "board") {
        set({ selection: { kind: "board", boardId: result.focus.boardId }, editingBlockId: null });
      }
    },

    applyLayoutOnly: (command) => {
      const state = get();
      const result = command(state.doc);
      set({ doc: result.doc, localSeq: state.localSeq + 1 });
    },

    undo: () => {
      const state = get();
      if (state.readOnly || state.previewMode) return;
      const entry = state.history.undo(state.doc);
      if (!entry) return;
      set({
        doc: entry.doc,
        focus: entry.focus ?? null,
        localSeq: state.localSeq + 1,
        editingBlockId: entry.focus?.kind === "block" ? entry.focus.blockId : null,
      });
    },

    redo: () => {
      const state = get();
      if (state.readOnly || state.previewMode) return;
      const entry = state.history.redo(state.doc);
      if (!entry) return;
      set({
        doc: entry.doc,
        focus: entry.focus ?? null,
        localSeq: state.localSeq + 1,
        editingBlockId: entry.focus?.kind === "block" ? entry.focus.blockId : null,
      });
    },

    setViewport: (viewport) =>
      set((state) => ({ viewport: { ...state.viewport, ...viewport } })),

    select: (selection) =>
      set((state) => {
        const activeTarget = activeTargetFromSelection(state.doc, selection);
        return activeTarget ? { selection, lastActiveTarget: activeTarget } : { selection };
      }),

    clearFocus: () => set({ focus: null }),

    startEdit: (id) =>
      set((state) => {
        if (state.readOnly || state.previewMode) {
          return { editingBlockId: null };
        }
        // 自由容器与版面模块共用本入口：自由容器保持 {kind:"free"} 选区，
        // 属性栏才能解析到自由容器（findBlockLocation 只遍历 boards）。
        if (state.doc.freeItems.some((f) => f.id === id)) {
          return { editingBlockId: id, selection: { kind: "free", itemId: id } };
        }
        const activeTarget = activeTargetFromSelection(state.doc, { kind: "block", blockId: id });
        return {
          editingBlockId: id,
          selection: { kind: "block", blockId: id },
          ...(activeTarget ? { lastActiveTarget: activeTarget } : {}),
        };
      }),

    stopEdit: () => set({ editingBlockId: null, focus: null }),

    bumpComposition: () => set((state) => ({ compositionSeq: state.compositionSeq + 1 })),

    setTitle: (title) =>
      set((state) =>
        state.readOnly || state.previewMode
          ? state
          : { title, localSeq: state.localSeq + 1 },
      ),

    togglePreview: () =>
      set((state) => ({
        previewMode: !state.previewMode,
        editingBlockId: null,
        selection: null,
      })),

    setSaveStatus: (status, conflictCurrentRevision) =>
      set({ saveStatus: status, conflictCurrentRevision: conflictCurrentRevision ?? null }),

    markSaved: (revision) => set({ revision, saveStatus: "saved" }),

    bumpMeasureEpoch: () => set((state) => ({ measureEpoch: state.measureEpoch + 1 })),

    setAssetUrl: (key, url) =>
      set((state) => ({ assetUrls: { ...state.assetUrls, [key]: url } })),

    requestSmartRecompute: () =>
      set((state) => ({ smartRecomputeSeq: state.smartRecomputeSeq + 1 })),
  }));
}

export type CanvasStore = ReturnType<typeof createCanvasStore>;

/** 按块查找的便捷只读选择器。 */
export function selectBlock(doc: CanvasDoc, blockId: string): CanvasBlock | null {
  for (const board of doc.boards) {
    for (const region of board.regions) {
      for (const section of region.sections) {
        for (const column of section.columns) {
          const block = column.blocks.find((b) => b.id === blockId);
          if (block) return block;
        }
      }
    }
  }
  return null;
}

export function makeEmptyDoc(): CanvasDoc {
  return emptyDoc();
}

/** 从选区解析最近有效落点（页面+区块）；自由容器/空选区返回 null（保留旧值由调用方决定）。 */
export function activeTargetFromSelection(
  doc: CanvasDoc,
  selection: CanvasSelection,
): LastActiveTarget | null {
  if (!selection) return null;
  if (selection.kind === "board") {
    const board = doc.boards.find((b) => b.id === selection.boardId);
    const region = board?.regions[board.regions.length - 1];
    return board ? { boardId: board.id, regionId: region?.id ?? "" } : null;
  }
  if (selection.kind === "region") {
    const found = findRegion(doc, selection.regionId);
    return found && found.board.id === selection.boardId
      ? { boardId: selection.boardId, regionId: selection.regionId }
      : null;
  }
  if (selection.kind === "block") {
    const loc = findBlockLocation(doc, selection.blockId);
    return loc ? { boardId: loc.board.id, regionId: loc.region.id } : null;
  }
  return null; // free：不改变页面/区块记忆
}
