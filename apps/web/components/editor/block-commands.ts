import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Bookmark,
  Code2,
  CodeSquare,
  Columns,
  Columns2,
  Columns3,
  Columns4,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Lightbulb,
  List,
  ListCollapse,
  ListOrdered,
  ListTodo,
  Mic2,
  Minus,
  Quote,
  Sigma,
  Table as TableIcon,
  Text,
  TextCursorInput,
} from "lucide-react";
import type { BlockCommandDefinition } from "./types";
import { BLOCK_ID_TYPES } from "./block-utils";
import { normalizeColumnCount, normalizeColumnWidths } from "./extensions/columns";

export function preserveBlockId(content: JSONContent, blockId: string): JSONContent {
  const visit = (candidate: JSONContent): { node: JSONContent; preserved: boolean } => {
    if (candidate.type && BLOCK_ID_TYPES.includes(candidate.type)) {
      return {
        node: {
          ...candidate,
          attrs: {
            ...(candidate.attrs || {}),
            id: blockId,
          },
        },
        preserved: true,
      };
    }

    if (!candidate.content) return { node: candidate, preserved: false };
    let preserved = false;
    const children = candidate.content.map((child) => {
      if (preserved) return child;
      const result = visit(child);
      preserved = result.preserved;
      return result.node;
    });
    return {
      node: preserved ? { ...candidate, content: children } : candidate,
      preserved,
    };
  };

  return visit(content).node;
}

export function buildBlockReplacement(
  node: ProseMirrorNode,
  content: JSONContent
): JSONContent {
  const text = blockTextForReplacement(node);
  const blockId = String(node.attrs?.id || "");
  const inlineContent = (value: string): JSONContent[] =>
    value.split("\n").flatMap((line, index) => [
      ...(index > 0 ? [{ type: "hardBreak" }] : []),
      ...(line ? [{ type: "text", text: line }] : []),
    ]);
  const addTextToFirstTextContainer = (candidate: JSONContent): JSONContent => {
    if (!text) return candidate;
    if (["paragraph", "heading", "detailsSummary"].includes(candidate.type || "")) {
      return { ...candidate, content: inlineContent(text) };
    }
    if (candidate.type === "codeBlock") {
      return { ...candidate, content: [{ type: "text", text }] };
    }
    // 叶子节点（horizontalRule / image 等）不允许带 content，原样返回避免非法 JSON
    if (!candidate.content) return candidate;
    let inserted = false;
    return {
      ...candidate,
      content: (candidate.content || []).map((child) => {
        if (inserted) return child;
        const updated = addTextToFirstTextContainer(child);
        if (updated !== child) inserted = true;
        return updated;
      }),
    };
  };
  return blockId
    ? preserveBlockId(addTextToFirstTextContainer(content), blockId)
    : addTextToFirstTextContainer(content);
}

export function blockTextForReplacement(node: ProseMirrorNode): string {
  if (node.type.name !== "columns") return node.textContent;
  const lines: string[] = [];
  node.descendants((child) => {
    if (!child.isTextblock) return true;
    const text = child.textContent;
    if (text.trim()) lines.push(text);
    return false;
  });
  return lines.join("\n");
}

const JOINABLE_LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

export function replaceBlock(editor: Editor, pos: number, content: JSONContent) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const replacement = buildBlockReplacement(node, content);
  const replacementNode = editor.schema.nodeFromJSON(replacement);
  const tr = editor.state.tr
    .replaceWith(pos, pos + node.nodeSize, replacementNode)
    .scrollIntoView();
  // 替换出的列表若与前后相邻列表同类型，合并成一个列表，
  // 否则「转换成列表」会造出两个紧挨着却各自独立的列表（渲染成两段、编号断裂）
  if (JOINABLE_LIST_TYPES.has(replacementNode.type.name)) {
    const $pos = tr.doc.resolve(pos);
    if ($pos.depth === 0 && $pos.nodeBefore && $pos.nodeBefore.type.name === replacementNode.type.name) {
      tr.join(pos);
      pos -= $pos.nodeBefore.nodeSize;
    }
    const merged = tr.doc.nodeAt(pos);
    if (merged) {
      const end = pos + merged.nodeSize;
      const $end = tr.doc.resolve(end);
      if ($end.depth === 0 && $end.nodeAfter && $end.nodeAfter.type.name === merged.type.name) {
        tr.join(end);
      }
    }
  }
  editor.view.dispatch(tr);
}

