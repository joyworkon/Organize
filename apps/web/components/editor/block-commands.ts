import type { Editor, JSONContent } from "@tiptap/core";
import {
  Bookmark,
  Code2,
  CodeSquare,
  Columns2,
  Columns3,
  Columns4,
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
} from "lucide-react";
import type { BlockCommandDefinition } from "./types";

function replaceBlock(editor: Editor, pos: number, content: JSONContent) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const text = node.textContent;
  const addTextToFirstTextContainer = (candidate: JSONContent): JSONContent => {
    if (!text) return candidate;
    if (["paragraph", "heading", "codeBlock", "callout", "detailsSummary"].includes(candidate.type || "")) {
      return { ...candidate, content: [{ type: "text", text }] };
    }
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
  editor.chain().focus().insertContentAt(
    { from: pos, to: pos + node.nodeSize },
    addTextToFirstTextContainer(content)
  ).run();
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
    run: (editor: Editor, pos: number) => replaceBlock(editor, pos, textBlock("heading", { level })),
  })),
  {
    id: "bullet-list",
    label: "项目符号列表",
    category: "基本区块",
    icon: List,
    keywords: ["bullet", "list", "无序", "列表"],
    canTransform: true,
    run: (editor, pos) => replaceBlock(editor, pos, listBlock("bulletList")),
  },
  {
    id: "ordered-list",
    label: "编号列表",
    category: "基本区块",
    icon: ListOrdered,
    keywords: ["ordered", "number", "有序", "编号"],
    canTransform: true,
    run: (editor, pos) => replaceBlock(editor, pos, listBlock("orderedList")),
  },
  {
    id: "task-list",
    label: "待办列表",
    category: "基本区块",
    icon: ListTodo,
    keywords: ["todo", "task", "check", "待办"],
    canTransform: true,
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
    run: (editor, pos) => replaceBlock(editor, pos, { type: "codeBlock", content: [] }),
  },
  {
    id: "callout",
    label: "标注",
    category: "基本区块",
    icon: Lightbulb,
    keywords: ["callout", "提示", "标注"],
    canTransform: true,
    run: (editor, pos) => replaceBlock(editor, pos, { type: "callout", attrs: { emoji: "💡" } }),
  },
  {
    id: "divider",
    label: "分隔线",
    category: "基本区块",
    icon: Minus,
    keywords: ["divider", "line", "分隔线"],
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
    run: (editor, pos) => emit(editor, "math", pos),
  },
  {
    id: "reference",
    label: "引用阅读条目",
    category: "媒体",
    icon: Bookmark,
    keywords: ["reference", "bookmark", "阅读", "引用"],
    run: (editor, pos) => emit(editor, "reference", pos),
  },
  ...([2, 3, 4] as const).map((cols) => ({
    id: `columns-${cols}`,
    label: `${cols} 列`,
    category: "布局" as const,
    icon: [Columns2, Columns3, Columns4][cols - 2],
    keywords: ["columns", "column", "分栏", `${cols}列`],
    run: (editor: Editor, pos: number) =>
      replaceBlock(editor, pos, {
        type: "columns",
        attrs: { cols },
        content: Array.from({ length: cols }, () => ({
          type: "column",
          content: [{ type: "paragraph" }],
        })),
      }),
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
