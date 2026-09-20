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
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Maximize2,
  Minus,
  MousePointerClick,
  Plus,
  Redo2,
  Type as TypeIcon,
  Undo2,
} from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { CANVAS_SCHEMA_VERSION, type CanvasDoc } from "@/lib/canvas/model";
import {
  createBoardAutoPlace,
  createFreeImage,
  createFreeText,
  deleteBlock,
  deleteFreeItem,
} from "@/lib/canvas/commands";
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
import { CanvasViewportView, clampZoom, zoomToFit } from "./canvas-viewport";
import { CanvasPropertyBar, recomputeSmartSection } from "./canvas-property-bar";
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
    for (const section of board.sections) {
      for (const column of section.columns) {
        for (const block of column.blocks) {
          if (block.type === "image") clean(block.asset);
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
  const freeImageInputRef = useRef<HTMLInputElement | null>(null);
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
  const canUndo = store.getState().history.canUndo;
  const canRedo = store.getState().history.canRedo;
  void localSeq;

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
      let useDoc = remote.row.content;
      let useTitle = remote.row.title;
      let recovered = false;
      if (draft && draft.localSeq > 0 && validateCanvasContent(draft.doc).errors.length === 0) {
        // 本机草稿领先远端：恢复草稿内容（A11）
        useDoc = draft.doc;
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
        for (const section of board.sections)
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
            for (const section of board.sections) {
              if (section.widthMode === "smart") {
                recomputeSmartSection(store, measurer, section.id);
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
        for (const section of board.sections) {
          if (section.widthMode === "smart") {
            recomputeSmartSection(store, measurer, section.id);
          }
        }
      }
    }, 50);
    return () => clearTimeout(t);
  }, [load.phase, fontsReady, store, measurer]);

  // ---------------- 键盘 ----------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = store.getState();
      if (s.previewMode && e.key === "Escape") {
        s.togglePreview();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        // 统一撤销/重做：同时阻止 textarea 原生 undo 与文档撤销打架
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (s.editingBlockId || s.readOnly || s.previewMode) return;
      if (e.code === "Space") {
        setSpaceHeld(true);
        return;
      }
      if (e.key === "Escape") {
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

  const worldCenter = useCallback(() => {
    const rect = shellRef.current?.getBoundingClientRect();
    const vp = store.getState().viewport;
    return {
      x: rect ? (rect.width / 2 - vp.x) / vp.zoom : 0,
      y: rect ? (rect.height / 2 - vp.y) / vp.zoom : 0,
    };
  }, [store]);

  const addFreeText = useCallback(() => {
    const at = worldCenter();
    store.getState().apply("新建自由文本", (d) => createFreeText(d, at));
    const sel = store.getState().selection;
    if (sel?.kind === "free") store.getState().startEdit(sel.itemId);
  }, [store, worldCenter]);

  const onFreeImageFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const at = worldCenter();
        const outcome = await uploadCanvasImage(file, userId || "anonymous");
        store.getState().apply("新建自由图片", (d) => createFreeImage(d, { ...at, asset: outcome.asset }));
        const sel = store.getState().selection;
        if (sel?.kind === "free" && outcome.previewUrl) {
          store.getState().setAssetUrl(displayKey(sel.itemId, outcome.asset), outcome.previewUrl);
        }
      } catch (error) {
        toast({
          title: "图片上传失败",
          description: error instanceof Error ? error.message : "请重试",
          variant: "destructive",
        });
      }
    },
    [store, userId, worldCenter],
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

      {/* 左侧工具条 */}
      {interactive && (
        <div className="canvas-toolbar" role="toolbar" aria-label="画布工具">
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
            title="新建版面"
            aria-label="新建版面"
            onClick={() => store.getState().apply("新建版面", (d) => createBoardAutoPlace(d))}
          >
            <LayoutTemplate className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="canvas-tool-btn"
            title="自由文本（Enter 只换行）"
            aria-label="新建自由文本"
            onClick={addFreeText}
          >
            <TypeIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="canvas-tool-btn"
            title="自由图片"
            aria-label="新建自由图片"
            onClick={() => freeImageInputRef.current?.click()}
          >
            <ImageIcon className="h-4 w-4" />
          </button>
        </div>
      )}
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
        />
      </div>

      {/* 右侧属性栏 */}
      {interactive && <CanvasPropertyBar store={store} measurer={measurer} />}

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
