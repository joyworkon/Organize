import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type { EditorMenuPoint } from "../types";

export const pageLinkPluginKey = new PluginKey("organizePageLink");
export type PageLinkEvent =
  | { type: "start" | "update"; range: Range; query: string; point: EditorMenuPoint }
  | { type: "exit" }
  | { type: "key"; key: string };

function dispatch(editor: Editor, detail: PageLinkEvent, cancelable = false) {
  return editor.view.dom.dispatchEvent(new CustomEvent("organize-page-link", { bubbles: true, cancelable, detail }));
}

/** Plain text + the existing link mark: no new document node or save protocol. */
export function insertPageLink(editor: Editor, range: Range, note: { id: string; title: string }) {
  if (!editor.isEditable || editor.isDestroyed) return false;
  const text = editor.state.doc.textBetween(range.from, range.to);
  if (!text.startsWith("[[") || editor.state.selection.from !== range.to || !editor.state.selection.empty) return false;
  return editor.chain().focus().insertContentAt(range, {
    type: "text", text: note.title || "无标题笔记",
    marks: [{ type: "link", attrs: { href: `/notes/${encodeURIComponent(note.id)}` } }],
  }).unsetMark("link", { extendEmptyMarkRange: false }).run();
}

export const PageLinkTrigger = Extension.create({
  name: "organizePageLinkTrigger",
  addProseMirrorPlugins() {
    const notify = (type: "start" | "update", editor: Editor, range: Range, query: string) => {
      const current = pageLinkPluginKey.getState(editor.state);
      if (!current?.active || current.query !== query || current.range.from !== range.from || current.range.to !== range.to || !editor.isEditable) return;
      const rect = editor.view.coordsAtPos(range.to);
      dispatch(editor, { type, range, query, point: { left: rect.left, top: rect.bottom + 8, anchorTop: rect.top } });
    };
    return [Suggestion({
      editor: this.editor,
      pluginKey: pageLinkPluginKey,
      char: "[[",
      allowedPrefixes: null,
      allowSpaces: true,
      // Match across text marks, only up to the caret; a closing bracket ends the query.
      findSuggestionMatch: ({ $position }) => {
        const before = $position.parent.textBetween(0, $position.parentOffset, "\n", "\ufffc");
        const match = /\[\[([^\[\]\n\ufffc]*)$/.exec(before);
        if (!match) return null;
        return { range: { from: $position.pos - match[0].length, to: $position.pos }, query: match[1], text: match[0] };
      },
      allow: ({ state, range }) => {
        if (!this.editor.isEditable) return false;
        const parent = state.doc.resolve(range.from).parent;
        if (!["paragraph", "heading"].includes(parent.type.name)) return false;
        let code = (state.storedMarks ?? state.selection.$from.marks()).some((mark) => mark.type.name === "code");
        state.doc.nodesBetween(range.from, range.to, (node) => {
          if (node.marks.some((mark) => mark.type.name === "code")) code = true;
        });
        return !code;
      },
      items: () => [],
      command: () => {},
      render: () => ({
        onStart: ({ editor, range, query }) => notify("start", editor, range, query),
        onUpdate: ({ editor, range, query }) => notify("update", editor, range, query),
        onExit: ({ editor }) => { dispatch(editor, { type: "exit" }); },
        onKeyDown: ({ event }) => {
          if (event.isComposing || event.keyCode === 229) return false;
          if (!["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) return false;
          return !dispatch(this.editor, { type: "key", key: event.key }, true);
        },
      }),
    })];
  },
});
