"use client";

import "katex/dist/katex.min.css";
import { useEditor, EditorContent, BubbleMenu, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Details from "@tiptap/extension-details";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import { Callout } from "./extensions/callout";
import { InlineMath, MathBlock, MathCommands } from "./extensions/math";
import { Columns, Column } from "./extensions/columns";
import { BlockStyle } from "./extensions/block-style";
import { HtmlEmbed } from "./extensions/html-embed";
import { SlashCommand } from "./extensions/slash-command";
import { BlockDeepLink } from "./extensions/deep-link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BLOCK_ID_TYPES, isSameNodeSnapshot, moveBlockTransaction, nodeText } from "./block-utils";
import { BlockCommandMenu } from "./block-command-menu";
import { BlockActionMenu, type EditorSkillAction } from "./block-action-menu";
import { EditorDialogs } from "./editor-dialogs";
import { PresentationMode } from "./presentation-mode";
import type { EditorBlockTarget, EditorDialog, EditorMenuPoint } from "./types";
import { usePluginStore } from "@/lib/plugin/store";
import type { AIActionExtension, PluginContext, ToolbarActionExtension } from "@organize/plugin-sdk";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Link2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListOrdered,
  ListTodo,
  ListCollapse,
  Quote,
  CodeSquare,
  Text,
  Image as ImageIcon,
  Upload,
  Table as TableIcon,
  Bookmark,
  ChevronDown,
  Check,
  Plus,
  Lightbulb,
  Sigma,
  Smile,
  MoreHorizontal,
  Minus,
  Undo2,
  Redo2,
  RemoveFormatting,
  Columns2,
  Columns3,
  Columns4,
} from "lucide-react";

interface EditorProps {
  noteId: string;
  noteTitle?: string;
  content: Record<string, unknown>;
  onUpdate: (content: Record<string, unknown>) => void;
}

/* ----------------------------- 块类型配置 ----------------------------- */

interface BlockOption {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: (editor: Editor) => boolean;
  action: (editor: Editor) => void;
}

const blockOptions: BlockOption[] = [
  {
    label: "文本",
    icon: Text,
    isActive: (e) => e.isActive("paragraph"),
    action: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    label: "标题 1",
    icon: Heading1,
    isActive: (e) => e.isActive("heading", { level: 1 }),
    action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "标题 2",
    icon: Heading2,
    isActive: (e) => e.isActive("heading", { level: 2 }),
    action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "标题 3",
    icon: Heading3,
    isActive: (e) => e.isActive("heading", { level: 3 }),
    action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "标题 4",
    icon: Heading4,
    isActive: (e) => e.isActive("heading", { level: 4 }),
    action: (e) => e.chain().focus().toggleHeading({ level: 4 }).run(),
  },
  {
    label: "项目符号列表",
    icon: List,
    isActive: (e) => e.isActive("bulletList"),
    action: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "编号列表",
    icon: ListOrdered,
    isActive: (e) => e.isActive("orderedList"),
    action: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "待办列表",
    icon: ListTodo,
    isActive: (e) => e.isActive("taskList"),
    action: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: "折叠列表",
    icon: ListCollapse,
    isActive: (e) => e.isActive("details"),
    action: (e) =>
      e.isActive("details")
        ? e.chain().focus().unsetDetails().run()
        : e.chain().focus().setDetails().run(),
  },
  {
    label: "引用",
    icon: Quote,
    isActive: (e) => e.isActive("blockquote"),
    action: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "代码块",
    icon: CodeSquare,
    isActive: (e) => e.isActive("codeBlock"),
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    label: "标注",
    icon: Lightbulb,
    isActive: (e) => e.isActive("callout"),
    action: (e) => e.chain().focus().toggleCallout().run(),
  },
  {
    label: "公式区块",
    icon: Sigma,
    isActive: (e) => e.isActive("mathBlock"),
    action: (e) => {
      const latex = window.prompt("输入 LaTeX 公式，例如 E = mc^2");
      if (latex) e.chain().focus().insertMathBlock(latex).run();
    },
  },
  {
    label: "2 列",
    icon: Columns2,
    isActive: (e) => e.isActive("columns", { cols: 2 }),
    action: (e) => e.chain().focus().insertColumns(2).run(),
  },
  {
    label: "3 列",
    icon: Columns3,
    isActive: (e) => e.isActive("columns", { cols: 3 }),
    action: (e) => e.chain().focus().insertColumns(3).run(),
  },
  {
    label: "4 列",
    icon: Columns4,
    isActive: (e) => e.isActive("columns", { cols: 4 }),
    action: (e) => e.chain().focus().insertColumns(4).run(),
  },
];

