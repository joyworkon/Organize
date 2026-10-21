import type { Editor } from "@tiptap/core";

/** Measure the caret line with the textarea's own wrapping and typography. */
export function isTitleLastLine(element: HTMLTextAreaElement): boolean {
  if (element.selectionStart !== element.selectionEnd) return false;
  if (element.selectionEnd === element.value.length) return true;
  const style = getComputedStyle(element);
  const mirror = document.createElement("div");
  for (const property of ["font", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "padding", "border", "box-sizing", "word-break", "overflow-wrap"]) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", width: `${element.getBoundingClientRect().width}px` });
  mirror.textContent = element.value.slice(0, element.selectionEnd);
  const caret = document.createElement("span");
  caret.textContent = element.value.slice(element.selectionEnd) || ".";
  mirror.append(caret);
  document.body.append(mirror);
  const rects = caret.getClientRects();
  const last = rects[rects.length - 1];
  const first = rects[0];
  const result = !!first && !!last && Math.abs(first.top - last.top) < 1;
  mirror.remove();
  return result;
}

export function focusTitleFromBody(event: { key: string; isComposing: boolean; keyCode: number; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; preventDefault: () => void; stopPropagation: () => void }, editor: Editor, onFocusTitle: () => void): boolean {
  if (event.isComposing || event.keyCode === 229 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || !["ArrowUp", "Backspace"].includes(event.key) || !editor.isEditable || editor.isDestroyed) return false;
  const { selection, doc } = editor.state;
  // Native arrow movement can precede ProseMirror's selectionchange update.
  // Read the live DOM caret so rapid consecutive keys cannot use a stale position.
  const domSelection = editor.view.dom.ownerDocument.getSelection();
  let from = selection.$from;
  let empty = selection.empty;
  if (domSelection?.anchorNode && editor.view.dom.contains(domSelection.anchorNode)) {
    empty = domSelection.isCollapsed;
    from = doc.resolve(editor.view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset));
  }
  // Only the first top-level textblock start: preserve list/table/nested block commands.
  if (!empty || from.depth !== 1 || !from.parent.isTextblock || from.pos !== 1) return false;
  event.preventDefault();
  event.stopPropagation();
  onFocusTitle();
  return true;
}
