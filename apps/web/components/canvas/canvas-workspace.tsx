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
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  Loader2,
  Maximize2,
  Minus,
  MousePointerClick,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  Undo2,
} from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { hasOpenDialog, isTypingTarget } from "@/lib/hooks/use-hotkey";
import { createClient } from "@/lib/supabase/client";
import {
  CANVAS_SCHEMA_VERSION,
  createButtonBlock,
  createDividerBlock,
  createImageBlock,
  createMaterialCardBlock,
  createTextBlock,
  ensureCanvasDocV2,
  type CanvasBlock,
  type CanvasDoc,
} from "@/lib/canvas/model";
import {
  applyCanvasTemplate,
  createBoardSkeleton,
  createFreeImage,
  createFreeText,
  deleteBlock,
  deleteFreeItem,
  deleteRegion,
  insertBlockAtTarget,
  updateMaterialSnapshot,
  type CanvasTemplateKind,
} from "@/lib/canvas/commands";
import {
  describeInsertTarget,
  resolveInsertTarget,
  type ExplicitInsertPosition,
  type InsertTarget,
} from "@/lib/canvas/insert-target";
import { replaceImage, startImageInsert } from "@/lib/canvas/image-insert";
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
import { createCanvasStore } from "./canvas-store";
import { useCanvasScene, useFontsReady } from "./use-canvas-scene";
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
import { CanvasViewportView, clampZoom, zoomToFit } from "./canvas-viewport";
import { CanvasPropertyBar, recomputeSmartSection } from "./canvas-property-bar";
import { CanvasAddPanel, type AddBlockKind } from "./canvas-add-panel";
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
  /** 手机只读预览（规格 §1：第一版手机只读，编辑提示在桌面进行）。 */
  readOnly?: boolean;
}

interface LoadState {
  phase: "loading" | "ready" | "not-found" | "unauthorized";
}

