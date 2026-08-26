import type { Editor } from "@tiptap/core";
import type { PluginEditorBridge, PluginEditorContent } from "@organize/plugin-sdk";
import { replaceBlock } from "@/components/editor/block-commands";

/**
 * 为插件斜杠命令构造受限编辑器操作面。
 *
 * pos 在执行菜单动作时锁定：菜单打开期间文档焦点在菜单输入框，
 * 块位置不会漂移；handler 若为异步并在 await 后操作，文档可能已变，
 * 因此插件应把 bridge 操作放在第一个 await 之前（与 Obsidian 约定一致）。
 */
export function createEditorBridge(editor: Editor, pos: number): PluginEditorBridge {
  return {
    getBlockText: () => editor.state.doc.nodeAt(pos)?.textContent ?? "",
    replaceBlock: (content) => {
      // PluginEditorContent 与 JSONContent 结构兼容；replaceBlock 负责
      // 带入原块文本、保留块 id、合并相邻同类型列表
      replaceBlock(editor, pos, content as Parameters<typeof replaceBlock>[2]);
    },
    insertAfter: (content) => {
      const node = editor.state.doc.nodeAt(pos);
      if (!node) return;
      editor
        .chain()
        .focus()
        .insertContentAt(pos + node.nodeSize, content as PluginEditorContent)
        .run();
    },
  };
}
