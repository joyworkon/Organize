import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { UndoManager } from "yjs";
import { toast } from "@/hooks/use-toast";

const REFERENCE_PREFIX = "organize-synced-block:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Yjs uses its own undo capture window; closeHistory alone only isolates local History. */
function dispatchAction(editor: Editor, tr: Transaction): void {
  const managers = editor.state.plugins.flatMap((plugin) => {
    const state: unknown = plugin.getState(editor.state);
    const manager = state && typeof state === "object" && "undoManager" in state ? state.undoManager : null;
    return manager instanceof UndoManager ? [manager] : [];
  });
  managers.forEach((manager) => manager.stopCapturing());
  editor.view.dispatch(tr);
  managers.forEach((manager) => manager.stopCapturing());
}

/** A versioned, portable text reference. Content is always fetched through existing permissions. */
export function buildSyncedReference(syncedId: string): string | null {
  return UUID.test(syncedId) ? `${REFERENCE_PREFIX}${syncedId}` : null;
}

export function parseSyncedReference(text: string): string | null {
  const value = text.trim();
  if (!value.startsWith(REFERENCE_PREFIX)) return null;
  const syncedId = value.slice(REFERENCE_PREFIX.length);
  return UUID.test(syncedId) ? syncedId : null;
}

export async function copySyncedReference(syncedId: string): Promise<boolean> {
  const text = buildSyncedReference(syncedId);
  try {
    if (!text) throw new Error("invalid reference");
    await navigator.clipboard.writeText(text);
    toast({ title: "已复制同步引用，粘贴到笔记可插入同一同步区块" });
    return true;
  } catch {
    toast({ title: "复制同步引用失败", description: "请检查剪贴板权限后重试。", variant: "destructive" });
    return false;
  }
}

/** Unwrap this instance only. Keep its exact children and isolate the undo step. */
export function unlinkSyncedBlock(editor: Editor, pos: number, syncedId: string): boolean {
  if (editor.isDestroyed || !editor.isEditable || pos < 0 || pos >= editor.state.doc.content.size) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== "syncedBlock" || node.attrs.syncedId !== syncedId) return false;
  const $pos = editor.state.doc.resolve(pos);
  if (!$pos.parent.canReplace($pos.index(), $pos.index() + 1, node.content)) return false;
  const tr = closeHistory(editor.state.tr).replaceWith(pos, pos + node.nodeSize, node.content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos))).scrollIntoView();
  dispatchAction(editor, tr);
  editor.view.focus();
  return true;
}

/** Match URL-paste exclusions, checking whether this parent accepts a syncedBlock. */
export function canPasteSyncedReference(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const { selection, storedMarks } = editor.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  const paragraph = $from.parent;
  if (paragraph.type.name !== "paragraph" || paragraph.textContent.trim()) return false;
  for (let index = 0; index < paragraph.childCount; index++) {
    const child = paragraph.child(index);
    if (!child.isText || child.marks.some((mark) => mark.type.spec.code)) return false;
  }
  if ((storedMarks ?? $from.marks()).some((mark) => mark.type.spec.code)) return false;
  for (let depth = 1; depth <= $from.depth; depth++) {
    const node = $from.node(depth);
    if (node.type.spec.code || ["inlineMath", "mathBlock", "syncedBlock"].includes(node.type.name)) return false;
  }
  const parent = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  const type = editor.schema.nodes.syncedBlock;
  return Boolean(type && parent.canReplaceWith(index, index + 1, type));
}

/** No POST: mount hydrates the same source through the usual GET path. */
export function pasteSyncedReference(editor: Editor, text: string): boolean {
  const syncedId = parseSyncedReference(text);
  if (!syncedId || !canPasteSyncedReference(editor)) return false;
  const pos = editor.state.selection.$from.before();
  const paragraph = editor.state.doc.nodeAt(pos)!;
  const block = editor.schema.nodeFromJSON({
    type: "syncedBlock",
    attrs: { syncedId, hydrated: true },
    content: [{ type: "paragraph" }],
  });
  const tr = closeHistory(editor.state.tr).replaceWith(pos, pos + paragraph.nodeSize, block);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2))).scrollIntoView();
  dispatchAction(editor, tr);
  return true;
}
