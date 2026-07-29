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
          // 只允许顶层段落触发：嵌套场景（列表项 / callout / 引用内的段落）里
          // 菜单拿到的是顶层块位置，选命令会替换整个顶层容器导致数据丢失
          return (
            $from.depth === 1 &&
            $from.parent.type.name === "paragraph" &&
            $from.parent.textContent.length <= 1
          );
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
                  range,
                  point: rect ? { left: rect.left, top: rect.bottom + 8, anchorTop: rect.top } : { left: 20, top: 80 },
                },
              })
            );
          },
        }),
      }),
    ];
  },
});