function getActiveBlock(editor: Editor): BlockOption {
  return blockOptions.find((b) => b.isActive(editor)) || blockOptions[0];
}

/* ----------------------------- 表情选择器 ----------------------------- */

const EMOJIS = [
  "😀", "😂", "🤣", "😊", "😍", "🥰", "😎", "🤔",
  "😅", "🙃", "😭", "😡", "👍", "👎", "👏", "🙏",
  "💪", "🎉", "🎯", "🔥", "⭐", "❤️", "💡", "✅",
  "❌", "⚠️", "📌", "📖", "✏️", "🚀", "💯", "🌟",
];

function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <div className="grid w-64 grid-cols-8 gap-0.5 p-1.5">
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSelect(emoji)}
          className="rounded p-1 text-lg transition-colors hover:bg-accent"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- 下拉菜单 ----------------------------- */

function Dropdown({
  trigger,
  children,
  align = "start",
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div
          className={cn(
            "absolute top-full mt-1.5 z-50 min-w-[12rem] rounded-lg border bg-popover p-1 shadow-lg",
            align === "start" ? "left-0" : "right-0"
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent",
        active && "bg-accent/60"
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-left">{label}</span>
      {active && <Check className="h-3.5 w-3.5 text-primary" />}
    </button>
  );
}

/* --------------------------- 浮动工具栏按钮 --------------------------- */

function BubbleButton({
  onClick,
  isActive,
  title,
  children,
}: {
  onClick: () => void;
  isActive?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "rounded p-1.5 transition-colors hover:bg-accent",
        isActive ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-border" />;
}

/* ----------------------------- 浮动工具栏 ----------------------------- */

function BubbleToolbar({
  editor,
  onUploadImage,
  onAddImageUrl,
  onAddTable,
  onAddReference,
}: {
  editor: Editor;
  onUploadImage: () => void;
  onAddImageUrl: () => void;
  onAddTable: () => void;
  onAddReference: () => void;
}) {
  const activeBlock = getActiveBlock(editor);
  const ActiveBlockIcon = activeBlock.icon;

  const addLink = () => {
    const url = window.prompt("输入链接 URL");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
  };

  const addInlineMath = () => {
    const latex = window.prompt("输入 LaTeX 公式，例如 a^2 + b^2 = c^2");
    if (latex) {
      editor.chain().focus().insertInlineMath(latex).run();
    }
  };

  const insertEmoji = (emoji: string) => {
    editor.chain().focus().insertContent(emoji).run();
  };

  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-popover px-1.5 py-1 shadow-lg">
      {/* 块类型选择器（二级菜单） */}
      <Dropdown
        trigger={(open) => (
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent",
              open ? "bg-accent text-foreground" : "text-muted-foreground"
            )}
          >
            <ActiveBlockIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{activeBlock.label}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      >
        {(close) => (
          <div className="max-h-80 overflow-y-auto">
            {blockOptions.map((opt) => (
              <MenuItem
                key={opt.label}
                icon={opt.icon}
                label={opt.label}
                active={opt.isActive(editor)}
                onClick={() => {
                  opt.action(editor);
                  close();
                }}
              />
            ))}
          </div>
        )}
      </Dropdown>

      <Divider />

      {/* 文本格式 */}
      <BubbleButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="粗体"
      >
        <Bold className="h-4 w-4" />
      </BubbleButton>
      <BubbleButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="斜体"
      >
        <Italic className="h-4 w-4" />
      </BubbleButton>
      <BubbleButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive("underline")}
        title="下划线"
      >
        <UnderlineIcon className="h-4 w-4" />
      </BubbleButton>
      <BubbleButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title="删除线"
      >
        <Strikethrough className="h-4 w-4" />
      </BubbleButton>
      <BubbleButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title="行内代码"
      >
        <Code className="h-4 w-4" />
      </BubbleButton>
      <BubbleButton
        onClick={addLink}
        isActive={editor.isActive("link")}
        title="链接"
      >
        <Link2 className="h-4 w-4" />
      </BubbleButton>
      <BubbleButton
        onClick={addInlineMath}
        isActive={editor.isActive("inlineMath")}
        title="行内公式"
      >
        <Sigma className="h-4 w-4" />
      </BubbleButton>

      <Divider />

      {/* 表情选择器 */}
      <Dropdown
        trigger={(open) => (
          <button
            type="button"
            title="插入表情"
            className={cn(
              "rounded p-1.5 transition-colors hover:bg-accent",
              open ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Smile className="h-4 w-4" />
          </button>
        )}
      >
        {(close) => (
          <EmojiPicker
            onSelect={(emoji) => {
              insertEmoji(emoji);
              close();
            }}
          />
        )}
      </Dropdown>

      {/* 插入菜单（二级菜单） */}
      <Dropdown
        align="end"
        trigger={(open) => (
          <button
            type="button"
            title="插入"
            className={cn(
              "rounded p-1.5 transition-colors hover:bg-accent",
              open ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={Upload}
              label="上传图片"
              onClick={() => {
                onUploadImage();
                close();
              }}
            />
            <MenuItem
              icon={ImageIcon}
              label="图片 URL"
              onClick={() => {
                onAddImageUrl();
                close();
              }}
            />
            <MenuItem
              icon={TableIcon}
              label="表格"
              onClick={() => {
                onAddTable();
                close();
              }}
            />
            <MenuItem
              icon={Bookmark}
              label="引用阅读条目"
              onClick={() => {
                onAddReference();
                close();
              }}
            />
          </>
        )}
      </Dropdown>

      {/* 更多菜单 */}
      <Dropdown
        align="end"
        trigger={(open) => (
          <button
            type="button"
            title="更多"
            className={cn(
              "rounded p-1.5 transition-colors hover:bg-accent",
              open ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={Minus}
              label="分隔线"
              onClick={() => {
                editor.chain().focus().setHorizontalRule().run();
                close();
              }}
            />
            <MenuItem
              icon={RemoveFormatting}
              label="清除格式"
              onClick={() => {
                editor.chain().focus().clearNodes().unsetAllMarks().run();
                close();
              }}
            />
            <MenuItem
              icon={Undo2}
              label="撤销"
              onClick={() => {
                editor.chain().focus().undo().run();
                close();
              }}
            />
            <MenuItem
              icon={Redo2}
              label="重做"
              onClick={() => {
                editor.chain().focus().redo().run();
                close();
              }}
            />
          </>
        )}
      </Dropdown>
    </div>
  );
}

/* ------------------------------- 编辑器 ------------------------------- */

interface OpenMenuState {
  pos: number;
  point: EditorMenuPoint;
}

interface OpenActionState extends OpenMenuState {
  target: EditorBlockTarget;
}

interface HoveredBlock {
  editor: Editor;
  node: ProseMirrorNode;
  pos: number;
  top: number;
  element: HTMLElement;
}

interface BlockDropTarget {
  insertPos: number;
  top: number;
}

interface BlockPointerDrag {
  pointerId: number;
  startX: number;
  startY: number;
  source: HoveredBlock;
  active: boolean;
}

function replaceAt(editor: Editor, pos: number, content: Record<string, unknown>) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, content).run();
}

function nodePosForElement(editor: Editor, element: HTMLElement) {
  const domPos = editor.view.posAtDOM(element, 0);
  const $pos = editor.state.doc.resolve(domPos);
  return $pos.depth > 0 ? $pos.before($pos.depth) : domPos;
}

function blockElementAtTarget(editorDom: HTMLElement, target: HTMLElement) {
  const listItem = target.closest("li");
  if (listItem instanceof HTMLElement && editorDom.contains(listItem)) return listItem;

  let block: HTMLElement | null = target;
  while (block?.parentElement && block.parentElement !== editorDom) block = block.parentElement;
  return block?.parentElement === editorDom ? block : null;
}

export function TipTapEditor({ noteId, noteTitle = "", content, onUpdate }: EditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialContentRef = useRef(content);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const hoveredRef = useRef<HoveredBlock | null>(null);
  const pointerDragRef = useRef<BlockPointerDrag | null>(null);
  const dropTargetRef = useRef<BlockDropTarget | null>(null);
  const suppressGripClickRef = useRef(false);
  const [hoveredBlock, setHoveredBlock] = useState<HoveredBlock | null>(null);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);
  const [dropTarget, setDropTarget] = useState<BlockDropTarget | null>(null);
  const [commandMenu, setCommandMenu] = useState<OpenMenuState | null>(null);
  const [actionMenu, setActionMenu] = useState<OpenActionState | null>(null);
  const [dialog, setDialog] = useState<EditorDialog>(null);
  const [presentationStart, setPresentationStart] = useState<string | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const activePlugins = usePluginStore((state) => Array.from(state.activePlugins.entries()));
  const pluginContexts = usePluginStore((state) => state.contexts);

  const extensions = useMemo(() => {
    return [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "输入内容，或按 ⌘/ 打开区块菜单…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Details,
      DetailsContent,
      DetailsSummary,
      Callout,
      InlineMath,
      MathBlock,
      MathCommands,
      Columns,
      Column,
      HtmlEmbed,
      SlashCommand,
      BlockDeepLink,
      BlockStyle,
      UniqueID.configure({ types: BLOCK_ID_TYPES }),
    ];
  }, []);

  const editor = useEditor({
    extensions,
    content,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onUpdateRef.current(editor.getJSON()),
    editorProps: {
      attributes: {
        class: "prose prose-sm sm:prose max-w-none min-h-[50vh] focus:outline-none py-2 organize-editor",
      },
      handleKeyDown: (view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "/") {
          event.preventDefault();
          const { $from } = view.state.selection;
          const pos = $from.depth > 0 ? $from.before(1) : 0;
          const coords = view.coordsAtPos($from.pos);
          view.dispatch(view.state.tr.setSelection(view.state.selection));
          setActionMenu(null);
          setCommandMenu({ pos, point: { left: Math.max(12, coords.left), top: coords.bottom + 8 } });
          return true;
        }
        return false;
      },
    },
  });

  const closeMenus = useCallback(() => {
    setCommandMenu(null);
    setActionMenu(null);
    editor?.commands.focus();
  }, [editor]);

  // UniqueID 负责后续事务；历史 JSON 初始化时不会产生事务，因此这里主动补齐并保存。
  useEffect(() => {
    if (!editor) return;
    let transaction = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (BLOCK_ID_TYPES.includes(node.type.name) && !node.attrs.id) {
        const id = typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `block-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        transaction = transaction.setNodeMarkup(pos, undefined, { ...node.attrs, id });
      }
    });
    if (transaction.docChanged) {
      editor.view.dispatch(transaction);
      onUpdateRef.current(editor.getJSON());
      return;
    }
    const upgraded = editor.getJSON();
    if (!isSameNodeSnapshot(upgraded, initialContentRef.current)) {
      onUpdateRef.current(upgraded);
    }
  }, [editor]);

  const insertImage = useCallback((url: string, pos?: number) => {
    if (!editor) return;
    if (pos === undefined) editor.chain().focus().setImage({ src: url }).run();
    else replaceAt(editor, pos, { type: "image", attrs: { src: url } });
  }, [editor]);

  const uploadImage = useCallback((pos?: number) => {
    if (!editor) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/gif,image/webp,image/svg+xml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      try {
        const response = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "上传失败");
        insertImage(data.url, pos);
      } catch {
        const reader = new FileReader();
        reader.onload = () => insertImage(String(reader.result), pos);
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [editor, insertImage]);

  const addImageUrl = useCallback(() => {
    const url = window.prompt("输入图片 URL");
    if (url) insertImage(url);
  }, [insertImage]);

  const addReadingReference = useCallback((pos?: number) => {
    if (!editor) return;
    const url = window.prompt("输入要引用的阅读条目 URL");
    if (!url) return;
    const paragraph = {
      type: "paragraph",
      content: [
        { type: "text", text: "📖 参考: " },
        { type: "text", marks: [{ type: "link", attrs: { href: url } }], text: url },
      ],
    };
    pos === undefined ? editor.chain().focus().insertContent(paragraph).run() : replaceAt(editor, pos, paragraph);
  }, [editor]);

  const addTable = useCallback(() => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const root = rootRef.current;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { type: string; pos?: number; target?: EditorBlockTarget; point?: EditorMenuPoint };
      if (typeof detail.pos === "number") {
        if (detail.type === "slash-menu" && detail.point) {
          setActionMenu(null);
          setCommandMenu({ pos: detail.pos, point: detail.point });
        } else if (detail.type === "html") replaceAt(editor, detail.pos, { type: "htmlEmbed" });
        else if (detail.type === "ai-notes") setDialog({ type: "ai-notes", pos: detail.pos });
        else if (detail.type === "image") uploadImage(detail.pos);
        else if (detail.type === "math") {
          const latex = window.prompt("输入 LaTeX 公式，例如 E = mc^2");
          if (latex) replaceAt(editor, detail.pos, { type: "mathBlock", attrs: { latex } });
        } else if (detail.type === "reference") addReadingReference(detail.pos);
      } else if (detail.target) {
        if (detail.type === "move") setDialog({ type: "move", target: detail.target });
        if (detail.type === "comment") setDialog({ type: "comment", target: detail.target });
        if (detail.type === "suggestion") setDialog({ type: "suggestion", target: detail.target });
        if (detail.type === "ask-ai") setDialog({ type: "ask-ai", target: detail.target });
      }
    };
    root?.addEventListener("organize-editor-action", handler);
    return () => root?.removeEventListener("organize-editor-action", handler);
  }, [addReadingReference, editor, uploadImage]);

  useEffect(() => {
    fetch(`/api/notes/${noteId}/comments`)
      .then((response) => response.ok ? response.json() : [])
      .then((threads) => {
        const counts: Record<string, number> = {};
        for (const thread of threads) if (!thread.resolved_at) counts[thread.block_id] = (counts[thread.block_id] || 0) + 1;
        setCommentCounts(counts);
      })
      .catch(() => {});
  }, [dialog, noteId]);

  const skills = useMemo<EditorSkillAction[]>(() => {
    const actions: EditorSkillAction[] = [];
    for (const [pluginId, plugin] of activePlugins) {
      for (const extension of plugin.extensions) {
        const supports = "supports" in extension ? extension.supports : undefined;
        if (!supports?.includes("note-block")) continue;
        if (extension.type !== "ai-action" && extension.type !== "toolbar-action") continue;
        actions.push({
          id: `${plugin.id}:${extension.id}`,
          label: extension.label,
          icon: extension.icon,
          run: async (target) => {
            const baseContext = pluginContexts.get(pluginId);
            const context: PluginContext = {
              userId: baseContext?.userId || "current",
              getCurrentItem: baseContext?.getCurrentItem || (() => null),
              getCurrentNote: () => ({ id: noteId, title: noteTitle, content: editor?.getJSON() || null }),
              getCurrentBlock: () => {
                const selection = editor?.state.selection;
                return {
                  noteId,
                  blockId: target.id,
                  nodeType: target.type,
                  text: target.text,
                  json: target.json as Record<string, unknown>,
                  selection: selection ? {
                    from: selection.from,
                    to: selection.to,
                    text: editor.state.doc.textBetween(selection.from, selection.to, " "),
                  } : undefined,
                };
              },
              getConfig: baseContext?.getConfig || (<T = Record<string, unknown>>() => ({} as T)),
              setConfig: baseContext?.setConfig || (async () => {}),
              notify: baseContext?.notify || ((message) => window.alert(message)),
            };
            if (extension.type === "ai-action") {
              const result = await (extension as AIActionExtension).handler(target.text, context);
              if (typeof result === "string" && result && result !== target.text) {
                const node = editor?.state.doc.nodeAt(target.pos);
                if (node) editor?.chain().focus().insertContentAt(target.pos + node.nodeSize, { type: "paragraph", content: [{ type: "text", text: result }] }).run();
              }
            } else await (extension as ToolbarActionExtension).handler(context);
          },
        });
      }
    }
    return actions;
  }, [activePlugins, editor, noteId, noteTitle, pluginContexts]);

  const updateHoveredBlock = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || isDraggingBlock) return;
    const editorDom = editor.view.dom;
    const target = event.target as HTMLElement | null;

    if (!target || !editorDom.contains(target)) return;
    const block = blockElementAtTarget(editorDom, target);
    if (!block) return;

    const pos = nodePosForElement(editor, block);
    const node = editor.state.doc.nodeAt(pos);
    const shell = rootRef.current;
    if (!node || !shell) return;

    const blockRect = block.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const parsedLineHeight = Number.parseFloat(window.getComputedStyle(block).lineHeight);
    const firstLineHeight = Number.isFinite(parsedLineHeight)
      ? Math.min(parsedLineHeight, blockRect.height)
      : Math.min(28, blockRect.height);
    const top = blockRect.top - shellRect.top + Math.max(0, (firstLineHeight - 28) / 2);
    const next = { editor, node, pos, top, element: block };

    hoveredRef.current = next;
    setHoveredBlock((previous) => (
      previous?.pos === pos && Math.abs(previous.top - top) < 0.5 ? previous : next
    ));
  }, [editor, isDraggingBlock]);

  const hideHoveredBlock = useCallback(() => {
    if (commandMenu || actionMenu || isDraggingBlock) return;
    hoveredRef.current = null;
    setHoveredBlock(null);
  }, [actionMenu, commandMenu, isDraggingBlock]);

  useEffect(() => {
    const hideWhenPointerLeavesEditor = (event: MouseEvent) => {
      const shell = rootRef.current;
      if (shell && event.target instanceof Node && !shell.contains(event.target)) {
        hideHoveredBlock();
      }
    };
    document.addEventListener("mousemove", hideWhenPointerLeavesEditor, true);
    return () => document.removeEventListener("mousemove", hideWhenPointerLeavesEditor, true);
  }, [hideHoveredBlock]);

  const insertBlockBelow = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const current = hoveredRef.current;
    if (!current || current.pos < 0) return;

    const insertPos = current.pos + current.node.nodeSize;
    const isListItem = current.node.type.name === "listItem" || current.node.type.name === "taskItem";
    const emptyBlock = isListItem
      ? {
          type: current.node.type.name,
          ...(current.node.type.name === "taskItem" ? { attrs: { checked: false } } : {}),
          content: [{ type: "paragraph" }],
        }
      : { type: "paragraph" };
    const textSelectionPos = insertPos + (isListItem ? 2 : 1);
    current.editor
      .chain()
      .focus()
      .insertContentAt(insertPos, emptyBlock)
      .setTextSelection(textSelectionPos)
      .run();
    const rect = event.currentTarget.getBoundingClientRect();
    setActionMenu(null);
    setCommandMenu({ pos: insertPos, point: { left: rect.left, top: rect.bottom + 8 } });
  }, []);

  const openBlockActions = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (suppressGripClickRef.current) {
      suppressGripClickRef.current = false;
      return;
    }
    const current = hoveredRef.current;
    if (!current || current.pos < 0) return;
    const id = String(current.node.attrs?.id || "");
    if (!id) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const target: EditorBlockTarget = {
      pos: current.pos,
      id,
      type: current.node.type.name,
      text: nodeText(current.node),
      json: current.node.toJSON(),
    };
    setCommandMenu(null);
    setActionMenu({ pos: current.pos, target, point: { left: rect.left, top: rect.bottom + 8 } });
  }, []);

  const beginBlockPointerDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const current = hoveredRef.current;
    if (!current || event.button !== 0) return;
    suppressGripClickRef.current = false;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      source: current,
      active: false,
    };
  }, []);

  const moveBlockPointerDrag = useCallback((event: PointerEvent) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 5) return;
      drag.active = true;
      suppressGripClickRef.current = true;
      const selection = NodeSelection.create(drag.source.editor.state.doc, drag.source.pos);
      drag.source.editor.view.dispatch(drag.source.editor.state.tr.setSelection(selection));
      setIsDraggingBlock(true);
    }

    event.preventDefault();
    const editorDom = drag.source.editor.view.dom;
    const sourceParent = drag.source.element.parentElement;
    const sourceIsListItem = drag.source.element.matches("li") && sourceParent?.matches("ul, ol");
    const blocks = sourceIsListItem && sourceParent
      ? Array.from(sourceParent.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches("li"))
      : Array.from(editorDom.children) as HTMLElement[];
    const shell = rootRef.current;
    if (!blocks.length || !shell) return;

    let targetElement = blocks[blocks.length - 1];
    let placeBefore = false;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        targetElement = block;
        placeBefore = true;
        break;
      }
    }

    const targetPos = nodePosForElement(drag.source.editor, targetElement);
    const targetNode = drag.source.editor.state.doc.nodeAt(targetPos);
    if (!targetNode) return;
    const insertPos = placeBefore ? targetPos : targetPos + targetNode.nodeSize;
    const indicatorY = placeBefore
      ? targetElement.getBoundingClientRect().top
      : targetElement.getBoundingClientRect().bottom;
    const nextTarget = {
      insertPos,
      top: indicatorY - shell.getBoundingClientRect().top,
    };
    dropTargetRef.current = nextTarget;
    setDropTarget(nextTarget);
  }, []);

  const finishBlockPointerDrag = useCallback((event: PointerEvent) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      pointerDragRef.current = null;
      return;
    }

    event.preventDefault();
    const target = dropTargetRef.current;
    const { editor: currentEditor, pos: sourcePos } = drag.source;
    const transaction = target
      ? moveBlockTransaction(currentEditor.state, sourcePos, target.insertPos)
      : null;
    if (transaction) {
      currentEditor.view.dispatch(transaction);
      currentEditor.commands.focus();
    }

    pointerDragRef.current = null;
    dropTargetRef.current = null;
    setIsDraggingBlock(false);
    setDropTarget(null);
    hoveredRef.current = null;
    setHoveredBlock(null);
  }, []);

  const cancelBlockPointerDrag = useCallback((event: PointerEvent) => {
    if (pointerDragRef.current?.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    dropTargetRef.current = null;
    suppressGripClickRef.current = false;
    setIsDraggingBlock(false);
    setDropTarget(null);
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", moveBlockPointerDrag, { capture: true, passive: false });
    window.addEventListener("pointerup", finishBlockPointerDrag, true);
    window.addEventListener("pointercancel", cancelBlockPointerDrag, true);
    return () => {
      window.removeEventListener("pointermove", moveBlockPointerDrag, true);
      window.removeEventListener("pointerup", finishBlockPointerDrag, true);
      window.removeEventListener("pointercancel", cancelBlockPointerDrag, true);
    };
  }, [cancelBlockPointerDrag, finishBlockPointerDrag, moveBlockPointerDrag]);

  if (!editor) return null;

  return (
    <div
      className="relative organize-editor-shell"
      ref={rootRef}
      onMouseMove={updateHoveredBlock}
      onMouseLeave={hideHoveredBlock}
    >
      <BubbleMenu editor={editor} tippyOptions={{ duration: 150, maxWidth: "none", zIndex: 50 }}>
        <BubbleToolbar editor={editor} onUploadImage={() => uploadImage()} onAddImageUrl={addImageUrl} onAddTable={addTable} onAddReference={() => addReadingReference()} />
      </BubbleMenu>
      <EditorContent editor={editor} />
      <div
        className="organize-block-handle"
        data-visible={hoveredBlock ? "true" : "false"}
        data-dragging={isDraggingBlock ? "true" : "false"}
        style={{ top: hoveredBlock?.top ?? 0 }}
        aria-hidden={!hoveredBlock}
      >
        <button
          type="button"
          className="organize-block-add"
          aria-label="在下方添加区块"
          title="点击在下方添加区块"
          tabIndex={hoveredBlock ? 0 : -1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertBlockBelow}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="organize-block-grip"
          aria-label="拖动区块或打开菜单"
          title="拖动以移动；点击打开菜单"
          tabIndex={hoveredBlock ? 0 : -1}
          draggable={false}
          onClick={openBlockActions}
          onPointerDown={beginBlockPointerDrag}
        >
          <span className="organize-grip-dots" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
          </span>
        </button>
      </div>
      {dropTarget && (
        <div className="organize-block-drop-indicator" style={{ top: dropTarget.top }} aria-hidden="true" />
      )}
      {commandMenu && <BlockCommandMenu editor={editor} pos={commandMenu.pos} point={commandMenu.point} onClose={closeMenus} />}
      {actionMenu && <BlockActionMenu editor={editor} noteId={noteId} target={actionMenu.target} point={actionMenu.point} skills={skills} commentCount={commentCounts[actionMenu.target.id] || 0} onClose={closeMenus} onPresent={(target) => setPresentationStart(target.id)} />}
      <EditorDialogs editor={editor} noteId={noteId} dialog={dialog} onClose={() => setDialog(null)} />
      {presentationStart && <PresentationMode doc={editor.getJSON()} startBlockId={presentationStart} onClose={() => setPresentationStart(null)} />}
    </div>
  );
}
