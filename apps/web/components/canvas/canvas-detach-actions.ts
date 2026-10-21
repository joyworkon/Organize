import { toast } from "@/hooks/use-toast";
import { canDetachBlockToFree, detachBlocksToFree } from "@/lib/canvas/commands";
import type { Scene } from "@/lib/canvas/layout";
import { findBlockLocation, type CanvasDoc } from "@/lib/canvas/model";
import { CANVAS_LIMITS } from "@/lib/canvas/validation";
import type { CanvasSelection, CanvasStore } from "./canvas-store";

function selectedBlockIds(selection: CanvasSelection): string[] {
  return selection?.kind === "block" ? [selection.blockId]
    : selection?.kind === "blocks" ? [...new Set(selection.blockIds)] : [];
}

export function canDetachSelection(doc: CanvasDoc, selection: CanvasSelection): boolean {
  const ids = selectedBlockIds(selection);
  return ids.length > 0 && ids.every((id) => {
    const loc = findBlockLocation(doc, id);
    return loc && canDetachBlockToFree(loc.block);
  });
}

/** 属性栏与右键共用同一个事务和反馈；拒绝不写历史或保存序号。 */
export function commitDetachSelection(store: CanvasStore, scene?: Scene): boolean {
  const state = store.getState();
  if (state.readOnly || state.previewMode) return false;
  if (!canDetachSelection(state.doc, state.selection)) {
    toast({ title: "仅正文、标题和图片模块可转为自由定位", variant: "destructive" });
    return false;
  }
  const blockIds = selectedBlockIds(state.selection);
  const result = detachBlocksToFree(state.doc, { blockIds, scene });
  if (!result) {
    toast({ title: `自由元素最多 ${CANVAS_LIMITS.maxFreeItems} 个，请先删除部分元素再试`, variant: "destructive" });
    return false;
  }
  state.apply("转为自由定位", () => result);
  toast({ title: "已转为自由定位，可拖动调整", description: "可用属性栏「移入区块…」归位。" });
  return true;
}
