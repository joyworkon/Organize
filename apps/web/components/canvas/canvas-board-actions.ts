import { toast } from "@/hooks/use-toast";
import { showConfirm } from "@/components/ui/prompt-dialog";
import { deleteBoard, duplicateBoard } from "@/lib/canvas/commands";
import type { CanvasStore } from "./canvas-store";

/** 所有页面复制入口共用错误反馈及单事务提交，返回新页面供大纲定位。 */
export function commitBoardDuplicate(store: CanvasStore, boardId: string): string | null {
  const state = store.getState();
  if (state.readOnly || state.previewMode) return null;
  const result = duplicateBoard(state.doc, { boardId });
  if (result.rejected) {
    toast({ title: "无法复制页面", description: result.rejected, variant: "destructive" });
    return null;
  }
  if (result.doc === state.doc) return null;
  state.apply("复制页面", () => result);
  return result.focus?.kind === "board" ? result.focus.boardId : null;
}

export async function confirmBoardDeletion(store: CanvasStore, boardId: string): Promise<void> {
  const state = store.getState();
  if (state.readOnly || state.previewMode) return;
  const board = state.doc.boards.find((b) => b.id === boardId);
  if (!board) return;
  const ok = await showConfirm({
    title: `删除页面「${board.name || "未命名页面"}」？`,
    description: "该页的全部区块和模块也会一并删除。可通过撤销恢复。",
    confirmText: "删除页面",
    destructive: true,
  });
  if (ok) store.getState().apply("删除页面", (doc) => deleteBoard(doc, { boardId }));
}
