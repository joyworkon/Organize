"use client";

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { List } from "lucide-react";
import { useMemo, useState } from "react";
import { focusAndHighlightBlock } from "./block-selection";
import {
  collectTocEntries,
  DEFAULT_TOC_LEVELS,
  normalizeTocLevels,
  parseTocLevels,
  serializeTocLevels,
  type TocEntry,
} from "./toc";

function jumpToHeading(editor: Editor, entry: TocEntry) {
  // 有块 id 时走统一的高亮跳转（复用评论/块菜单定位路径）
  if (entry.id) {
    focusAndHighlightBlock(editor, entry.id);
    return;
  }
  // 兜底：旧笔记里标题可能没有 id，按 pos 聚焦
  editor.chain().focus().setTextSelection(entry.pos + 1).run();
}

function TocView({ node, editor }: NodeViewProps) {
  const levels = normalizeTocLevels(node.attrs.levels);
  // 编辑器每次 transaction 都会重渲染 NodeView；这里按当前文档实时计算，
  // 无需手动监听 editor.on('update')——NodeViewProps 变化即触发重渲染。
  const entries = useMemo(() => {
    const doc = editor.state.doc;
    return collectTocEntries(doc, levels);
  }, [editor, levels]);

  const [isEmpty] = useState(false);
  void isEmpty;

  return (
    <NodeViewWrapper
      className="organize-toc"
      data-toc=""
      data-levels={serializeTocLevels(levels)}
      contentEditable={false}
      as="div"
    >
      <div className="organize-toc-header" contentEditable={false}>
        <List className="h-4 w-4" />
        <span>目录</span>
      </div>
      {entries.length === 0 ? (
        <p className="organize-toc-empty">在文档中添加标题（H1–H3）后会自动出现在此处。</p>
      ) : (
        <ul className="organize-toc-list">
          {entries.map((entry, index) => (
            <li
              key={`${entry.id || entry.pos}-${index}`}
              className="organize-toc-item"
              style={{ paddingLeft: `${(entry.level - 1) * 1.1}rem` }}
              data-level={entry.level}
            >
              <button
                type="button"
                className="organize-toc-link"
                title="点击跳转到该标题"
                onClick={() => jumpToHeading(editor, entry)}
              >
                {entry.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toc: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      levels: {
        default: DEFAULT_TOC_LEVELS,
        parseHTML: (el) => parseTocLevels((el as HTMLElement).getAttribute("data-levels")),
        renderHTML: (attrs) => ({
          "data-levels": serializeTocLevels(normalizeTocLevels(attrs.levels)),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-toc]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toc": "" })];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { levels: DEFAULT_TOC_LEVELS } }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocView);
  },
});
