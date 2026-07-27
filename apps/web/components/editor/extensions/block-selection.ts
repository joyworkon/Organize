import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const transformedBlockKey = new PluginKey<string | null>("organizeTransformedBlock");

export const TransformedBlockSelection = Extension.create({
  name: "organizeTransformedBlockSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin<string | null>({
        key: transformedBlockKey,
        state: {
          init: () => null,
          apply(transaction, value) {
            const next = transaction.getMeta(transformedBlockKey);
            if (next !== undefined) return next;
            return transaction.selectionSet ? null : value;
          },
        },
        props: {
          decorations(state) {
            const blockId = transformedBlockKey.getState(state);
            if (!blockId) return null;
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.attrs?.id === blockId) {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "organize-transformed-block",
                  })
                );
                return false;
              }
              return true;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export function focusAndHighlightBlock(editor: Editor, blockId: string) {
  let blockPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs?.id === blockId) {
      blockPos = pos;
      return false;
    }
    return blockPos === null;
  });
  if (blockPos === null) return;

  const cursor = TextSelection.near(editor.state.doc.resolve(blockPos + 1), 1);
  editor.view.dispatch(
    editor.state.tr
      .setSelection(cursor)
      .setMeta(transformedBlockKey, blockId)
      .scrollIntoView()
  );
  editor.view.focus();
}
