import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * 拖拽块多选：在编辑器空白区 / 块间隙按下并拖动，框选一整排顶层块
 * （Notion 的 block selection）。选中的块用 .organize-block-selected 高亮。
 *
 * - 插件状态保存选中块的位置集合（顶层列表自身没有块 id，用 id 会漏选列表；
 *   任何文档/选区变化都会清空集合，所以位置不会在使用期间过期）
 * - Escape 清空选择；Backspace/Delete 删除所有选中块（一个事务，从下往上删）
 * - 交互（按下/拖动/松开的命中计算）在 tiptap-editor.tsx 的 React 层
 */

const multiSelectKey = new PluginKey<Set<number>>("organizeBlockMultiSelect");

export function getMultiSelectedBlocks(editor: Editor): number[] {
  return Array.from(multiSelectKey.getState(editor.state) ?? []);
}

export function setMultiSelectedBlocks(editor: Editor, positions: number[]) {
  editor.view.dispatch(editor.state.tr.setMeta(multiSelectKey, new Set(positions)));
}

export const BlockMultiSelect = Extension.create({
  name: "organizeBlockMultiSelect",
  // 高于 ListBackspaceFix：多选存在时 Backspace 必须删选中块而不是处理块首退格
  priority: 200,

  addProseMirrorPlugins() {
    return [
      new Plugin<Set<number>>({
        key: multiSelectKey,
        state: {
          init: () => new Set<number>(),
          apply(transaction, value) {
            const next = transaction.getMeta(multiSelectKey);
            if (next !== undefined) return next;
            // 其它编辑 / 光标移动发生时兜底清空（删除命令会显式再清一次）
            if (transaction.docChanged || transaction.selectionSet) return new Set<number>();
            return value;
          },
        },
        props: {
          decorations(state) {
            const positions = multiSelectKey.getState(state);
            if (!positions || positions.size === 0) return null;
            const decorations: Decoration[] = [];
            state.doc.forEach((node, pos) => {
              if (positions.has(pos)) {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "organize-block-selected",
                  })
                );
              }
            });
            return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    const deleteSelected = (editor: Editor): boolean => {
      const positions = multiSelectKey.getState(editor.state);
      if (!positions || positions.size === 0) return false;
      const ranges: { from: number; to: number }[] = [];
      for (const pos of Array.from(positions)) {
        const node = editor.state.doc.nodeAt(pos);
        if (node) ranges.push({ from: pos, to: pos + node.nodeSize });
      }
      if (!ranges.length) return false;
      const tr = editor.state.tr;
      // 从下往上删：前面的删除不影响后面（更小位置）的范围
      ranges.sort((a, b) => b.from - a.from);
      for (const range of ranges) tr.delete(range.from, range.to);
      if (tr.doc.childCount === 0) tr.insert(0, editor.schema.nodes.paragraph.create());
      tr.setMeta(multiSelectKey, new Set<number>());
      editor.view.dispatch(tr.scrollIntoView());
      editor.commands.focus();
      return true;
    };
    return {
      Escape: ({ editor }) => {
        const positions = multiSelectKey.getState(editor.state);
        if (!positions || positions.size === 0) return false;
        editor.view.dispatch(editor.state.tr.setMeta(multiSelectKey, new Set<number>()));
        return true;
      },
      Backspace: ({ editor }) => deleteSelected(editor),
      Delete: ({ editor }) => deleteSelected(editor),
    };
  },
});
