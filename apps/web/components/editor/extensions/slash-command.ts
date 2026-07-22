import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";

export const SlashCommand = Extension.create({
  name: "organizeSlashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: true,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name === "paragraph" && $from.parent.textContent.length <= 1;
        },
        items: () => [],
        command: () => {},
        render: () => ({
          onStart: ({ editor, range, clientRect }) => {
            const $from = editor.state.doc.resolve(range.from);
            const pos = $from.depth > 0 ? $from.before(1) : 0;
            const rect = clientRect?.();
            editor.view.dom.dispatchEvent(
              new CustomEvent("organize-editor-action", {
                bubbles: true,
                detail: {
                  type: "slash-menu",
                  pos,
                  point: rect ? { left: rect.left, top: rect.bottom + 8 } : { left: 20, top: 80 },
                },
              })
            );
          },
        }),
      }),
    ];
  },
});
