import { Extension, type Editor, type Range } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
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

/** One matcher keeps @ and [[ mutually exclusive, including @ inside a wiki query. */
function findPageLinkMatch($position: ResolvedPos) {
  const before = $position.parent.textBetween(0, $position.parentOffset, "\n", "\ufffc");
  const wiki = /\[\[([^\[\]\n\ufffc]*)$/.exec(before);
  // Unlike [[, @ must start a paragraph or follow whitespace (including CJK spaces).
  // Prefix is excluded from the range; brackets/inline atoms end an @ query.
  const at = wiki ? null : /(?:^|\s)(@([^@\[\]\n\ufffc]*))$/.exec(before);
  const text = wiki?.[0] ?? at?.[1];
  if (!text) return null;
  return { range: { from: $position.pos - text.length, to: $position.pos }, query: wiki?.[1] ?? at![2], text };
}

/** Plain text + the existing link mark: no new document node or save protocol. */
export function insertPageLink(editor: Editor, range: Range, note: { id: string; title: string }) {
  if (!editor.isEditable || editor.isDestroyed) return false;
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.to > editor.state.doc.content.size || range.from >= range.to) return false;
  if (editor.state.selection.from !== range.to || !editor.state.selection.empty) return false;
  const match = findPageLinkMatch(editor.state.doc.resolve(range.to));
  if (!match || match.range.from !== range.from) return false;
  return editor.chain().focus().command(({ tr }) => {
    // Keep choosing a page separate from typing its query in the undo history.
    closeHistory(tr);
    return true;
  }).insertContentAt(range, {
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
      // Custom matcher enforces @ prefixes; [[ retains its unrestricted mid-text entry.
      findSuggestionMatch: ({ $position }) => findPageLinkMatch($position),
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
