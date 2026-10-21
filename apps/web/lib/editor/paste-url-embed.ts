import type { Mark } from "@tiptap/pm/model";
import { TextSelection, type Selection } from "@tiptap/pm/state";
import { normalizeLinkUrl } from "./link-url";

/** A whole clipboard value, never a URL extracted from prose or multiple lines. */
export function isBareHttpUrl(text: string): string | null {
  const url = normalizeLinkUrl(text);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function shouldPasteUrlAsEmbed({ clipboardText, selection, isEditable, storedMarks }: {
  clipboardText: string;
  selection: Selection;
  isEditable: boolean;
  storedMarks?: readonly Mark[] | null;
}): boolean {
  if (!isEditable || !isBareHttpUrl(clipboardText) || !(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  const paragraph = $from.parent;
  if (paragraph.type.name !== "paragraph" || paragraph.textContent.trim()) return false;
  // Atom nodes (e.g. an empty inline formula) are content too, even with no textContent.
  for (let index = 0; index < paragraph.childCount; index++) {
    const child = paragraph.child(index);
    if (!child.isText || child.marks.some((mark) => mark.type.spec.code)) return false;
  }
  if ((storedMarks ?? $from.marks()).some((mark) => mark.type.spec.code)) return false;
  for (let depth = 1; depth <= $from.depth; depth++) {
    const node = $from.node(depth);
    if (node.type.spec.code || ["inlineMath", "mathBlock"].includes(node.type.name)) return false;
  }
  // Some containers require their first child to remain a paragraph (e.g. listItem).
  const parent = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  const embed = paragraph.type.schema.nodes.embed;
  return Boolean(embed && parent.canReplaceWith(index, index + 1, embed));
}
