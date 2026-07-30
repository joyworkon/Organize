import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";

export const SlashCommand = Extension.create({
  name: "organizeSlashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          // 允许在任何段落中触发，但限制为段落开头附近（最多跟一个字符），
          // 避免普通文本中出现 "/" 时频繁弹出菜单。
          const node = $from.parent;
          if (node.type.name !== "paragraph") return false;
          const textBefore = node.textContent.slice(0, range.from - $from.start());
          return textBefore.length <= 1;
        },
        items: () => [],
        command: () => {},
        render: () => ({
          onStart: ({ editor, range, clientRect }) => {
            const $from = editor.state.doc.resolve(range.from);
            // 找到最近的块级节点位置
            let blockPos = range.from;
            let blockDepth = $from.depth;
            while (blockDepth > 0) {
              const node = $from.node(blockDepth);
              if (node.type.isBlock) {
                blockPos = $from.before(blockDepth);
                break;
              }
              blockDepth--;
            }
            const rect = clientRect?.();
            editor.view.dom.dispatchEvent(
              new CustomEvent("organize-editor-action", {
                bubbles: true,
                detail: {
                  type: "slash-menu",
                  pos: blockPos,
                  range,
                  nested: $from.depth > 1,
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
