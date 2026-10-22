"use client";

/**
 * 构思画布工作区（docs/idea-canvas-plan.md §5）。
 *
 * 装配：数据加载与草稿恢复 → 自动保存（串行 CAS）→ 视口/工具条/属性栏/
 * 缩放控件 → 键盘快捷键 → 智能比例触发点。所有副作用（保存、草稿、上传）
 * 都在订阅与事件处理器中，不进入 setState 更新器。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { Keyboard } from "lucide-react";
import { findCanvasContent } from "@/lib/canvas/board-find";
import { CanvasFindBar } from "./canvas-find-bar";
import { useRouter, useSearchParams } from "next/navigation";
import { selectionForFocus, withoutCanvasFocus } from "@/lib/canvas/focus-link";
import { MATERIAL_ADD_ERROR, MATERIAL_ADD_SUCCESS } from "@/lib/canvas/material-feedback";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Loader2,
  Maximize2,
  Minus,
  MousePointerClick,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  Search,
  Undo2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { hasOpenDialog, isTypingTarget } from "@/lib/hooks/use-hotkey";
import { previewPageStep, resolvePreviewBoardId, stepPreviewBoardId } from "@/lib/canvas/preview-nav";
import { createClient } from "@/lib/supabase/client";
import {
  CANVAS_SCHEMA_VERSION,
  createButtonBlock,
  createDividerBlock,
  createImageBlock,
  createMaterialCardBlock,
  createTextBlock,
  ensureCanvasDocV2,
  findBlockLocation,
  type CanvasBlock,
  type CanvasDoc,
} from "@/lib/canvas/model";
import {
  applyCanvasTemplate,
  createBoardSkeleton,
  createFreeImage,
  createFreeText,
  createFreeSticky,
  createFreeShape,
  insertBlockAtTarget,
  updateMaterialSnapshot,
  type CanvasTemplateKind,
} from "@/lib/canvas/commands";
import { hasCanvasClipboard } from "@/lib/canvas/clipboard";
import {
  describeInsertTarget,
  resolveInsertTarget,
  type ExplicitInsertPosition,
  type InsertTarget,
} from "@/lib/canvas/insert-target";
import { replaceImage, startImageInsert } from "@/lib/canvas/image-insert";
import { normalizeEmbedUrl, startEmbedInsert } from "@/lib/canvas/embed-insert";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { worldCenter, worldViewportRect } from "@/lib/canvas/coords";
import {
  duplicateCanvas,
  getCanvas,
  patchCanvas,
  type CanvasRow,
} from "@/lib/canvas/repository";
import { deleteDraft, loadDraft, saveDraft } from "@/lib/canvas/draft";
import { AutosaveController, type AutosaveSnapshot } from "@/lib/canvas/autosave";
import { isMockBackend, resolveAssetUrl, uploadCanvasImage } from "@/lib/canvas/assets";
import { validateCanvasContent } from "@/lib/canvas/validation";
import { membersForBoardExport } from "@/lib/canvas/board-export";
import { CanvasBoardExportSurface, runBoardExport } from "./canvas-board-export";
import { createCanvasStore, type CanvasSelection } from "./canvas-store";
import { boundsForSelection } from "@/lib/canvas/selection-bounds";
import { BLOCK_CHROME, computeScene } from "@/lib/canvas/layout";
import { createCanvasMeasure, useCanvasScene, useFontsReady } from "./use-canvas-scene";
import { useSourceStatus } from "./use-source-status";
import { CanvasMaterialPanel } from "./canvas-material-panel";
import {
  excerptSnapshot,
  fetchImageBlob,
  fetchReadingSnapshot,
  fetchSourceSnapshot,
  sourceRefFromLibraryItem,
} from "@/lib/library/material-source";
import type { LibraryItem } from "@organize/shared";
import { CanvasViewportView, clampZoom, zoomToFit, zoomToFitBounds } from "./canvas-viewport";
import { CanvasMinimap, CanvasMinimapToggle, useMinimapOpen } from "./canvas-minimap";
import { isFreeItemDragging } from "./canvas-free-item";
import { applyArrangeAction, isFreeArrangeAction, nudgeFreeItems, toggleSelectedFreeItemsLocked } from "./free-item-actions";
import { allFreeItemsLocked, hasLockedFreeItems } from "@/lib/canvas/free-lock";
import { freeIdsFromSelection } from "@/lib/canvas/free-selection";
import { CanvasPropertyBar, recomputeSmartSection } from "./canvas-property-bar";
import { canDetachSelection, commitDetachSelection } from "./canvas-detach-actions";
import { CanvasAddPanel, type AddBlockKind } from "./canvas-add-panel";
import { allCanvasBlockIds, canvasShortcutLabels, commitCanvasDuplicate, matchCanvasShortcut, zoomCanvasAtCenter } from "./canvas-shortcuts";
import { CanvasShortcutsDialog } from "./canvas-shortcuts-dialog";
import { hitTestInsertPosition } from "./canvas-hit-test";
import {
  applyDeleteCanvasSelection,
  commitCanvasCopy,
  commitCanvasCut,
  commitCanvasPasteFromClipboard,
} from "./canvas-clipboard-actions";
import {
  CanvasClipboardMenu,
  canvasContextMenuModel,
  type CanvasContextMenuAction,
  type CanvasContextMenuPoint,
  type CanvasContextMenuRequest,
} from "./canvas-context-menu";
import { useIsNarrowViewport } from "./use-is-narrow-viewport";
import { displayKey } from "./canvas-block";
import { useCanvasSelector } from "./use-canvas-selector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface CanvasWorkspaceProps {
  documentId: string;
  /** Explicit read-only mode disables every mutation, including connections. */
  readOnly?: boolean;
  /** Mobile keeps content in preview while allowing connector edits. */
  connectionsOnly?: boolean;
}

interface LoadState {
  phase: "loading" | "ready" | "not-found" | "unauthorized";
}

/** 添加面板「非图片 / 非链接视频」五项的块工厂与事务标签（模块级常量，避免每次渲染重建）。 */
const ADD_BLOCK_FACTORY: Record<Exclude<AddBlockKind, "image" | "embed">, () => CanvasBlock> = {
  title: () => createTextBlock("title"),
  body: () => createTextBlock("body"),
  list: () => createTextBlock("list"),
  divider: () => createDividerBlock(),
  button: () => createButtonBlock(),
};
const ADD_BLOCK_LABEL: Record<AddBlockKind, string> = {
  title: "插入标题",
  body: "插入正文",
  image: "插入图片",
  list: "插入列表",
  divider: "插入分隔线",
  button: "插入行动按钮",
  embed: "插入链接/视频",
};

/** 保存用序列化：pending 资产不带临时地址（占位）；已保存资产不带本机键。 */
function serializeDocForSave(doc: CanvasDoc): CanvasDoc {
  const clone: CanvasDoc = structuredClone(doc);
  const clean = (asset: { url: string; localKey?: string; uploadStatus?: string } | null) => {
    if (!asset) return;
    if (asset.uploadStatus !== "saved") {
      asset.url = "";
    } else {
      delete asset.localKey;
    }
  };
  for (const board of clone.boards) {
    for (const region of board.regions) {
      for (const section of region.sections) {
        for (const column of section.columns) {
          for (const block of column.blocks) {
            if (block.type === "image") clean(block.asset);
          }
        }
      }
    }
  }
  for (const item of clone.freeItems) {
    if (item.block.type === "image") clean(item.block.asset);
  }
  return clone;
}

