import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { stripBlockIds } from "./block-utils";
import { setMultiSelectedBlocks } from "./extensions/block-multi-select";

export function matchNoteEditorShortcut(event: KeyboardEvent): "duplicate" | "copy-link" | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey) return null;
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toLowerCase();
  // Option+L produces a different character on macOS; use the physical key too.
  if (event.altKey && (key === "l" || event.code === "KeyL")) return "copy-link";
  if (!event.altKey && key === "d") return "duplicate";
  return null;
}

/** Menu targets can be nested; keyboard callers restrict the target to a top-level block. */
export function duplicateBlockAtPosition(editor: Editor, pos: number): boolean {
  return duplicateBlocksAtPositions(editor, [pos], false);
}

/** Insert copies after their originals in one transaction, retaining the existing UniqueID policy. */
export function duplicateBlocksAtPositions(editor: Editor, positions: number[], selectCopies = true): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const blocks = [...new Set(positions)].flatMap((pos) => {
    if (pos < 0 || pos >= editor.state.doc.content.size) return [];
    const node = editor.state.doc.nodeAt(pos);
    return node?.isBlock ? [{ end: pos + node.nodeSize, json: stripBlockIds(node.toJSON()) }] : [];
  }).sort((a, b) => b.end - a.end);
  if (!blocks.length) return false;

  let copies: number[] = [];
  const chain = editor.chain();
  for (const block of blocks) chain.insertContentAt(block.end, block.json, { updateSelection: false });
  const applied = chain.command(({ tr }) => {
    copies = blocks.map((block) => tr.mapping.map(block.end, -1)).sort((a, b) => a - b);
    tr.setSelection(TextSelection.near(tr.doc.resolve(copies[copies.length - 1] + 1))).scrollIntoView();
    return true;
  }).run();
  if (!applied) return false;
  editor.view.focus();
  // UniqueID's appended transaction clears multi-selection on docChanged. Restore it afterwards;
  // this metadata-only transaction adds no undo step and does not change the document.
  if (selectCopies) setMultiSelectedBlocks(editor, copies);
  return true;
}

export async function copyBlockDeepLink(noteId: string | undefined, blockId: string | undefined): Promise<boolean> {
  if (!noteId || !blockId) return false;
  const href = `${window.location.origin}/notes/${noteId}#block-${blockId}`;
  try {
    await navigator.clipboard.writeText(href);
  } catch {
    void showPrompt({ title: "复制链接", defaultValue: href });
  }
  return true;
}
