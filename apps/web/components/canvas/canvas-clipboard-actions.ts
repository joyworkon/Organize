import { toast } from "@/hooks/use-toast";
import {
  confirmCanvasClipboardWrite,
  copyCanvasSelection,
  noteCanvasClipboardPasted,
  notePlainTextPasted,
  pasteCanvasClipboard,
  pastePlainTextAsFreeItem,
  plainTextPasteIndex,
  readCanvasClipboard,
  rememberCanvasClipboard,
  shouldPasteInternalClipboard,
  type CanvasClipboardPayload,
} from "@/lib/canvas/clipboard";
import { deleteConnector } from "@/lib/canvas/connectors";
import { deleteBlock, deleteBoard, deleteFreeItem, deleteRegion } from "@/lib/canvas/commands";
import { matchSingleUrlText } from "@/lib/canvas/embed-insert";
import type { ExplicitInsertPosition } from "@/lib/canvas/insert-target";
import type { CanvasStore } from "./canvas-store";

export interface CanvasPasteRequest {
  pointer: { x: number; y: number } | null;
  explicit: ExplicitInsertPosition | null;
  /** 空白处「粘贴到此处」不沿用当前模块/区块选区。 */
  atPointer?: boolean;
  /** 来自 paste 事件的纯文本。菜单触发时先读系统剪贴板再传入。 */
  systemText?: string;
  /**
   * 单行 http(s) URL 的接管：画布内结构化剪贴板优先；其后若整段文本是一个 URL，
   * 交给工作区插入链接 / 视频块（不再落成自由文本）。缺省无接管 → 原纯文本路径。
   */
  onInsertEmbed?: (url: string, explicit: ExplicitInsertPosition | null) => void;
}

export function commitCanvasCopy(store: CanvasStore): boolean {
  const state = store.getState();
  const payload = copyCanvasSelection(state.doc, state.selection);
  if (!payload) return false;
  rememberCanvasClipboard(payload);
  const writtenGeneration = readCanvasClipboard()?.generation;
  const write = typeof navigator !== "undefined" ? navigator.clipboard?.writeText?.bind(navigator.clipboard) : undefined;
  if (write) {
    try {
      void Promise.resolve(write(payload.plainText)).then(
        () => confirmCanvasClipboardWrite(writtenGeneration),
        () => {},
      );
    } catch {
      // 系统剪贴板失败不影响画布内复制。
    }
  }
  return true;
}

export function commitCanvasCut(store: CanvasStore): void {
  const state = store.getState();
  if (state.readOnly || state.previewMode) return;
  if (!commitCanvasCopy(store)) return;
  applyDeleteCanvasSelection(store, "剪切");
}

export function commitCanvasPaste(store: CanvasStore, request: CanvasPasteRequest): void {
  const state = store.getState();
  if (state.readOnly || state.previewMode) return;
  const systemText = request.systemText ?? "";
  if (shouldPasteInternalClipboard(systemText)) {
    const memory = readCanvasClipboard();
    if (!memory) return;
    const result = pasteCanvasClipboard(state.doc, memory.payload, {
      pointer: request.pointer,
      pasteIndex: memory.pasteCount,
      selection: request.atPointer ? null : state.selection,
      explicit: request.explicit,
    });
    if (result.rejected) {
      toast({ title: "无法粘贴", description: result.rejected, variant: "destructive" });
      return;
    }
    if (result.doc === state.doc) return;
    state.apply(pasteLabel(memory.payload), () => result);
    if (result.blockIds && result.blockIds.length > 1) {
      store.getState().clearFocus();
      store.getState().select({ kind: "blocks", blockIds: result.blockIds });
    }
    noteCanvasClipboardPasted();
    return;
  }
  if (!systemText.trim()) return;
  // 整段文本是单行 URL → 链接 / 视频嵌入块（结构化剪贴板已在上文优先）
  const pastedUrl = matchSingleUrlText(systemText);
  if (pastedUrl) {
    if (request.onInsertEmbed) {
      request.onInsertEmbed(pastedUrl, request.explicit);
      return;
    }
    // 无接管方（理论上不会出现）：回退原纯文本路径
  }
  const result = pastePlainTextAsFreeItem(state.doc, systemText, request.pointer, plainTextPasteIndex(systemText));
  if (result.rejected) {
    toast({ title: "无法粘贴", description: result.rejected, variant: "destructive" });
    return;
  }
  if (result.doc === state.doc) return;
  state.apply("粘贴文本", () => result);
  notePlainTextPasted(systemText);
}

export async function commitCanvasPasteFromClipboard(
  store: CanvasStore,
  request: Omit<CanvasPasteRequest, "systemText">,
): Promise<void> {
  let systemText = "";
  try {
    systemText = (await navigator.clipboard?.readText()) ?? "";
  } catch {
    systemText = "";
  }
  commitCanvasPaste(store, { ...request, systemText });
}

/** 键盘 Delete 与右键「删除」共用。剪切传入「剪切」，撤销一次恢复整次删除。 */
export function applyDeleteCanvasSelection(store: CanvasStore, verb: "删除" | "剪切" = "删除"): void {
  const state = store.getState();
  if (state.readOnly || state.previewMode) return;
  const sel = state.selection;
  if (!sel) return;
  if (sel.kind === "connector") {
    state.apply(`${verb}连接线`, (doc) => deleteConnector(doc, sel.connectorId));
    return;
  }
  if (sel.kind === "blocks") {
    state.apply(`${verb}多个模块`, (doc) => ({
      doc: sel.blockIds.reduce((next, blockId) => deleteBlock(next, { blockId }).doc, doc),
    }));
    store.getState().select(null);
    return;
  }
  if (sel.kind === "block") {
    state.apply(`${verb}模块`, (doc) => deleteBlock(doc, { blockId: sel.blockId }));
    return;
  }
  if (sel.kind === "free" || sel.kind === "frees") {
    const ids = sel.kind === "free" ? [sel.itemId] : [...new Set(sel.itemIds)];
    const label = verb === "剪切"
      ? (ids.length > 1 ? "剪切多个自由元素" : "剪切自由元素")
      : (ids.length > 1 ? "删除多个自由容器" : "删除自由容器");
    state.apply(label, (doc) => {
      let next = doc;
      for (const itemId of ids) {
        if (!next.freeItems.some((item) => item.id === itemId)) continue;
        next = deleteFreeItem(next, { itemId }).doc;
      }
      return { doc: next };
    });
    return;
  }
  if (sel.kind === "board") {
    state.apply(`${verb}页面`, (doc) => deleteBoard(doc, { boardId: sel.boardId }));
    return;
  }
  state.apply(`${verb}区块`, (doc) => deleteRegion(doc, { boardId: sel.boardId, regionId: sel.regionId }));
}

function pasteLabel(payload: CanvasClipboardPayload): string {
  if (payload.kind === "region") return "粘贴区块";
  if (payload.kind === "free") return payload.items.length > 1 ? "粘贴多个自由元素" : "粘贴自由元素";
  return payload.blocks.length > 1 ? "粘贴多个模块" : "粘贴模块";
}