export function replaceBlockWithColumns(editor: Editor, pos: number, columnCount: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const cols = normalizeColumnCount(columnCount);
  const blockId = String(node.attrs?.id || "");
  const source: JSONContent = node.toJSON();
  if (source.attrs?.id) {
    const attrs = { ...source.attrs };
    delete attrs.id;
    source.attrs = attrs;
  }

  let columnsContent: JSONContent[];
  if (node.type.name === "columns") {
    const existing = (source.content || []).map((column) => ({
      ...column,
      content: [...(column.content || [{ type: "paragraph" }])],
    }));
    if (existing.length >= cols) {
      columnsContent = existing.slice(0, cols);
      for (const overflow of existing.slice(cols)) {
        columnsContent[cols - 1].content!.push(...(overflow.content || []));
      }
    } else {
      columnsContent = [
        ...existing,
        ...Array.from({ length: cols - existing.length }, () => ({
          type: "column",
          content: [{ type: "paragraph" }],
        })),
      ];
    }
  } else {
    columnsContent = [
      { type: "column", content: [source] },
      ...Array.from({ length: cols - 1 }, () => ({
        type: "column",
        content: [{ type: "paragraph" }],
      })),
    ];
  }

  const replacement: JSONContent = {
    type: "columns",
    attrs: {
      cols,
      widths: normalizeColumnWidths(null, cols),
      widthsCustomized: false,
      ...(blockId ? { id: blockId } : {}),
    },
    content: columnsContent,
  };
  const replacementNode = editor.schema.nodeFromJSON(replacement);
  editor.view.dispatch(
    editor.state.tr
      .replaceWith(pos, pos + node.nodeSize, replacementNode)
      .scrollIntoView()
  );
}

function textBlock(type: "paragraph" | "heading", attrs?: Record<string, unknown>): JSONContent {
  return { type, attrs, content: [] };
}

function listBlock(type: "bulletList" | "orderedList"): JSONContent {
  return {
    type,
    content: [{ type: "listItem", content: [{ type: "paragraph", content: [] }] }],
  };
}

function makeTable(): JSONContent {
  return {
    type: "table",
    content: Array.from({ length: 3 }, (_, row) => ({
      type: "tableRow",
      content: Array.from({ length: 3 }, () => ({
        type: row === 0 ? "tableHeader" : "tableCell",
        content: [{ type: "paragraph", content: [] }],
      })),
    })),
  };
}

function emit(editor: Editor, type: string, pos: number) {
  editor.view.dom.dispatchEvent(
    new CustomEvent("organize-editor-action", { bubbles: true, detail: { type, pos } })
  );
}