export function CanvasWorkspace({ documentId, readOnly = false, connectionsOnly = false }: CanvasWorkspaceProps) {
  const router = useRouter();
  const focusBlockId = useSearchParams().get("focus");
  const handledFocus = useRef<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [remoteRow, setRemoteRow] = useState<CanvasRow | null>(null);
  const [showRemoteDialog, setShowRemoteDialog] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [findFocusNonce, setFindFocusNonce] = useState(0);
  const [findActivationNonce, setFindActivationNonce] = useState(0);
  const findButtonRef = useRef<HTMLButtonElement>(null);
  const openFind = useCallback(() => {
    setFindOpen(true);
    setFindFocusNonce((nonce) => nonce + 1);
  }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    findButtonRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindIndex(0);
  }, [documentId]);
  /** 预览演示的当前页（进入预览与翻页时更新；指示条与翻页键的数据源）。 */
  const [previewBoardId, setPreviewBoardId] = useState<string | null>(null);
  /** PNG 导出：目标页面 id（非 null 时挂载离屏静态层并执行一次导出）。 */
  const [exportJob, setExportJob] = useState<string | null>(null);
  const exportStageRef = useRef<HTMLDivElement | null>(null);
  const exportingRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuRequest | null>(null);
  const contextMenuRef = useRef<CanvasContextMenuRequest | null>(null);
  const contextNonce = useRef(0);
  /** 右键粘贴 URL 的接管（runEmbedInsert 定义在本组件后段，经 ref 桥接避免前向引用）。 */
  const embedInsertRef = useRef<((url: string, explicit?: ExplicitInsertPosition | null) => void) | null>(null);
  const [shortcutLabels, setShortcutLabels] = useState(() => canvasShortcutLabels());
  useEffect(() => {
    setShortcutLabels(canvasShortcutLabels(navigator.platform));
  }, []);
  const [userId, setUserId] = useState("");
  const narrow = useIsNarrowViewport();
  const [minimapOpen, toggleMinimap] = useMinimapOpen(narrow);
  /** 左侧面板折叠（窄空间可折叠，默认展开）。 */
  const [panelOpen, setPanelOpen] = useState(true);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  /** 自由放置「自由图片」的独立选择器（显式次级入口）。 */
  const freeImageInputRef = useRef<HTMLInputElement | null>(null);
  /** 「图片」按钮点击瞬间的目标快照：文件选择器打开后选区变化不影响在途目标。 */
  const imageTargetSnapshotRef = useRef<InsertTarget | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const store = useMemo(
    () =>
      createCanvasStore({
        doc: { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [], freeItems: [] },
        readOnly,
      }),
    [readOnly],
  );
  const loadedWorkspace = useRef<{ documentId: string; store: typeof store } | null>(null);
  const fontsReady = useFontsReady();
  const doc = useCanvasSelector(store, useCallback((s) => s.doc, []));
  const measureEpoch = useCanvasSelector(store, useCallback((s) => s.measureEpoch, []));
  const { scene, measurer } = useCanvasScene(doc, { measureEpoch, fontsReady });
  /** 资料来源可达性（E）：文档内 sourceRef 的 missing 角标。 */
  const sourceStatuses = useSourceStatus(doc);

  // 顶层订阅（避免条件 hooks）
  const title = useCanvasSelector(store, useCallback((s) => s.title, []));
  const saveStatus = useCanvasSelector(store, useCallback((s) => s.saveStatus, []));
  const previewMode = useCanvasSelector(store, useCallback((s) => s.previewMode, []));
  const recovered = useCanvasSelector(store, useCallback((s) => s.recoveredFromDraft, []));
  const conflictRevision = useCanvasSelector(store, useCallback((s) => s.conflictCurrentRevision, []));
  const viewport = useCanvasSelector(store, useCallback((s) => s.viewport, []));
  const selection = useCanvasSelector(store, useCallback((s) => s.selection, []));
  const editingBlockId = useCanvasSelector(store, useCallback((s) => s.editingBlockId, []));
  const assetUrls = useCanvasSelector(store, useCallback((s) => s.assetUrls, []));
  const localSeq = useCanvasSelector(store, useCallback((s) => s.localSeq, []));
  const lastActiveTarget = useCanvasSelector(store, useCallback((s) => s.lastActiveTarget, []));
  const canUndo = store.getState().history.canUndo;
  const canRedo = store.getState().history.canRedo;
  void localSeq;

  /** 统一插入目标（目标提示 + 各入口共用解析）。 */
  const insertTarget = useMemo(
    () => resolveInsertTarget(doc, selection, null, lastActiveTarget),
    [doc, selection, lastActiveTarget],
  );
  const insertHint = describeInsertTarget(doc, insertTarget);

  const autosaveRef = useRef<AutosaveController | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------- 加载与草稿恢复 ----------------

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    let controller: AutosaveController | null = null;

    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id ?? "anonymous";
      if (cancelled) return;
      setUserId(uid);

      const remote = await getCanvas(documentId);
      if (cancelled) return;
      if (!remote.ok) {
        setLoad({ phase: remote.reason === "unauthorized" ? "unauthorized" : "not-found" });
        return;
      }
      setRemoteRow(remote.row);

      const draft = await loadDraft(uid, documentId);
      // B1：读取侧统一 v2（远端经 repository ensure；草稿/旧数据在此迁移）
      let useDoc = ensureCanvasDocV2(remote.row.content);
      let useTitle = remote.row.title;
      let recovered = false;
      if (draft && draft.localSeq > 0 && validateCanvasContent(draft.doc).errors.length === 0) {
        // 本机草稿领先远端：恢复草稿内容（A11）；v1 草稿经 ensure 迁移为 v2
        useDoc = ensureCanvasDocV2(draft.doc);
        useTitle = draft.title;
        recovered = true;
      }
      store.getState().init({
        doc: useDoc,
        title: useTitle,
        revision: remote.row.revision,
        readOnly,
        recoveredFromDraft: recovered,
      });
      loadedWorkspace.current = { documentId, store };
      setLoad({ phase: "ready" });

      // 解析本机图片（mock-image: / pending）为可渲染对象 URL
      const assets: { blockId: string; asset: Parameters<typeof resolveAssetUrl>[0] }[] = [];
      for (const board of useDoc.boards)
        for (const region of board.regions)
          for (const section of region.sections)
            for (const column of section.columns)
              for (const block of column.blocks)
                if (block.type === "image" && block.asset)
                  assets.push({ blockId: block.id, asset: block.asset });
      for (const item of useDoc.freeItems)
        if (item.block.type === "image" && item.block.asset)
          assets.push({ blockId: item.id, asset: item.block.asset });
      for (const entry of assets) {
        if (!entry.asset.url || entry.asset.url.startsWith("mock-image:")) {
          const url = await resolveAssetUrl(entry.asset, uid);
          if (url) store.getState().setAssetUrl(displayKey(entry.blockId, entry.asset), url);
        }
      }

      if (readOnly) return;

      // 自动保存（串行 CAS；mock 下经 api-shim，行为一致）
      controller = new AutosaveController(
        async (snapshot: AutosaveSnapshot) => {
          const outcome = await patchCanvas(documentId, {
            title: snapshot.title,
            content: snapshot.docJson as CanvasDoc,
            expectedRevision: snapshot.expectedRevision,
          });
          if (outcome.ok) {
            store.getState().markSaved(outcome.revision, snapshot.localSeq);
            if (store.getState().localSeq === snapshot.localSeq) void deleteDraft(uid, documentId);
            return { ok: true, revision: outcome.revision };
          }
          if (outcome.reason === "conflict") {
            store.getState().setSaveStatus("conflict", outcome.currentRevision);
            return { ok: false as const, reason: "conflict" as const, currentRevision: outcome.currentRevision };
          }
          store.getState().setSaveStatus("error");
          return { ok: false as const, reason: outcome.reason };
        },
        (state) => {
          if (state === "saving" || state === "pending") store.getState().setSaveStatus("saving");
          else if (state === "error") store.getState().setSaveStatus("error");
          else if (state === "idle") store.getState().setSaveStatus("saved");
        },
        { debounceMs: 800, retryMs: 8000 },
      );
      autosaveRef.current = controller;

      unsub = store.subscribe((state, prev) => {
        // 编辑结束只有请求计数变化；不能被下方的“文档没变”判断短路。
        if (state.smartRecomputeSeq !== prev.smartRecomputeSeq) {
          for (const board of state.doc.boards) {
            for (const region of board.regions) {
              for (const section of region.sections) {
                if (section.widthMode === "smart") recomputeSmartSection(store, measurer, section.id);
              }
            }
          }
        }
        if (state.doc === prev.doc && state.title === prev.title) return;
        controller!.schedule({
          title: state.title,
          docJson: serializeDocForSave(state.doc),
          expectedRevision: state.revision,
          localSeq: state.localSeq,
        });
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        draftTimerRef.current = setTimeout(() => {
          void saveDraft({
            docId: documentId,
            userId: uid,
            title: state.title,
            doc: state.doc,
            savedRevision: state.revision,
            localSeq: state.localSeq,
            updatedAt: Date.now(),
          });
        }, 400);
      });
      store.getState().setSaveStatus("saved");
    })();

    return () => {
      cancelled = true;
      unsub?.();
      controller?.destroy();
      autosaveRef.current = null;
    };
    // measurer 稳定；store 每文档一个实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, readOnly, store]);

  // 智能比例首算：加载完成且字体就绪后跑一遍
  useEffect(() => {
    if (load.phase !== "ready" || !fontsReady) return;
    const t = setTimeout(() => {
      const state = store.getState();
      for (const board of state.doc.boards) {
        for (const region of board.regions) {
          for (const section of region.sections) {
            if (section.widthMode === "smart") {
              recomputeSmartSection(store, measurer, section.id);
            }
          }
        }
      }
    }, 50);
    return () => clearTimeout(t);
  }, [load.phase, fontsReady, store, measurer]);

  // MiSans 加载前后度量不同：字体就绪事件（PR #319 FontReadyBridge）触发后
  // 清空测量缓存并整体重算场景（文字、节点盒、后续连线锚点都从场景派生）。
  // 初始化时 data-fonts-ready 已为 true 则立即重测一次。
  useEffect(() => {
    const remeasure = () => {
      measurer.clearCache();
      store.getState().bumpMeasureEpoch();
    };
    if (document.documentElement.dataset.fontsReady === "true") {
      remeasure();
    }
    window.addEventListener("organize:fonts-ready", remeasure);
    return () => window.removeEventListener("organize:fonts-ready", remeasure);
  }, [measurer, store]);

  // ---------------- 关闭/刷新前 flush ----------------

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const controller = autosaveRef.current;
      if (controller?.hasPending) {
        void controller.flush();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // ---------------- 工具条动作 ----------------

  /** 浮动添加/属性面板覆盖的区域不算可用画布，新建与适合全部使用同一矩形。 */
  const visibleViewportNow = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return null;
    const rect = shell.getBoundingClientRect();
    const parent = shell.parentElement;
    const leftPanel = parent?.querySelector(".canvas-add-panel-wrap")?.getBoundingClientRect();
    const rightPanel = parent?.querySelector(".canvas-property-bar")?.getBoundingClientRect();
    const x = leftPanel ? Math.max(0, leftPanel.right - rect.left + 16) : 0;
    const right = rightPanel ? Math.min(rect.width, rightPanel.left - rect.left - 16) : rect.width;
    return { x, y: 40, width: Math.max(120, right - x), height: Math.max(120, rect.height - 104) };
  }, []);

  /** Buttons and shortcuts keep the same visible world point under the viewport center. */
  const changeCanvasZoom = useCallback((zoom: number) => {
    const rect = visibleViewportNow();
    if (rect) store.getState().setViewport(zoomCanvasAtCenter(store.getState().viewport, zoom, rect));
  }, [store, visibleViewportNow]);

  const fitAll = useCallback(() => {
    const rect = visibleViewportNow();
    zoomToFit(
      scene,
      (vp) => store.getState().setViewport({ ...vp, x: (vp.x ?? 0) + (rect?.x ?? 0), y: (vp.y ?? 0) + (rect?.y ?? 0) }),
      rect ? { width: rect.width, height: rect.height } : { width: 1200, height: 800 },
    );
  }, [scene, store, visibleViewportNow]);

  const selectionBounds = useMemo(() => boundsForSelection(scene, selection, doc), [scene, selection, doc]);
  const fitSelection = useCallback((target?: CanvasSelection) => {
    const state = store.getState();
    const rect = visibleViewportNow();
    zoomToFitBounds(
      boundsForSelection(scene, target === undefined ? state.selection : target, state.doc),
      (vp) => state.setViewport({ ...vp, x: (vp.x ?? 0) + (rect?.x ?? 0), y: (vp.y ?? 0) + (rect?.y ?? 0) }),
      rect ?? { width: 1200, height: 800 },
    );
  }, [scene, store, visibleViewportNow]);

  // ---------------- 画布内查找（只读 UI） ----------------

  const findHits = useMemo(() => findCanvasContent(doc, findQuery), [doc, findQuery]);
  const activeFindIndex = findHits.length ? Math.min(findIndex, findHits.length - 1) : 0;
  const activeFindHit = findOpen ? findHits[activeFindIndex] : undefined;
  const stepFind = useCallback((step: 1 | -1) => {
    if (!findHits.length) return;
    setFindActivationNonce((nonce) => nonce + 1);
    setFindIndex((index) => (Math.min(index, findHits.length - 1) + step + findHits.length) % findHits.length);
  }, [findHits.length]);

  useEffect(() => {
    if (!activeFindHit) return;
    const state = store.getState();
    state.stopEdit();
    state.select(activeFindHit.target);
    // 等待属性栏随选区完成渲染，再测量实际可用视口。
    const frame = requestAnimationFrame(() => fitSelection(activeFindHit.target));
    if (state.previewMode && "boardId" in activeFindHit.target) setPreviewBoardId(activeFindHit.target.boardId);
    return () => cancelAnimationFrame(frame);
  }, [activeFindHit, store, fitSelection, findActivationNonce]);

  useEffect(() => {
    if (!activeFindHit) return;
    const attr = { board: "board", region: "region", block: "block", free: "free-item", connector: "connector" }[activeFindHit.kind];
    const element = shellRef.current?.querySelector(`[data-${attr}-id="${CSS.escape(activeFindHit.id)}"]`);
    element?.classList.add("canvas-find-hit");
    const timer = setTimeout(() => element?.classList.remove("canvas-find-hit"), 2000);
    return () => {
      clearTimeout(timer);
      element?.classList.remove("canvas-find-hit");
    };
  }, [activeFindHit, selection, findActivationNonce]);

  // ---------------- 预览按页演示 ----------------

  /** 预览翻页：按 doc.boards 顺序循环选页并适合该页（与「适合选区」同一路径）。 */
  const gotoPreviewPage = useCallback(
    (step: 1 | -1) => {
      const boardId = stepPreviewBoardId(store.getState().doc, previewBoardId, step);
      if (!boardId) return;
      setPreviewBoardId(boardId);
      store.getState().select({ kind: "board", boardId });
      fitSelection({ kind: "board", boardId });
    },
    [store, fitSelection, previewBoardId],
  );

  /**
   * 进入预览自动落页：togglePreview 会清空选区，落页目标取进入前选区
   * （直接归属页 / 自由元素几何最近页 / 第一页）。退出预览保持清空选区的
   * 原语义、不改视口缩放。
   */
  useEffect(() => {
    const unsub = store.subscribe((state, prev) => {
      if (state.previewMode === prev.previewMode) return;
      if (!state.previewMode) {
        store.getState().select(null);
        setPreviewBoardId(null);
        return;
      }
      const boardId = resolvePreviewBoardId(state.doc, scene, prev.selection);
      setPreviewBoardId(boardId);
      if (!boardId) return;
      store.getState().select({ kind: "board", boardId });
      fitSelection({ kind: "board", boardId });
    });
    return unsub;
  }, [store, scene, fitSelection]);

  /** 指示条数据：记忆页失效（如远端同步删页）时回退第一页展示。 */
  const pagerIndex = previewMode
    ? doc.boards.findIndex((b) => b.id === previewBoardId)
    : -1;
  const pagerBoard = previewMode ? (pagerIndex >= 0 ? doc.boards[pagerIndex] : doc.boards[0] ?? null) : null;

  // ---------------- 导出页面为 PNG ----------------

  const exportingBoard = exportJob !== null;

  /** 导出入口（属性栏/大纲/把手/预览指示条共用）：只读副作用，不写文档。 */
  const startBoardExport = useCallback(
    (boardId: string) => {
      if (exportingRef.current) return;
      if (!membersForBoardExport(store.getState().doc, scene, boardId)) {
        toast({ title: "无法导出", description: "页面不存在或画布为空", variant: "destructive" });
        return;
      }
      exportingRef.current = true;
      setExportJob(boardId);
    },
    [scene, store],
  );

  /** 导出编排：等离屏静态层挂载后光栅化并下载；成功轻提示、失败 destructive toast。 */
  useEffect(() => {
    if (exportJob === null) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      void (async () => {
        const state = store.getState();
        try {
          await runBoardExport({
            stage: exportStageRef.current,
            boardId: exportJob,
            doc: state.doc,
            scene,
            canvasTitle: state.title,
            fontsReady,
          });
          if (!cancelled) toast({ title: "已导出 PNG" });
        } catch (error) {
          if (!cancelled) {
            toast({
              title: "导出失败",
              description: error instanceof Error ? error.message : "光栅化失败，请重试",
              variant: "destructive",
            });
          }
        } finally {
          exportingRef.current = false;
          if (!cancelled) setExportJob(null);
        }
      })();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // scene/fontsReady 取点击时刻的闭包值；只在任务变化时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportJob, store]);

  // A link from the library is a one-shot selection, after document/font geometry is ready.
  useEffect(() => {
    if (focusBlockId === null) { handledFocus.current = null; return; }
    const request = `${documentId}:${focusBlockId}`;
    if (load.phase !== "ready" || loadedWorkspace.current?.documentId !== documentId
      || loadedWorkspace.current.store !== store || !fontsReady || handledFocus.current === request) return;
    const target = selectionForFocus(doc, focusBlockId);
    if (target) {
      if (JSON.stringify(selection) !== JSON.stringify(target)) {
        store.getState().select(target);
        return; // Let the property panel render before measuring the unobstructed viewport.
      }
      if (!boundsForSelection(scene, target, doc)) return;
      fitSelection(target);
    }
    handledFocus.current = request;
    router.replace(withoutCanvasFocus(window.location.href), { scroll: false });
  }, [documentId, focusBlockId, load.phase, fontsReady, doc, scene, selection, store, fitSelection, router]);

  const openContextMenu = useCallback((point: CanvasContextMenuPoint) => {
    contextNonce.current += 1;
    const next = { ...point, nonce: contextNonce.current };
    contextMenuRef.current = next;
    setContextMenu(next);
  }, []);

  const onContextAction = useCallback((action: CanvasContextMenuAction) => {
    if (action === "toggle-lock") {
      toggleSelectedFreeItemsLocked(store);
      return;
    }
    if (action === "detach-to-free") {
      commitDetachSelection(store, scene);
      return;
    }
    if (action === "copy") {
      commitCanvasCopy(store);
      return;
    }
    if (action === "cut") {
      commitCanvasCut(store);
      return;
    }
    if (action === "duplicate") {
      commitCanvasDuplicate(store);
      return;
    }
    if (action === "delete") {
      applyDeleteCanvasSelection(store);
      return;
    }
    if (action === "select-all") {
      const blockIds = allCanvasBlockIds(store.getState().doc);
      if (blockIds.length) store.getState().select({ kind: "blocks", blockIds });
      return;
    }
    if (action === "zoom-fit") {
      fitAll();
      return;
    }
    if (isFreeArrangeAction(action)) {
      applyArrangeAction(store, action, scene.freeItems);
      return;
    }
    const request = contextMenuRef.current;
    if (!request) return;
    const explicit = hitTestInsertPosition(store.getState().doc, scene, request.world.x, request.world.y);
    void commitCanvasPasteFromClipboard(store, {
      pointer: request.world,
      explicit,
      atPointer: request.scope === "canvas",
      onInsertEmbed: (url, pasteExplicit) => embedInsertRef.current?.(url, pasteExplicit),
    });
  }, [fitAll, scene, store]);

  // ---------------- 键盘 ----------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (load.phase !== "ready" || e.defaultPrevented || e.isComposing || e.keyCode === 229 || hasOpenDialog()) return;
      const s = store.getState();
      const inFindBar = (e.target as HTMLElement | null)?.closest(".canvas-find-bar");
      // 查找框自身允许重复 Mod+F，其余输入控件保留原生文字查找。
      if (matchCanvasShortcut(e) === "find" || (inFindBar && !e.altKey && !e.shiftKey &&
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f")) {
        e.preventDefault();
        e.stopPropagation();
        openFind();
        return;
      }
      if (findOpen && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeFind();
        return;
      }
      if (s.previewMode && e.key === "Escape") {
        s.togglePreview();
        return;
      }
      // 预览翻页（→ / ← / PageDown / PageUp / Space / Shift+Space）；
      // 匹配留在本 keydown（依赖 previewMode 守卫），输入焦点与弹层让位。
      if (s.previewMode && !isTypingTarget(e)) {
        const step = previewPageStep(e);
        if (step !== 0) {
          e.preventDefault();
          e.stopPropagation();
          gotoPreviewPage(step);
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
        if (s.readOnly || s.previewMode) return;
        // 目标是否为画布块内文本域（受控 textarea）：画布统一撤销接管，
        // 防止与文档撤销打架；普通输入框（页面名/属性栏/搜索等）走原生，不抢。
        const target = e.target as HTMLElement | null;
        const isCanvasTextarea =
          !!target && target.tagName === "TEXTAREA" && !!target.closest("[data-block-id], [data-free-item-id]");
        if (isTypingTarget(e) && !isCanvasTextarea) return;
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229 && s.editingBlockId && !hasOpenDialog()) {
        const target = e.target as HTMLElement | null;
        if (target?.closest("[data-block-id], [data-free-item-id]")) {
          e.preventDefault();
          const id = s.editingBlockId;
          s.stopEdit(id);
          target.closest<HTMLElement>("[data-block-id], [data-free-item-id]")?.focus({ preventScroll: true });
          s.requestSmartRecompute();
          return;
        }
      }
      // 输入控件内（区块名编辑/属性栏输入框/对话框）不触发画布快捷键
      if (isTypingTarget(e)) return;
      if (s.editingBlockId) return;
      if (connectionsOnly && s.selection?.kind !== "connector" && e.key !== "Escape" && matchCanvasShortcut(e) !== "zoom-fit") return;
      if (connectionsOnly && s.selection?.kind === "connector" && ["cut", "duplicate", "select-all", "paste"].includes(matchCanvasShortcut(e) ?? "")) return;
      const action = matchCanvasShortcut(e);
      // ⌘V 交给 paste 事件，避免按键和系统剪贴板各粘一次。
      if (action === "paste") return;
      if (action) {
        if (action === "duplicate" && (s.readOnly || s.previewMode)) return;
        if (action === "cut" && (s.readOnly || s.previewMode)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        // Capture consumes canvas keys before focused objects and the global ? help.
        e.stopPropagation();
        switch (action) {
          case "select-all": {
            const blockIds = allCanvasBlockIds(s.doc);
            if (blockIds.length) s.select({ kind: "blocks", blockIds });
            break;
          }
          case "copy": {
            commitCanvasCopy(store);
            break;
          }
          case "cut": {
            commitCanvasCut(store);
            break;
          }
          case "duplicate": {
            commitCanvasDuplicate(store);
            break;
          }
          case "zoom-in": changeCanvasZoom(s.viewport.zoom * 1.2); break;
          case "zoom-out": changeCanvasZoom(s.viewport.zoom / 1.2); break;
          case "zoom-reset": changeCanvasZoom(1); break;
          case "zoom-fit": fitAll(); break;
          case "zoom-selection": fitSelection(); break;
          case "help": setShowShortcuts(true); break;
        }
        return;
      }
      if (s.readOnly || s.previewMode) return;
      // 选中自由元素：方向键微调 1px（⇧ 10px）；宽度手柄聚焦时左右键留给手柄调宽度；
      // 拖动中不响应（拖动有自己的 Esc/吸附逻辑）。
      const freeNudgeIds = s.selection?.kind === "free" ? [s.selection.itemId]
        : s.selection?.kind === "frees" ? s.selection.itemIds : null;
      if (
        freeNudgeIds &&
        !isFreeItemDragging() &&
        !e.metaKey && !e.ctrlKey && !e.altKey &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        const target = e.target as HTMLElement | null;
        if (target?.closest(".canvas-resize-handle")) return;
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        e.preventDefault();
        nudgeFreeItems(store, freeNudgeIds, dx, dy);
        return;
      }
      if (e.code === "Space") {
        setSpaceHeld(true);
        return;
      }
      if (e.key === "Escape") {
        // 弹层打开时 Esc 让位给弹层自身关闭（属性栏对话框等）；
        // 自由元素拖动中的 Esc 只取消拖动（canvas-free-item 自行处理），不清选区。
        if (hasOpenDialog() || isFreeItemDragging()) return;
        s.select(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selection) {
        e.preventDefault();
        applyDeleteCanvasSelection(store);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [store, load.phase, changeCanvasZoom, fitAll, fitSelection, gotoPreviewPage, connectionsOnly, findOpen, openFind, closeFind]);

  const worldCenterNow = useCallback(() => {
    const rect = visibleViewportNow();
    const vp = store.getState().viewport;
    return rect ? worldCenter(rect, vp) : { x: 0, y: 0 };
  }, [store, visibleViewportNow]);

  /** 当前视口的世界矩形（新建页面自动落位用；拿不到容器尺寸时返回 null）。 */
  const worldViewportRectNow = useCallback(() => {
    const rect = visibleViewportNow();
    if (!rect) return null;
    return worldViewportRect(rect, store.getState().viewport);
  }, [store, visibleViewportNow]);

  const addFreeText = useCallback(() => {
    const at = worldCenterNow();
    store.getState().apply("新建自由文本", (d) => createFreeText(d, at));
    const sel = store.getState().selection;
    if (sel?.kind === "free") store.getState().startEdit(sel.itemId);
  }, [store, worldCenterNow]);

  const addFreeSticky = useCallback(() => {
    const at = worldCenterNow();
    store.getState().apply("新建便签", (d) => createFreeSticky(d, at));
    const sel = store.getState().selection;
    if (sel?.kind === "free") store.getState().startEdit(sel.itemId);
  }, [store, worldCenterNow]);

  const addFreeShape = useCallback((kind: "rect" | "ellipse") => {
    const center = worldCenterNow();
    store.getState().apply(`新建${kind === "rect" ? "矩形" : "椭圆"}`, (d) =>
      createFreeShape(d, { kind, x: center.x - 80, y: center.y - (100 + BLOCK_CHROME) / 2 }));
  }, [store, worldCenterNow]);

  /** 面板之间放不下默认页面时，缩小新页面以保留两侧加号的操作空间。 */
  const fitNewPageIfNeeded = useCallback(() => {
    const rect = visibleViewportNow();
    const state = store.getState();
    const board = state.selection?.kind === "block"
      ? findBlockLocation(state.doc, state.selection.blockId)?.board : null;
    if (!rect || !board || board.width * state.viewport.zoom <= rect.width - 48) return;
    const zoom = clampZoom((rect.width - 48) / board.width);
    state.setViewport({ zoom, x: rect.x + 24 - board.x * zoom, y: rect.y + 24 - board.y * zoom });
  }, [store, visibleViewportNow]);

  /**
   * 统一解析插入目标（B2）：explicit 为拖入/粘贴的指针命中位置。
   * 完全空白时先自动建空白页面（视口落位），再二次解析——保证新内容
   * 一定进入页面区块，不默认创建自由内容。
   */
  const resolveInsertTargetNow = useCallback(
    (explicit?: ExplicitInsertPosition | null): InsertTarget => {
      const s = store.getState();
      let target = resolveInsertTarget(s.doc, s.selection, explicit ?? null, s.lastActiveTarget);
      if ("create" in target) {
        s.apply("新建空白页面", (d) =>
          createBoardSkeleton(d, { viewportRect: worldViewportRectNow(), variant: "blank" }),
        );
        fitNewPageIfNeeded();
        const s2 = store.getState();
        target = resolveInsertTarget(s2.doc, s2.selection, null, s2.lastActiveTarget);
      }
      return target;
    },
    [store, worldViewportRectNow, fitNewPageIfNeeded],
  );

  // B1 新建入口：空白页面 / 宣传落地页骨架（落位走 A4 视口逻辑，首标题聚焦）
  const addBlankBoard = useCallback(() => {
    store.getState().apply("新建空白页面", (d) =>
      createBoardSkeleton(d, { viewportRect: worldViewportRectNow(), variant: "blank" }),
    );
    fitNewPageIfNeeded();
  }, [store, worldViewportRectNow, fitNewPageIfNeeded]);

  const addLandingBoard = useCallback(() => {
    store.getState().apply("新建宣传落地页骨架", (d) =>
      createBoardSkeleton(d, { viewportRect: worldViewportRectNow(), variant: "landing" }),
    );
    fitNewPageIfNeeded();
  }, [store, worldViewportRectNow, fitNewPageIfNeeded]);

  /** 选中并把对象平移到视口中央（不改缩放）。 */
  const revealTarget = useCallback(
    (target: { kind: "board"; boardId: string } | { kind: "region"; boardId: string; regionId: string }) => {
      const rect = visibleViewportNow();
      if (!rect) return;
      // 复制命令后 React 尚未提交新 scene，按最新文档立即计算新页面几何。
      const liveScene = store.getState().doc === doc ? scene : computeScene(store.getState().doc, createCanvasMeasure(measurer));
      const sb = liveScene.boards.find((b) => b.boardId === target.boardId);
      if (!sb) return;
      let top: number;
      let height: number;
      if (target.kind === "region") {
        const sr = sb.regions.find((r) => r.regionId === target.regionId);
        if (!sr) return;
        top = sr.y;
        height = sr.height;
      } else {
        top = sb.y;
        height = sb.height;
      }
      const vp = store.getState().viewport;
      store.getState().setViewport({
        // 大于可用视口时对齐左上角，保留第一行可编辑；小对象居中。
        x: rect.x + Math.max(0, (rect.width - sb.width * vp.zoom) / 2) - sb.x * vp.zoom,
        y: rect.y + Math.max(0, (rect.height - height * vp.zoom) / 2) - top * vp.zoom,
      });
    },
    [doc, measurer, scene, store, visibleViewportNow],
  );

  /** 目标在视口内则不跳动；平移远离后新建/插入会把目标带回可视区（B2）。 */
  const revealIfNeeded = useCallback(
    (target: { kind: "board"; boardId: string } | { kind: "region"; boardId: string; regionId: string }) => {
      const rect = visibleViewportNow();
      if (!rect) return;
      const sb = scene.boards.find((b) => b.boardId === target.boardId);
      if (!sb) return;
      let top: number;
      let height: number;
      if (target.kind === "region") {
        const sr = sb.regions.find((r) => r.regionId === target.regionId);
        if (!sr) return;
        top = sr.y;
        height = sr.height;
      } else {
        top = sb.y;
        height = sb.height;
      }
      const vp = store.getState().viewport;
      const viewTop = (rect.y - vp.y) / vp.zoom;
      const viewBottom = viewTop + rect.height / vp.zoom;
      const viewLeft = (rect.x - vp.x) / vp.zoom;
      const viewRight = viewLeft + rect.width / vp.zoom;
      if (top + height > viewTop && top < viewBottom && sb.x + sb.width > viewLeft && sb.x < viewRight) return;
      revealTarget(target);
    },
    [scene, store, revealTarget, visibleViewportNow],
  );

  /** 模板插入当前选中页面（统一解析：无选中 → lastActive → 自动建页面）。 */
  const applyTemplate = useCallback(
    (template: CanvasTemplateKind) => {
      const target = resolveInsertTargetNow();
      if ("create" in target) return;
      store.getState().apply("插入模板", (d) => applyCanvasTemplate(d, { boardId: target.boardId, template }));
      store.getState().requestSmartRecompute();
      revealTarget({ kind: "board", boardId: target.boardId });
    },
    [store, resolveInsertTargetNow, revealTarget],
  );

  /** 链接 / 视频插入编排（添加面板 prompt 与粘贴 URL 两入口共用）。 */
  const runEmbedInsert = useCallback(
    async (url: string, explicit?: ExplicitInsertPosition | null) => {
      const target = resolveInsertTargetNow(explicit ?? null);
      if ("create" in target) {
        toast({ title: "无法插入链接", description: "请先选中页面或区块再粘贴链接", variant: "destructive" });
        return;
      }
      await startEmbedInsert({ store, target, url });
      revealIfNeeded({ kind: "region", boardId: target.boardId, regionId: target.regionId });
    },
    [store, resolveInsertTargetNow, revealIfNeeded],
  );
  embedInsertRef.current = (url, explicit) => {
    void runEmbedInsert(url, explicit);
  };

  /** 添加面板七项（B2 统一解析 + E 链接视频）。 */
  const addBlock = useCallback(
    (kind: AddBlockKind) => {
      if (kind === "image") {
        // 打开文件选择器前固定目标快照（选择期间选区变化不影响在途目标）
        imageTargetSnapshotRef.current = resolveInsertTargetNow();
        imageInputRef.current?.click();
        return;
      }
      if (kind === "embed") {
        void (async () => {
          const input = await showPrompt({
            title: "链接 / 视频",
            placeholder: "https://…（支持 YouTube / Bilibili 等，其余生成链接卡片）",
            confirmText: "插入",
          });
          if (input === null) return;
          const url = normalizeEmbedUrl(input);
          if (!url) {
            toast({ title: "链接无效", description: "请输入 http(s) 链接", variant: "destructive" });
            return;
          }
          await runEmbedInsert(url);
        })();
        return;
      }
      const target = resolveInsertTargetNow();
      if ("create" in target) return;
      const block = ADD_BLOCK_FACTORY[kind]();
      store.getState().apply(ADD_BLOCK_LABEL[kind], (d) => insertBlockAtTarget(d, target, block));
      // 平移远离后插入：把目标区块带回可视区（视口内则不跳动）
      revealIfNeeded({ kind: "region", boardId: target.boardId, regionId: target.regionId });
    },
    [store, resolveInsertTargetNow, revealIfNeeded, runEmbedInsert],
  );

  /** 图片统一插入编排（面板/拖入/粘贴三入口共用）。 */
  const runImageInsert = useCallback(
    async (files: File[], target: InsertTarget) => {
      const outcome = await startImageInsert({
        store,
        target,
        files,
        upload: uploadCanvasImage,
        userId: userId || "anonymous",
        fallbackPosition: worldCenterNow,
        onInvalidFile: (_file, reason) =>
          toast({ title: "无法插入文件", description: reason, variant: "destructive" }),
        onOrphaned: (name) =>
          toast({
            title: "图片已上传，但插入位置已被删除",
            description: `${name} 已转为「待重新放置」的自由图片，可在属性栏「移入区块…」归位。`,
          }),
        onUploaded: () => store.getState().requestSmartRecompute(),
      });
      void outcome;
      // 面板按钮入口（lastActive 可能已不在可视区）：把目标区块带回视野
      if (!("create" in target)) {
        revealIfNeeded({ kind: "region", boardId: target.boardId, regionId: target.regionId });
      }
    },
    [store, userId, worldCenterNow, revealIfNeeded],
  );

  /** 「图片」面板按钮回调：目标已在点击瞬间快照。 */
  const onImageFilesPicked = useCallback(
    async (files: File[] | undefined) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      const target = imageTargetSnapshotRef.current;
      imageTargetSnapshotRef.current = null;
      if (!target) return;
      if ("create" in target) return; // 解析时已经建过页面，不应出现
      await runImageInsert(list, target);
    },
    [runImageInsert],
  );

  /** 拖入 / 粘贴（B2）：指针命中列/区块 → explicit；空白处就地建页面。 */
  const onInsertFiles = useCallback(
    (files: File[], explicit: ExplicitInsertPosition | null, at: { x: number; y: number }) => {
      if (files.length === 0) return;
      const s = store.getState();
      let target = resolveInsertTarget(s.doc, s.selection, explicit, s.lastActiveTarget);
      if ("create" in target) {
        s.apply("新建空白页面", (d) => createBoardSkeleton(d, { at, variant: "blank" }));
        const s2 = store.getState();
        target = resolveInsertTarget(s2.doc, s2.selection, null, s2.lastActiveTarget);
        if ("create" in target) return;
      }
      void runImageInsert(files, target);
    },
    [store, runImageInsert],
  );

  /** 图片块「替换图片」（占位点击 / 属性栏共用同一入口）。 */
  const onReplaceImage = useCallback(
    (blockId: string, file: File) => {
      void replaceImage({
        store,
        blockId,
        file,
        upload: uploadCanvasImage,
        userId: userId || "anonymous",
        onReplaced: () => store.getState().requestSmartRecompute(),
      }).catch((error: unknown) => {
        toast({
          title: "替换图片失败",
          description: error instanceof Error ? error.message : "请重试",
          variant: "destructive",
        });
      });
    },
    [store, userId],
  );

  /** 自由放置「自由图片」：显式次级入口，上传成功后自由定位。 */
  const onFreeImageFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const outcome = await uploadCanvasImage(file, userId || "anonymous");
        const at = worldCenterNow();
        store.getState().apply("新建自由图片", (d) => createFreeImage(d, { ...at, asset: outcome.asset }));
        const sel = store.getState().selection;
        if (sel?.kind === "free" && outcome.previewUrl) {
          store.getState().setAssetUrl(displayKey(sel.itemId, outcome.asset), outcome.previewUrl);
        }
        store.getState().requestSmartRecompute();
      } catch (error) {
        toast({
          title: "图片上传失败",
          description: error instanceof Error ? error.message : "请重试",
          variant: "destructive",
        });
      }
    },
    [store, userId, worldCenterNow],
  );

  // ---------------- 资料插入画布（阶段 E，统一插入目标解析） ----------------

  /** 引用整条资料：快照卡片（materialCard）插入统一解析目标。 */
  const insertMaterialCard = useCallback(
    (item: LibraryItem) => {
      const state = store.getState();
      if (state.readOnly || state.previewMode) return;
      const target = resolveInsertTargetNow();
      if ("create" in target) {
        toast({ title: MATERIAL_ADD_ERROR, description: "请选择可用的页面或区块", variant: "destructive" });
        return;
      }
      const sourceRef = sourceRefFromLibraryItem(item);
      const block = createMaterialCardBlock({
        title: sourceRef.title,
        text: excerptSnapshot(sourceRef.excerpt ?? ""),
        sourceRef,
      });
      store.getState().apply("引用资料卡片", (d) => insertBlockAtTarget(d, target, block));
      toast({ title: MATERIAL_ADD_SUCCESS });
      revealIfNeeded({ kind: "region", boardId: target.boardId, regionId: target.regionId });
    },
    [store, resolveInsertTargetNow, revealIfNeeded],
  );

  /** 插入文字摘录：正文块（快照副本）+ 来源引用；无选区时取完整摘要。 */
  const insertMaterialExcerpt = useCallback(
    (item: LibraryItem, text: string) => {
      const target = resolveInsertTargetNow();
      if ("create" in target) return;
      const block: CanvasBlock = {
        ...createTextBlock("body", excerptSnapshot(text)),
        sourceRef: sourceRefFromLibraryItem(item),
      };
      store.getState().apply("插入资料摘录", (d) => insertBlockAtTarget(d, target, block));
      revealIfNeeded({ kind: "region", boardId: target.boardId, regionId: target.regionId });
    },
    [store, resolveInsertTargetNow, revealIfNeeded],
  );

  /**
   * 插入来源图片：读取 reading 正文第一张图 → 复制上传为画布自有资产
   * （资产生命周期与源解耦：删源不误删画布图）→ 图片块 + 来源引用。
   */
  const insertMaterialImage = useCallback(
    async (item: LibraryItem) => {
      try {
        const supabase = createClient();
        const snapshot = await fetchReadingSnapshot(supabase, item.id);
        if (!snapshot) {
          toast({ title: "来源不可用", description: "资料已删除或无权限，无法读取图片。", variant: "destructive" });
          return;
        }
        if (!snapshot.imageSrc) {
          toast({ title: "正文中没有可用图片", variant: "destructive" });
          return;
        }
        const blob = await fetchImageBlob(snapshot.imageSrc);
        const file = new File([blob], snapshot.imageAlt || "source-image", { type: blob.type || "image/png" });
        const outcome = await uploadCanvasImage(file, userId || "anonymous");
        const target = resolveInsertTargetNow();
        if ("create" in target) return;
        const imageBlock = createImageBlock(outcome.asset);
        imageBlock.alt = snapshot.imageAlt ?? undefined;
        imageBlock.sourceRef = snapshot.sourceRef;
        const block: CanvasBlock = imageBlock;
        store.getState().apply("插入资料图片", (d) => insertBlockAtTarget(d, target, block));
        if (outcome.previewUrl) {
          store.getState().setAssetUrl(displayKey(block.id, outcome.asset), outcome.previewUrl);
        }
        store.getState().requestSmartRecompute();
        revealIfNeeded({ kind: "region", boardId: target.boardId, regionId: target.regionId });
      } catch (error) {
        toast({
          title: "插入资料图片失败",
          description: error instanceof Error ? error.message : "请重试",
          variant: "destructive",
        });
      }
    },
    [store, userId, resolveInsertTargetNow, revealIfNeeded],
  );

  /**
   * 「更新快照」（属性栏）：按来源当前内容重建块内副本（一次可撤销事务）。
   * 来源不可达时保留旧快照并提示——快照永不因来源消失而丢失。
   */
  const refreshMaterialSnapshot = useCallback(
    async (blockId: string) => {
      const state = store.getState();
      const block = state.doc.boards
        .flatMap((b) => b.regions)
        .flatMap((r) => r.sections)
        .flatMap((s) => s.columns)
        .flatMap((c) => c.blocks)
        .find((bl) => bl.id === blockId);
      const ref =
        block && (block.type === "materialCard" || block.type === "text" || block.type === "image")
          ? block.sourceRef
          : undefined;
      if (!block || !ref) return;
      try {
        const supabase = createClient();
        const snapshot = await fetchSourceSnapshot(supabase, ref);
        if (!snapshot) {
          toast({ title: "来源已删除或无权限", description: "已保留画布中的快照内容。", variant: "destructive" });
          return;
        }
        if (block.type === "image") {
          // 图片来源快照：重新复制来源图（旧画布资产保留，由存储生命周期管理）
          if (!snapshot.imageSrc) {
            toast({ title: "来源正文中已没有图片，快照保留不变", variant: "destructive" });
            return;
          }
          const blob = await fetchImageBlob(snapshot.imageSrc);
          const file = new File([blob], snapshot.imageAlt || "source-image", { type: blob.type || "image/png" });
          const outcome = await uploadCanvasImage(file, userId || "anonymous");
          store.getState().apply("更新快照", (d) =>
            updateMaterialSnapshot(d, { blockId, asset: outcome.asset, alt: snapshot.imageAlt ?? undefined, sourceRef: snapshot.sourceRef }),
          );
          if (outcome.previewUrl) {
            store.getState().setAssetUrl(displayKey(blockId, outcome.asset), outcome.previewUrl);
          }
          store.getState().requestSmartRecompute();
          toast({ title: "快照已更新" });
          return;
        }
        store.getState().apply("更新快照", (d) =>
          updateMaterialSnapshot(d, {
            blockId,
            title: snapshot.title,
            text: snapshot.text,
            sourceRef: snapshot.sourceRef,
          }),
        );
        toast({ title: "快照已更新" });
      } catch (error) {
        toast({
          title: "更新快照失败",
          description: error instanceof Error ? error.message : "请重试",
          variant: "destructive",
        });
      }
    },
    [store, userId],
  );

  // ---------------- 渲染 ----------------

  const connectorsInteractive = !readOnly && !previewMode;
  const interactive = connectorsInteractive && !connectionsOnly;

  if (load.phase === "loading") {
    return (
      <div className="canvas-page">
        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载画布…
        </div>
      </div>
    );
  }

  if (load.phase !== "ready") {
    return (
      <div className="canvas-page">
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>{load.phase === "unauthorized" ? "请先登录后查看画布" : "找不到这个画布文档"}</p>
          <div className="flex gap-2">
            <Link href="/canvas" className="rounded-md border px-3 py-1.5 hover:bg-accent">
              返回列表
            </Link>
            {load.phase === "not-found" && (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const draft = await loadDraft(userId, documentId);
                  if (!draft) {
                    toast({ title: "本机没有可恢复的草稿", variant: "destructive" });
                    return;
                  }
                  const res = await duplicateCanvas(
                    { id: documentId, title: draft.title, content: draft.doc, revision: 0, created_at: "", updated_at: "" },
                    crypto.randomUUID(),
                  );
                  if (res.ok) router.push(`/canvas/${res.row.id}`);
                }}
              >
                把本机草稿另存为新画布
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const saveLabel = (() => {
    if (readOnly) return "只读预览";
    switch (saveStatus) {
      case "unknown":
        return "…";
      case "saving":
        return "保存中…";
      case "saved":
        return isMockBackend() ? "已保存（演示模式，仅本机）" : "已保存";
      case "local":
        return "仅保存在本机";
      case "error":
        return "保存失败，正在重试";
      case "conflict":
        return "存在冲突";
    }
  })();

  return (
    <div className="canvas-page" data-canvas-editor={documentId} data-find-open={findOpen || undefined}>
      {/* 顶栏 */}
      <header className="canvas-header">
        <Link href="/canvas" className="canvas-header-back" aria-label="返回画布列表" title="返回画布列表">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          className="canvas-title-input"
          value={title}
          placeholder="未命名画布"
          aria-label="画布名称"
          readOnly={readOnly || previewMode || connectionsOnly}
          onChange={(e) => store.getState().setTitle(e.target.value)}
        />
        <span
          className={`canvas-save-status is-${saveStatus}`}
          role="status"
          aria-live="polite"
          data-testid="canvas-save-status"
        >
          {saveLabel}
        </span>
        <Button ref={findButtonRef} type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground"
          aria-label="查找画布内容" title={`查找（${shortcutLabels.mod}F）`} onClick={openFind}>
          <Search className="h-4 w-4" />
        </Button>
        {readOnly && (
          <div className="canvas-header-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              aria-label="导出页面为 PNG"
              title={doc.boards.length > 0 ? "导出第一页为 PNG" : "画布为空，无法导出"}
              disabled={exportingBoard || doc.boards.length === 0}
              onClick={() => {
                const first = doc.boards[0];
                if (!first) {
                  toast({ title: "无法导出", description: "画布为空，没有可导出的页面", variant: "destructive" });
                  return;
                }
                startBoardExport(first.id);
              }}
            >
              <Download className="h-4 w-4" /> {exportingBoard ? "正在导出…" : "导出 PNG"}
            </Button>
          </div>
        )}
        {!readOnly && (
          <div className="canvas-header-actions">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              onClick={() => store.getState().undo()}
              disabled={!canUndo || previewMode}
              title={`撤销（${shortcutLabels.mod}Z）`}
              aria-label="撤销"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              onClick={() => store.getState().redo()}
              disabled={!canRedo || previewMode}
              title={`重做（${shortcutLabels.shift}${shortcutLabels.mod}Z）`}
              aria-label="重做"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={previewMode ? "secondary" : "ghost"}
              size="icon"
              className="shrink-0"
              onClick={() => store.getState().togglePreview()}
              title={previewMode ? "退出预览（Esc）" : "预览"}
              aria-label={previewMode ? "退出预览" : "预览"}
              aria-pressed={previewMode}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </div>
        )}
      </header>
      {findOpen && <CanvasFindBar query={findQuery} onQueryChange={(query) => {
        setFindQuery(query);
        setFindIndex(0);
      }} hits={findHits} index={activeFindIndex} onStep={stepFind} onClose={closeFind} focusNonce={findFocusNonce} />}

      {/* 状态横幅独立堆叠，避免恢复草稿与冲突提示相互覆盖。 */}
      <div className="canvas-feedback">
      {recovered && !readOnly && (
        <div className="canvas-banner" role="alert" data-testid="canvas-draft-banner">
          <span>已恢复本机未保存的草稿（可能比云端更新）。</span>
          <Button
            type="button"
            variant="outline" size="sm"
            onClick={async () => {
              await deleteDraft(userId, documentId);
              window.location.reload();
            }}
          >
            丢弃草稿，用云端版本
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => store.setState({ recoveredFromDraft: false })}
          >
            知道了，继续编辑
          </Button>
        </div>
      )}
      {saveStatus === "conflict" && !readOnly && (
        <div className="canvas-banner is-warning" role="alert" data-testid="canvas-conflict-banner">
          <span>云端已有更新（保存被拒绝，本地内容未丢失）。</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowRemoteDialog(true)}>
            查看云端版本
          </Button>
          <Button
            type="button"
            variant="outline" size="sm"
            onClick={async () => {
              const res = await duplicateCanvas(
                { id: documentId, title, content: doc, revision: 0, created_at: "", updated_at: "" },
                crypto.randomUUID(),
              );
              if (res.ok) router.push(`/canvas/${res.row.id}`);
              else toast({ title: "另存副本失败", variant: "destructive" });
            }}
          >
            将本地内容另存为副本
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => store.getState().setSaveStatus("local")}
          >
            暂不处理
          </Button>
        </div>
      )}

      </div>

      {/* 左侧添加面板（B2：分组文字面板，替代孤立图标工具条） */}
      {interactive &&
        (panelOpen ? (
          <div className="canvas-add-panel-wrap">
            <div className="canvas-add-panel-topbar">
              <Button
                type="button"
                variant={selection === null ? "secondary" : "ghost"}
                size="icon"
                className="shrink-0"
                aria-pressed={selection === null}
                title="选择（点击空白取消选择）"
                aria-label="选择工具"
                onClick={() => {
                  store.getState().select(null);
                  store.getState().stopEdit();
                }}
              >
                <MousePointerClick className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                title="折叠添加面板"
                aria-label="折叠添加面板"
                onClick={() => setPanelOpen(false)}
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
            <CanvasAddPanel
              store={store}
              hint={insertHint}
              narrow={narrow}
              onAddBlock={addBlock}
              onAddBlankBoard={addBlankBoard}
              onAddLandingBoard={addLandingBoard}
              onAddFreeText={addFreeText}
              onAddFreeSticky={addFreeSticky}
              onAddFreeShape={addFreeShape}
              onAddFreeImage={() => {
                // 自由放置入口同样固定「视口中心」语义：选择文件前先点按钮
                freeImageInputRef.current?.click();
              }}
              onApplyTemplate={applyTemplate}
              onExportBoard={startBoardExport}
              exporting={exportingBoard}
              material={
                <CanvasMaterialPanel
                  onInsertCard={insertMaterialCard}
                  onInsertExcerpt={insertMaterialExcerpt}
                  onInsertImage={(item) => void insertMaterialImage(item)}
                />
              }
              onReveal={revealTarget}
              onFit={fitSelection}
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="canvas-add-panel-expand text-muted-foreground"
            title="展开添加面板"
            aria-label="展开添加面板"
            onClick={() => setPanelOpen(true)}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        ))}
      {/* 统一图片文件选择器：「添加→图片」的目标在点击按钮瞬间已快照 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        multiple
        className="hidden"
        data-testid="canvas-image-input"
        onChange={(e) => {
          void onImageFilesPicked(e.target.files ? Array.from(e.target.files) : undefined);
          e.target.value = "";
        }}
      />
      {/* 自由放置「自由图片」文件选择器（显式次级入口） */}
      <input
        ref={freeImageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          void onFreeImageFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {/* 视口 */}
      <div ref={shellRef} className="canvas-shell" data-testid="canvas-shell">
        <CanvasViewportView
          store={store}
          measurer={measurer}
          doc={doc}
          scene={scene}
          userId={userId}
          interactive={interactive}
          connectorsInteractive={connectorsInteractive}
          spaceHeld={spaceHeld}
          selection={selection}
          editingBlockId={editingBlockId}
          assetUrls={assetUrls}
          sourceStatuses={sourceStatuses}
          onCreateBlank={addBlankBoard}
          onCreateLanding={addLandingBoard}
          onReplaceImage={onReplaceImage}
          onInsertFiles={onInsertFiles}
          onInsertEmbed={(url, explicit) => void runEmbedInsert(url, explicit)}
          onOpenContextMenu={openContextMenu}
          onExportBoard={startBoardExport}
          exportingBoard={exportingBoard}
        />
      </div>

      {/* 右侧属性栏 */}
      {interactive && (
        <CanvasPropertyBar
          store={store}
          measurer={measurer}
          onReplaceImage={onReplaceImage}
          sourceStatuses={sourceStatuses}
          onRefreshSource={(blockId) => void refreshMaterialSnapshot(blockId)}
          freeBoxes={scene.freeItems}
          scene={scene}
          onExportBoard={startBoardExport}
          exporting={exportingBoard}
        />
      )}

      {/* 缩放控件 */}
      <div className="canvas-zoom max-w-[calc(100%-24px)] flex-wrap justify-center" role="group" aria-label="缩放">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          title={`缩小（${shortcutLabels.mod}-）`}
          aria-label="缩小"
          onClick={() => changeCanvasZoom(store.getState().viewport.zoom / 1.2)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="canvas-zoom-value" aria-live="polite">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          title={`放大（${shortcutLabels.mod}=）`}
          aria-label="放大"
          onClick={() => changeCanvasZoom(store.getState().viewport.zoom * 1.2)}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label="重置为 100%" onClick={() => changeCanvasZoom(1)} title={`重置为 100%（${shortcutLabels.mod}0）`}>
          100%
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          title={`适合全部（${shortcutLabels.shift}1）`}
          aria-label="适合全部"
          onClick={fitAll}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size={narrow ? "icon" : "sm"} className="shrink-0"
          aria-label="适合选区" disabled={!selectionBounds}
          title={selectionBounds ? `适合选区（${shortcutLabels.shift}2）` : "请先选择页面、区块、模块或自由元素"}
          onClick={() => fitSelection()}>
          {narrow ? <MousePointerClick className="h-4 w-4" /> : "适合选区"}
        </Button>
        <CanvasMinimapToggle open={minimapOpen} onToggle={toggleMinimap} />
        {!narrow && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            title="键盘快捷键（?）"
            aria-label="键盘快捷键"
            onClick={() => setShowShortcuts(true)}
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        )}
      </div>
      <CanvasMinimap
        open={minimapOpen}
        scene={scene}
        names={Object.fromEntries(doc.boards.map((board) => [board.id, board.name]))}
        viewport={viewport}
        shellRef={shellRef}
        onViewport={(next) => store.getState().setViewport(next)}
      />
      <CanvasShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} labels={shortcutLabels} />
      {contextMenu && (
        <CanvasClipboardMenu
          request={contextMenu}
          entries={canvasContextMenuModel({
            scope: contextMenu.scope,
            selection,
            readOnly: readOnly || previewMode || connectionsOnly,
            hasClipboard: hasCanvasClipboard(),
            canDetach: canDetachSelection(doc, selection),
            freeLocked: hasLockedFreeItems(doc, freeIdsFromSelection(selection)),
            allFreeLocked: allFreeItemsLocked(doc, freeIdsFromSelection(selection)),
            labels: shortcutLabels,
          })}
          onSelect={onContextAction}
        />
      )}

      {/* 云端版本查看 */}
      <Dialog open={showRemoteDialog} onOpenChange={setShowRemoteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>云端版本</DialogTitle>
            <DialogDescription>
              云端 revision 为 {conflictRevision ?? "?"}，本地修改未上传。可选择替换本地内容。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">云端标题：{remoteRow?.title || "未命名画布"}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowRemoteDialog(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={async () => {
                const remote = await getCanvas(documentId);
                if (remote.ok) {
                  store.getState().init({
                    doc: remote.row.content,
                    title: remote.row.title,
                    revision: remote.row.revision,
                  });
                  autosaveRef.current?.resume(remote.row.revision);
                  store.getState().setSaveStatus("saved");
                }
                setShowRemoteDialog(false);
              }}
            >
              用云端版本替换本地内容
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {previewMode && (
        pagerBoard ? (
          <div className="canvas-preview-hint canvas-preview-pager" role="status" data-testid="canvas-preview-pager">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="上一页"
              title="上一页（← / PageUp / Shift+Space）"
              onClick={() => gotoPreviewPage(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="canvas-preview-pager-label" aria-live="polite">
              第 {doc.boards.indexOf(pagerBoard) + 1} / {doc.boards.length} 页 · {pagerBoard.name || "未命名页面"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="下一页"
              title="下一页（→ / PageDown / Space）"
              onClick={() => gotoPreviewPage(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="导出页面为 PNG"
              title={exportingBoard ? "正在导出…" : "导出当前页为 PNG"}
              disabled={exportingBoard}
              onClick={() => startBoardExport(pagerBoard.id)}
            >
              <Download className="h-4 w-4" />
            </Button>
            <span className="canvas-preview-pager-exit">Esc 退出</span>
          </div>
        ) : (
          <div className="canvas-preview-hint" role="status">
            预览模式 · 按 Esc 退出
          </div>
        )
      )}

      {/* PNG 导出离屏静态层：负偏移隐藏，导出完成后卸载（只读，不写文档） */}
      {exportJob !== null && (
        <div className="canvas-export-stage" ref={exportStageRef} aria-hidden="true">
          <CanvasBoardExportSurface
            doc={doc}
            scene={scene}
            store={store}
            assetUrls={assetUrls}
            sourceStatuses={sourceStatuses}
            boardId={exportJob}
          />
        </div>
      )}
    </div>
  );
}