/** 添加面板「非图片」五项的块工厂与事务标签（模块级常量，避免每次渲染重建）。 */
const ADD_BLOCK_FACTORY: Record<Exclude<AddBlockKind, "image">, () => CanvasBlock> = {
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

export function CanvasWorkspace({ documentId, readOnly = false }: CanvasWorkspaceProps) {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [remoteRow, setRemoteRow] = useState<CanvasRow | null>(null);
  const [showRemoteDialog, setShowRemoteDialog] = useState(false);
  const [userId, setUserId] = useState("");
  const narrow = useIsNarrowViewport();
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
            store.getState().markSaved(outcome.revision);
            void deleteDraft(uid, documentId);
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
        if (state.smartRecomputeSeq !== prev.smartRecomputeSeq) {
          for (const board of state.doc.boards) {
            for (const region of board.regions) {
              for (const section of region.sections) {
                if (section.widthMode === "smart") {
                  recomputeSmartSection(store, measurer, section.id);
                }
              }
            }
          }
        }
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

  // ---------------- 键盘 ----------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = store.getState();
      if (s.previewMode && e.key === "Escape") {
        s.togglePreview();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
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
      // 输入控件内（区块名编辑/属性栏输入框/对话框）不触发画布快捷键
      if (isTypingTarget(e)) return;
      if (s.editingBlockId || s.readOnly || s.previewMode) return;
      if (e.code === "Space") {
        setSpaceHeld(true);
        return;
      }
      if (e.key === "Escape") {
        // 弹层打开时 Esc 让位给弹层自身关闭（属性栏对话框等）
        if (hasOpenDialog()) return;
        s.select(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selection) {
        e.preventDefault();
        const sel = s.selection;
        if (sel.kind === "block") {
          s.apply("删除模块", (d) => deleteBlock(d, { blockId: sel.blockId }));
        } else if (sel.kind === "free") {
          s.apply("删除自由容器", (d) => deleteFreeItem(d, { itemId: sel.itemId }));
        } else if (sel.kind === "region") {
          s.apply("删除区块", (d) => deleteRegion(d, { boardId: sel.boardId, regionId: sel.regionId }));
        }
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
  }, [store]);

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

  const worldCenterNow = useCallback(() => {
    const rect = shellRef.current?.getBoundingClientRect();
    const vp = store.getState().viewport;
    return rect ? worldCenter(rect, vp) : { x: 0, y: 0 };
  }, [store]);

  /** 当前视口的世界矩形（新建页面自动落位用；拿不到容器尺寸时返回 null）。 */
  const worldViewportRectNow = useCallback(() => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return worldViewportRect(rect, store.getState().viewport);
  }, [store]);

  const addFreeText = useCallback(() => {
    const at = worldCenterNow();
    store.getState().apply("新建自由文本", (d) => createFreeText(d, at));
    const sel = store.getState().selection;
    if (sel?.kind === "free") store.getState().startEdit(sel.itemId);
  }, [store, worldCenterNow]);

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
        const s2 = store.getState();
        target = resolveInsertTarget(s2.doc, s2.selection, null, s2.lastActiveTarget);
      }
      return target;
    },
    [store, worldViewportRectNow],
  );

  // B1 新建入口：空白页面 / 宣传落地页骨架（落位走 A4 视口逻辑，首标题聚焦）
  const addBlankBoard = useCallback(() => {
    store.getState().apply("新建空白页面", (d) =>
      createBoardSkeleton(d, { viewportRect: worldViewportRectNow(), variant: "blank" }),
    );
  }, [store, worldViewportRectNow]);

  const addLandingBoard = useCallback(() => {
    store.getState().apply("新建宣传落地页骨架", (d) =>
      createBoardSkeleton(d, { viewportRect: worldViewportRectNow(), variant: "landing" }),
    );
  }, [store, worldViewportRectNow]);

  /** 选中并把对象平移到视口中央（不改缩放）。 */
  const revealTarget = useCallback(
    (target: { kind: "board"; boardId: string } | { kind: "region"; boardId: string; regionId: string }) => {
      const rect = shellRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sb = scene.boards.find((b) => b.boardId === target.boardId);
      if (!sb) return;
      let cy: number;
      if (target.kind === "region") {
        const sr = sb.regions.find((r) => r.regionId === target.regionId);
        if (!sr) return;
        cy = sr.y + sr.height / 2;
      } else {
        cy = sb.y + sb.height / 2;
      }
      const cx = sb.x + sb.width / 2;
      const vp = store.getState().viewport;
      store.getState().setViewport({
        x: rect.width / 2 - cx * vp.zoom,
        y: rect.height / 2 - cy * vp.zoom,
      });
    },
    [scene, store],
  );

  /** 目标在视口内则不跳动；平移远离后新建/插入会把目标带回可视区（B2）。 */
  const revealIfNeeded = useCallback(
    (target: { kind: "board"; boardId: string } | { kind: "region"; boardId: string; regionId: string }) => {
      const rect = shellRef.current?.getBoundingClientRect();
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
      const viewTop = -vp.y / vp.zoom;
      const viewBottom = viewTop + rect.height / vp.zoom;
      // 与视口有任意重叠即视为可见，不跳动
      if (top + height > viewTop && top < viewBottom) return;
      revealTarget(target);
    },
    [scene, store, revealTarget],
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

  /** 添加面板六项（B2）：统一解析目标后落块。 */
  const addBlock = useCallback(
    (kind: AddBlockKind) => {
      if (kind === "image") {
        // 打开文件选择器前固定目标快照（选择期间选区变化不影响在途目标）
        imageTargetSnapshotRef.current = resolveInsertTargetNow();
        imageInputRef.current?.click();
        return;
      }
      const target = resolveInsertTargetNow();
      if ("create" in target) return;
      const block = ADD_BLOCK_FACTORY[kind]();
      store.getState().apply(ADD_BLOCK_LABEL[kind], (d) => insertBlockAtTarget(d, target, block));
      // 平移远离后插入：把目标区块带回可视区（视口内则不跳动）
      revealIfNeeded({ kind: "region", boardId: target.boardId, regionId: target.regionId });
    },
    [store, resolveInsertTargetNow, revealIfNeeded],
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
      const target = resolveInsertTargetNow();
      if ("create" in target) return;
      const sourceRef = sourceRefFromLibraryItem(item);
      const block = createMaterialCardBlock({
        title: sourceRef.title,
        text: excerptSnapshot(sourceRef.excerpt ?? ""),
        sourceRef,
      });
      store.getState().apply("引用资料卡片", (d) => insertBlockAtTarget(d, target, block));
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

  const interactive = !readOnly && !previewMode;

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
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 hover:bg-accent"
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
              </button>
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
    <div className="canvas-page" data-canvas-editor={documentId}>
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
          readOnly={readOnly || previewMode}
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
        {!readOnly && (
          <div className="canvas-header-actions">
            <button
              type="button"
              className="canvas-tool-btn"
              onClick={() => store.getState().undo()}
              disabled={!canUndo || previewMode}
              title="撤销（⌘Z）"
              aria-label="撤销"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="canvas-tool-btn"
              onClick={() => store.getState().redo()}
              disabled={!canRedo || previewMode}
              title="重做（⇧⌘Z）"
              aria-label="重做"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="canvas-tool-btn"
              onClick={() => store.getState().togglePreview()}
              title={previewMode ? "退出预览（Esc）" : "预览"}
              aria-label={previewMode ? "退出预览" : "预览"}
              aria-pressed={previewMode}
            >
              <Eye className="h-4 w-4" />
            </button>
          </div>
        )}
      </header>

      {/* 状态横幅 */}
      {recovered && !readOnly && (
        <div className="canvas-banner" role="alert" data-testid="canvas-draft-banner">
          <span>已恢复本机未保存的草稿（可能比云端更新）。</span>
          <button
            type="button"
            className="canvas-banner-btn"
            onClick={async () => {
              await deleteDraft(userId, documentId);
              window.location.reload();
            }}
          >
            丢弃草稿，用云端版本
          </button>
          <button
            type="button"
            className="canvas-banner-btn is-primary"
            onClick={() => store.setState({ recoveredFromDraft: false })}
          >
            知道了，继续编辑
          </button>
        </div>
      )}
      {saveStatus === "conflict" && !readOnly && (
        <div className="canvas-banner is-warning" role="alert" data-testid="canvas-conflict-banner">
          <span>云端已有更新（保存被拒绝，本地内容未丢失）。</span>
          <button type="button" className="canvas-banner-btn" onClick={() => setShowRemoteDialog(true)}>
            查看云端版本
          </button>
          <button
            type="button"
            className="canvas-banner-btn"
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
          </button>
          <button
            type="button"
            className="canvas-banner-btn is-primary"
            onClick={() => store.getState().setSaveStatus("local")}
          >
            暂不处理
          </button>
        </div>
      )}

      {/* 左侧添加面板（B2：分组文字面板，替代孤立图标工具条） */}
      {interactive &&
        (panelOpen ? (
          <div className="canvas-add-panel-wrap">
            <div className="canvas-add-panel-topbar">
              <button
                type="button"
                className="canvas-tool-btn"
                title="选择（点击空白取消选择）"
                aria-label="选择工具"
                onClick={() => {
                  store.getState().select(null);
                  store.getState().stopEdit();
                }}
              >
                <MousePointerClick className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="canvas-tool-btn"
                title="折叠添加面板"
                aria-label="折叠添加面板"
                onClick={() => setPanelOpen(false)}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <CanvasAddPanel
              store={store}
              hint={insertHint}
              narrow={narrow}
              onAddBlock={addBlock}
              onAddBlankBoard={addBlankBoard}
              onAddLandingBoard={addLandingBoard}
              onAddFreeText={addFreeText}
              onAddFreeImage={() => {
                // 自由放置入口同样固定「视口中心」语义：选择文件前先点按钮
                freeImageInputRef.current?.click();
              }}
              onApplyTemplate={applyTemplate}
              material={
                <CanvasMaterialPanel
                  onInsertCard={insertMaterialCard}
                  onInsertExcerpt={insertMaterialExcerpt}
                  onInsertImage={(item) => void insertMaterialImage(item)}
                />
              }
              onReveal={revealTarget}
            />
          </div>
        ) : (
          <button
            type="button"
            className="canvas-tool-btn canvas-add-panel-expand"
            title="展开添加面板"
            aria-label="展开添加面板"
            onClick={() => setPanelOpen(true)}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
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
          doc={doc}
          scene={scene}
          userId={userId}
          interactive={interactive}
          spaceHeld={spaceHeld}
          selection={selection}
          editingBlockId={editingBlockId}
          assetUrls={assetUrls}
          sourceStatuses={sourceStatuses}
          onCreateBlank={addBlankBoard}
          onCreateLanding={addLandingBoard}
          onReplaceImage={onReplaceImage}
          onInsertFiles={onInsertFiles}
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
        />
      )}

      {/* 缩放控件 */}
      <div className="canvas-zoom" role="group" aria-label="缩放">
        <button
          type="button"
          className="canvas-tool-btn"
          title="缩小"
          aria-label="缩小"
          onClick={() => store.getState().setViewport({ zoom: clampZoom(viewport.zoom / 1.2) })}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="canvas-zoom-value" aria-live="polite">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          type="button"
          className="canvas-tool-btn"
          title="放大"
          aria-label="放大"
          onClick={() => store.getState().setViewport({ zoom: clampZoom(viewport.zoom * 1.2) })}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" className="canvas-zoom-fit" onClick={() => store.getState().setViewport({ zoom: 1 })} title="重置为 100%">
          100%
        </button>
        <button
          type="button"
          className="canvas-tool-btn"
          title="适合全部"
          aria-label="适合全部"
          onClick={() => {
            const rect = shellRef.current?.getBoundingClientRect();
            zoomToFit(
              scene,
              (vp) => store.getState().setViewport(vp),
              rect ? { width: rect.width, height: rect.height } : { width: 1200, height: 800 },
            );
          }}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

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
            <button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setShowRemoteDialog(false)}>
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
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
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {previewMode && (
        <div className="canvas-preview-hint" role="status">
          预览模式 · 按 Esc 退出
        </div>
      )}
    </div>
  );
}