export const BLOCK_COMMANDS: BlockCommandDefinition[] = [
  {
    id: "ai-notes",
    label: "AI 速记",
    description: "录音、转写并整理成结构化笔记",
    category: "建议",
    icon: Mic2,
    keywords: ["ai", "录音", "会议", "转写", "总结"],
    run: (editor, pos) => emit(editor, "ai-notes", pos),
  },
  {
    id: "html",
    label: "HTML · 嵌入",
    description: "在安全沙箱中运行 HTML",
    category: "建议",
    icon: Code2,
    keywords: ["html", "embed", "嵌入", "代码"],
    run: (editor, pos) => emit(editor, "html", pos),
  },
  {
    id: "paragraph",
    label: "文本",
    category: "基本区块",
    icon: Text,
    keywords: ["text", "paragraph", "正文", "文本"],
    canTransform: true,
    preview: { sample: "正文文本", caption: "普通正文文本" },
    run: (editor, pos) => replaceBlock(editor, pos, textBlock("paragraph")),
  },
  ...([1, 2, 3, 4] as const).map((level) => ({
    id: `heading-${level}`,
    label: `标题 ${level}`,
    category: "基本区块" as const,
    icon: [Heading1, Heading2, Heading3, Heading4][level - 1],
    keywords: [`h${level}`, "heading", "标题"],
    shortcut: "#".repeat(level),
    canTransform: true,
    preview: {
      sample: `标题 ${level}`,
      caption: ["大型版块标题", "中型版块标题", "小型版块标题", "迷你版块标题"][level - 1],
    },
    run: (editor: Editor, pos: number) => replaceBlock(editor, pos, textBlock("heading", { level })),
  })),
  {
    id: "page",
    label: "页面",
    category: "基本区块",
    icon: FileText,
    keywords: ["page", "页面", "子页面", "子笔记"],
    canTransform: true,
    preview: { sample: "📄 子页面", caption: "转换成子页面链接" },
    run: (editor, pos) => emit(editor, "page", pos),
  },
  {
    id: "bullet-list",
    label: "项目符号列表",
    category: "基本区块",
    icon: List,
    keywords: ["bullet", "list", "无序", "列表"],
    canTransform: true,
    preview: { sample: "• 列表项", caption: "无序项目符号列表" },
    run: (editor, pos) => replaceBlock(editor, pos, listBlock("bulletList")),
  },
  {
    id: "ordered-list",
    label: "编号列表",
    category: "基本区块",
    icon: ListOrdered,
    keywords: ["ordered", "number", "有序", "编号"],
    canTransform: true,
    preview: { sample: "1. 列表项", caption: "自动编号的有序列表" },
    run: (editor, pos) => replaceBlock(editor, pos, listBlock("orderedList")),
  },
  {
    id: "task-list",
    label: "待办列表",
    category: "基本区块",
    icon: ListTodo,
    keywords: ["todo", "task", "check", "待办"],
    canTransform: true,
    preview: { sample: "☑ 待办事项", caption: "可勾选的任务清单" },
    run: (editor, pos) =>
      replaceBlock(editor, pos, {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] },
        ],
      }),
  },
  {
    id: "details",
    label: "折叠列表",
    category: "基本区块",
    icon: ListCollapse,
    keywords: ["toggle", "details", "折叠"],
    canTransform: true,
    preview: { sample: "▸ 折叠列表", caption: "可展开 / 折叠的列表" },
    run: (editor, pos) =>
      replaceBlock(editor, pos, {
        type: "details",
        content: [
          { type: "detailsSummary", content: [] },
          { type: "detailsContent", content: [{ type: "paragraph" }] },
        ],
      }),
  },
  {
    id: "quote",
    label: "引用",
    category: "基本区块",
    icon: Quote,
    keywords: ["quote", "blockquote", "引用"],
    canTransform: true,
    preview: { sample: "引用文字", caption: "引用一段文字" },
    run: (editor, pos) =>
      replaceBlock(editor, pos, {
        type: "blockquote",
        content: [{ type: "paragraph", content: [] }],
      }),
  },
  {
    id: "code",
    label: "代码块",
    category: "基本区块",
    icon: CodeSquare,
    keywords: ["code", "代码"],
    canTransform: true,
    preview: { sample: "const a = 1;", caption: "等宽字体的代码片段" },
    run: (editor, pos) => replaceBlock(editor, pos, { type: "codeBlock", content: [] }),
  },
  {
    id: "callout",
    label: "标注",
    category: "基本区块",
    icon: Lightbulb,
    keywords: ["callout", "提示", "标注"],
    canTransform: true,
    preview: { sample: "💡 标注内容", caption: "醒目的标注提示" },
    run: (editor, pos) =>
      replaceBlock(editor, pos, {
        type: "callout",
        attrs: { emoji: "💡" },
        content: [{ type: "paragraph" }],
      }),
  },
  ...([1, 2, 3, 4] as const).map((level) => ({
    id: `toggle-heading-${level}`,
    label: `折叠标题 ${level}`,
    category: "基本区块" as const,
    icon: TextCursorInput,
    keywords: [`h${level}`, "toggle", "heading", "折叠", "标题"],
    canTransform: true,
    preview: {
      sample: `▸ 折叠标题 ${level}`,
      caption: `可折叠的${["大", "中", "小", "迷你"][level - 1]}型标题`,
    },
    run: (editor: Editor, pos: number) =>
      replaceBlock(editor, pos, {
        type: "details",
        content: [
          { type: "detailsSummary", attrs: { level }, content: [] },
          { type: "detailsContent", content: [{ type: "paragraph" }] },
        ],
      }),
  })),
  {
    id: "divider",
    label: "分隔线",
    category: "基本区块",
    icon: Minus,
    keywords: ["divider", "line", "分隔线"],
    canTransform: true,
    preview: { sample: "———", caption: "水平分隔线" },
    run: (editor, pos) => replaceBlock(editor, pos, { type: "horizontalRule" }),
  },
  {
    id: "image",
    label: "图片",
    category: "媒体",
    icon: ImageIcon,
    keywords: ["image", "upload", "图片", "上传"],
    run: (editor, pos) => emit(editor, "image", pos),
  },
  {
    id: "table",
    label: "表格",
    category: "媒体",
    icon: TableIcon,
    keywords: ["table", "表格"],
    run: (editor, pos) => replaceBlock(editor, pos, makeTable()),
  },
  {
    id: "math",
    label: "公式区块",
    category: "媒体",
    icon: Sigma,
    keywords: ["math", "latex", "公式"],
    canTransform: true,
    preview: { sample: "E = mc²", caption: "LaTeX 数学公式区块" },
    run: (editor, pos) => {
      // 块内文字若为 LaTeX 直接带入公式
      const source = editor.state.doc.nodeAt(pos);
      const latex = source ? blockTextForReplacement(source).trim() : "";
      replaceBlock(editor, pos, { type: "mathBlock", attrs: { latex } });
    },
  },
  {
    id: "reference",
    label: "引用阅读条目",
    category: "媒体",
    icon: Bookmark,
    keywords: ["reference", "bookmark", "阅读", "引用"],
    run: (editor, pos) => emit(editor, "reference", pos),
  },
  ...([2, 3, 4, 5] as const).map((cols) => ({
    id: `columns-${cols}`,
    label: `${cols} 列`,
    category: "布局" as const,
    icon: [Columns2, Columns3, Columns4, Columns][cols - 2],
    keywords: ["columns", "column", "分栏", `${cols}列`],
    canTransform: true,
    preview: { sample: "▯".repeat(cols), caption: `${["两", "三", "四", "五"][cols - 2]}栏并排布局` },
    run: (editor: Editor, pos: number) => replaceBlockWithColumns(editor, pos, cols),
  })),
];

export function commandMatches(command: BlockCommandDefinition, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [command.label, command.description || "", ...command.keywords]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}
