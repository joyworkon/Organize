"use client";

import "katex/dist/katex.min.css";
import { useEditor, EditorContent, BubbleMenu, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
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
import { ListBackspaceFix } from "./extensions/list-backspace";
import { HtmlEmbed } from "./extensions/html-embed";
import { SlashCommand } from "./extensions/slash-command";
import { BlockDeepLink } from "./extensions/deep-link";
import { TransformedBlockSelection } from "./extensions/block-selection";
import {
  BlockMultiSelect,
  blockSelectionBoundsForElement,
  getMultiSelectedBlocks,
  pointIsInsideBlockSelectionBounds,
  setMultiSelectedBlocks,
  setMultiSelectDragInProgress,
  type BlockSelectionRect,
} from "./extensions/block-multi-select";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BLOCK_ID_TYPES, findBlockById, isSameNodeSnapshot, moveBlockTransaction, nodeText } from "./block-utils";
import { BLOCK_COMMANDS } from "./block-commands";
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
  Columns as ColumnsIcon,
  Columns2,
  Columns3,
  Columns4,
} from "lucide-react";

interface EditorProps {
  noteId: string;
  noteTitle?: string;
  content: Record<string, unknown>;
  onUpdate: (content: Record<string, unknown>) => void;
  /** 编辑器实例就绪 / 销毁时回调，供页面标题与正文联动（T1/T2） */
  onEditorReady?: (editor: Editor | null) => void;
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
  ...([2, 3, 4, 5] as const).map((cols) => ({
    label: `${cols} 列`,
    icon: [Columns2, Columns3, Columns4, ColumnsIcon][cols - 2],
    isActive: (e: Editor) => e.isActive("columns", { cols }),
    action: (e: Editor) => convertToColumns(e, cols),
  })),
];

/** 「转换成 N 列」：把当前顶层块的内容转入第一列（与 6 点菜单的「转换成」同语义） */
function convertToColumns(editor: Editor, cols: number) {
  const command = BLOCK_COMMANDS.find((item) => item.id === `columns-${cols}`);
  if (!command) return;
  const { $from } = editor.state.selection;
  if ($from.depth < 1) return;
  command.run(editor, $from.before(1));
}

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
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(previousUrl ? "编辑链接 URL（留空可取消链接）" : "输入链接 URL", previousUrl || "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
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
  /** 由 "/" 触发时为 true：菜单执行/关闭时需清掉块里的触发字符 */
  slash?: boolean;
}

interface OpenActionState extends OpenMenuState {
  target: EditorBlockTarget;
}

interface HoveredBlock {
  editor: Editor;
  node: ProseMirrorNode;
  pos: number;
  top: number;
  left: number;
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

function blockElementAtTarget(editorDom: HTMLElement, target: HTMLElement, clientY: number) {
  const listItem = target.closest("li");
  if (listItem instanceof HTMLElement && editorDom.contains(listItem)) return listItem;

  // 指针落在列表的标记区 / 项目间隙（事件目标是 ul/ol 而不是 li）时，
  // 按垂直方向找最近的列表项。否则手柄会对准整个列表（列表节点没有块 id），
  // 表现为手柄上下乱跳、点击 6 点菜单毫无反应。
  const list = target.closest("ul, ol");
  if (list instanceof HTMLElement && editorDom.contains(list)) {
    const items = Array.from(list.querySelectorAll(":scope > li"));
    let best: HTMLElement | null = null;
    let bestDistance = Infinity;
    for (const item of items) {
      if (!(item instanceof HTMLElement)) continue;
      const rect = item.getBoundingClientRect();
      const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = item;
      }
    }
    if (best) return best;
  }

  let block: HTMLElement | null = target;
  while (block?.parentElement && block.parentElement !== editorDom) block = block.parentElement;
  return block?.parentElement === editorDom ? block : null;
}

/** 计算块手柄的垂直位置：与块内第一个文本块的首行居中对齐。 */
const HANDLE_HEIGHT = 22;
/** 手柄与块标记区（选中背景左缘）之间的间距，Notion 约 4px */
const HANDLE_GAP = 4;

const TEXTBLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, summary, pre";

function firstTextblockElement(block: HTMLElement): HTMLElement {
  return (block.matches(TEXTBLOCK_SELECTOR)
    ? block
    : block.querySelector(TEXTBLOCK_SELECTOR)) ?? block;
}

function handleTopForBlock(block: HTMLElement, shellRect: DOMRect): number {
  // 锚定到块内第一个文本块：列表项 / 待办项 / 折叠列表的外框会因外边距折叠、
  // 内边距而偏离首行文字，直接用外框会让手柄偏上几像素。
  const anchor = firstTextblockElement(block);
  const anchorRect = anchor.getBoundingClientRect();
  const anchorStyle = window.getComputedStyle(anchor);
  const parsedLineHeight = Number.parseFloat(anchorStyle.lineHeight);
  const paddingTop = Number.parseFloat(anchorStyle.paddingTop) || 0;
  const firstLineHeight = Number.isFinite(parsedLineHeight)
    ? Math.min(parsedLineHeight, anchorRect.height)
    : Math.min(HANDLE_HEIGHT + 6, anchorRect.height);
  return anchorRect.top + paddingTop - shellRect.top + Math.max(0, (firstLineHeight - HANDLE_HEIGHT) / 2);
}

/** 计算块手柄的水平位置：贴着块的视觉左缘，待办列表则贴着 checkbox 槽。 */
function handleLeftForBlock(block: HTMLElement, shellRect: DOMRect, handleWidth: number): number {
  let blockLeft = block.getBoundingClientRect().left;

  // TaskList 的顶层 ul 不占 checkbox 槽，真正的行从 li 的负 margin 开始。
  if (block.matches('ul[data-type="taskList"]')) {
    const anchor = firstTextblockElement(block);
    const textLeft = anchor.getBoundingClientRect().left;
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--organize-gutter");
    const gutter = Number.parseFloat(raw) || 24;
    blockLeft = textLeft - gutter;
  }

  return blockLeft - shellRect.left - HANDLE_GAP - handleWidth;
}

function menuPointBelowBlock(editor: Editor, pos: number, selectionPos: number): EditorMenuPoint {
  const blockDom = editor.view.nodeDOM(pos);
  if (blockDom instanceof HTMLElement) {
    const rect = blockDom.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + 6, anchorTop: rect.top };
  }
  const coords = editor.view.coordsAtPos(selectionPos);
  return { left: coords.left, top: coords.bottom + 6, anchorTop: coords.top };
}

export function TipTapEditor({ noteId, noteTitle = "", content, onUpdate, onEditorReady }: EditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
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
  const [blockSelectCount, setBlockSelectCount] = useState(0);
  const [selectRect, setSelectRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const selectDragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    /** 从文字上起拖：拖出起始块纵向范围才切换为块多选 */
    fromText: boolean;
    blockTop: number;
    blockBottom: number;
    bounds: BlockSelectionRect;
  } | null>(null);
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
      // level>0 的 summary 渲染为折叠标题样式（data-level，CSS 控制字号）
      DetailsSummary.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            level: {
              default: 0,
              parseHTML: (el) => Number((el as HTMLElement).getAttribute("data-level") || 0),
              renderHTML: (attrs) => (attrs.level ? { "data-level": String(attrs.level) } : {}),
            },
          };
        },
      }),
      Callout,
      InlineMath,
      MathBlock,
      MathCommands,
      Columns,
      Column,
      HtmlEmbed,
      SlashCommand,
      BlockDeepLink,
      TransformedBlockSelection,
      BlockMultiSelect,
      BlockStyle,
      ListBackspaceFix,
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
        // IME 组合态（如中文输入法选词）期间的按键不交给编辑器处理
        if (event.isComposing || event.keyCode === 229) return false;
        const { $from, empty } = view.state.selection;
        if (
          event.key === "Enter"
          && empty
          && $from.parent.type.name === "heading"
          && $from.parentOffset === $from.parent.content.size
        ) {
          event.preventDefault();
          const insertPos = $from.after($from.depth);
          const paragraph = view.state.schema.nodes.paragraph.create();
          const transaction = view.state.tr.insert(insertPos, paragraph);
          transaction.setSelection(
            TextSelection.near(transaction.doc.resolve(insertPos + 1), 1)
          );
          view.dispatch(transaction.scrollIntoView());
          return true;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "/") {
          event.preventDefault();
          // 仅顶层块打开块命令菜单；嵌套块（列表项/callout/引用内）直接忽略，
          // 否则 replaceBlock 会把整个顶层容器替换掉，吞掉其余内容
          if ($from.depth !== 1) return false;
          const pos = $from.before(1);
          const coords = view.coordsAtPos($from.pos);
          view.dispatch(view.state.tr.setSelection(view.state.selection));
          setActionMenu(null);
          setCommandMenu({ pos, point: { left: Math.max(12, coords.left), top: coords.bottom + 8, anchorTop: coords.top } });
          return true;
        }
        return false;
      },
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        if (event.metaKey || event.ctrlKey) {
          const anchor = (event.target as HTMLElement)?.closest("a");
          if (anchor instanceof HTMLAnchorElement) {
            const href = anchor.getAttribute("href");
            if (href) {
              event.preventDefault();
              window.open(href, "_blank", "noopener,noreferrer");
              return true;
            }
          }
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

  // 把编辑器实例上抛给页面（标题回车拆分等联动需要它），卸载时清空。
  useEffect(() => {
    onEditorReadyRef.current?.(editor ?? null);
    return () => onEditorReadyRef.current?.(null);
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

  // 「转换成 → 页面」：以块文本为标题创建子笔记，并把块替换为指向它的链接段落
  const convertBlockToPage = useCallback(async (pos: number) => {
    if (!editor) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const blockId = String(node.attrs?.id || "");
    if (!blockId) return;
    const title = node.textContent.trim() || "无标题笔记";
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        console.warn("[editor] 转换成页面失败", response.status);
        return;
      }
      const created = (await response.json()) as { id: string; title: string };
      // 创建期间块可能已被删除/移动：校验同位置的块仍是原来那个（按 block id）
      const current = editor.state.doc.nodeAt(pos);
      if (!current || String(current.attrs?.id || "") !== blockId) return;
      replaceAt(editor, pos, {
        type: "paragraph",
        content: [
          { type: "text", text: "📄 " },
          {
            type: "text",
            marks: [{ type: "link", attrs: { href: `/notes/${created.id}` } }],
            text: created.title,
          },
        ],
      });
    } catch (error) {
      console.warn("[editor] 转换成页面失败", error);
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const root = rootRef.current;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { type: string; pos?: number; target?: EditorBlockTarget; point?: EditorMenuPoint };
      if (typeof detail.pos === "number") {
        if (detail.type === "slash-menu" && detail.point) {
          setActionMenu(null);
          setCommandMenu({ pos: detail.pos, point: detail.point, slash: true });
        } else if (detail.type === "html") replaceAt(editor, detail.pos, { type: "htmlEmbed" });
        else if (detail.type === "ai-notes") setDialog({ type: "ai-notes", pos: detail.pos });
        else if (detail.type === "image") uploadImage(detail.pos);
        else if (detail.type === "math") {
          const latex = window.prompt("输入 LaTeX 公式，例如 E = mc^2");
          if (latex) replaceAt(editor, detail.pos, { type: "mathBlock", attrs: { latex } });
        } else if (detail.type === "reference") addReadingReference(detail.pos);
        else if (detail.type === "page") void convertBlockToPage(detail.pos);
      } else if (detail.target) {
        if (detail.type === "move") setDialog({ type: "move", target: detail.target });
        if (detail.type === "comment") setDialog({ type: "comment", target: detail.target });
        if (detail.type === "suggestion") setDialog({ type: "suggestion", target: detail.target });
        if (detail.type === "ask-ai") setDialog({ type: "ask-ai", target: detail.target });
      }
    };
    root?.addEventListener("organize-editor-action", handler);
    return () => root?.removeEventListener("organize-editor-action", handler);
  }, [addReadingReference, convertBlockToPage, editor, uploadImage]);

  useEffect(() => {
    let active = true;
    fetch(`/api/notes/${noteId}/comments`)
      .then((response) => response.ok ? response.json() : [])
      .then((threads) => {
        if (!active) return;
        const counts: Record<string, number> = {};
        for (const thread of threads) if (!thread.resolved_at) counts[thread.block_id] = (counts[thread.block_id] || 0) + 1;
        setCommentCounts(counts);
      })
      .catch(() => {});
    return () => { active = false; };
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
                // await 期间文档可能已变化，target.pos 会过期：按块 id 重新定位
                if (!editor) return;
                const found = findBlockById(editor.state.doc, target.id);
                if (!found) return;
                editor.chain().focus().insertContentAt(found.pos + found.node.nodeSize, { type: "paragraph", content: [{ type: "text", text: result }] }).run();
              }
            } else await (extension as ToolbarActionExtension).handler(context);
          },
        });
      }
    }
    return actions;
  }, [activePlugins, editor, noteId, noteTitle, pluginContexts]);

  const updateHoveredBlock = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || isDraggingBlock || selectDragRef.current?.active) return;
    const editorDom = editor.view.dom;
    const target = event.target as HTMLElement | null;

    if (!target || !editorDom.contains(target)) return;
    const block = blockElementAtTarget(editorDom, target, event.clientY);
    if (!block) return;

    const pos = nodePosForElement(editor, block);
    const node = editor.state.doc.nodeAt(pos);
    const shell = rootRef.current;
    if (!node || !shell) return;

    const shellRect = shell.getBoundingClientRect();
    const handleWidth = rootRef.current.querySelector(".organize-block-handle")?.clientWidth || 35;
    const next: HoveredBlock = {
      editor,
      node,
      pos,
      top: handleTopForBlock(block, shellRect),
      left: handleLeftForBlock(block, shellRect, handleWidth),
      element: block,
    };

    hoveredRef.current = next;
    setHoveredBlock((previous) => (
      previous?.pos === pos && Math.abs(previous.top - next.top) < 0.5 && previous.left === next.left ? previous : next
    ));
  }, [editor, isDraggingBlock]);

  // 文档可能已被菜单操作改写（转换成列表、拖拽移动等），而鼠标未再移动：
  // 此时 hoveredRef 里的 pos / node 已过期。点击 + / 6 点前按块 id 重新定位，
  // 避免插入点算错（新块插进当前内容里）或菜单作用到错误的块上。
  const resolveHoveredBlock = useCallback((): HoveredBlock | null => {
    const current = hoveredRef.current;
    if (!editor || !current) return current;
    const id = String(current.node.attrs?.id || "");
    if (!id) return current;
    const found = findBlockById(editor.state.doc, id);
    if (!found) {
      hoveredRef.current = null;
      setHoveredBlock(null);
      return null;
    }
    if (found.pos === current.pos) {
      // 位置没变：刷新 node 引用即可，避免重排手柄
      const next = { ...current, node: found.node };
      hoveredRef.current = next;
      return next;
    }
    const element = editor.view.nodeDOM(found.pos);
    const shell = rootRef.current;
    if (!(element instanceof HTMLElement) || !shell) return current;
    const shellRect = shell.getBoundingClientRect();
    const handleWidth = shell.querySelector(".organize-block-handle")?.clientWidth || 35;
    const next: HoveredBlock = {
      editor,
      node: found.node,
      pos: found.pos,
      top: handleTopForBlock(element, shellRect),
      left: handleLeftForBlock(element, shellRect, handleWidth),
      element,
    };
    hoveredRef.current = next;
    setHoveredBlock(next);
    return next;
  }, [editor]);

  // 文档变化后（输入 / 菜单操作）刷新一次手柄位置，避免手柄停留在过期位置
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      if (hoveredRef.current) resolveHoveredBlock();
    };
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor, resolveHoveredBlock]);

  const hideHoveredBlock = useCallback(() => {
    if (commandMenu || actionMenu || isDraggingBlock) return;
    hoveredRef.current = null;
    setHoveredBlock(null);
  }, [actionMenu, commandMenu, isDraggingBlock]);

  useEffect(() => {
    const hideWhenPointerLeavesEditor = (event: MouseEvent) => {
      const shell = rootRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const LEFT_GUTTER = 16;
      const inside =
        event.clientX >= rect.left - LEFT_GUTTER &&
        event.clientX <= rect.right + 8 &&
        event.clientY >= rect.top - 8 &&
        event.clientY <= rect.bottom + 8;
      if (!inside) hideHoveredBlock();
    };
    document.addEventListener("mousemove", hideWhenPointerLeavesEditor, true);
    return () => document.removeEventListener("mousemove", hideWhenPointerLeavesEditor, true);
  }, [hideHoveredBlock]);

  const insertBlockBelow = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const current = resolveHoveredBlock();
    if (!current || current.pos < 0) return;

    const isListItem = current.node.type.name === "listItem" || current.node.type.name === "taskItem";
    const emptyBlock = isListItem
      ? {
          type: current.node.type.name,
          ...(current.node.type.name === "taskItem" ? { attrs: { checked: false } } : {}),
          content: [{ type: "paragraph" }],
        }
      : { type: "paragraph" };
    // 按住 Option/Alt 点击：在上方插入（Notion 风格），只插入不弹菜单
    const above = event.altKey;
    const insertPos = above ? current.pos : current.pos + current.node.nodeSize;
    const textSelectionPos = insertPos + (isListItem ? 2 : 1);
    current.editor
      .chain()
      .focus()
      .insertContentAt(insertPos, emptyBlock)
      .setTextSelection(textSelectionPos)
      .run();
    if (above) {
      setActionMenu(null);
      setCommandMenu(null);
      return;
    }
    // 新块可能插在视口外（比如页底）。PM 的 tr.scrollIntoView 在编辑器尚无
    // DOM 焦点时不生效（TipTap 的 focus 命令是 rAF 异步的），这里直接滚到新块，
    // 再按它的真实位置锚定菜单
    const newBlockDom = current.editor.view.nodeDOM(insertPos);
    if (newBlockDom instanceof HTMLElement) {
      newBlockDom.scrollIntoView({ block: "nearest" });
    }
    setActionMenu(null);
    setCommandMenu({
      pos: insertPos,
      point: menuPointBelowBlock(current.editor, insertPos, textSelectionPos),
    });
  }, [resolveHoveredBlock]);

  const openBlockActions = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (suppressGripClickRef.current) {
      suppressGripClickRef.current = false;
      return;
    }
    const current = resolveHoveredBlock();
    if (!current || current.pos < 0) return;
    const id = String(current.node.attrs?.id || "");
    if (!id) return;

    // 让块进入 NodeSelection 选中态 → 触发 .ProseMirror-selectednode 样式（淡粉红背景）
    try {
      editor?.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, current.pos))
      );
    } catch {
      // 忽略：某些节点类型不支持 NodeSelection
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const target: EditorBlockTarget = {
      pos: current.pos,
      id,
      type: current.node.type.name,
      text: nodeText(current.node),
      json: current.node.toJSON(),
    };
    setCommandMenu(null);
    setActionMenu({
      pos: current.pos,
      target,
      point: {
        left: rect.left - 338,
        top: rect.top,
        anchorTop: current.element.getBoundingClientRect().top,
      },
    });
  }, [editor, resolveHoveredBlock]);

  const beginBlockPointerDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const current = resolveHoveredBlock();
    if (!current || event.button !== 0) return;
    suppressGripClickRef.current = false;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      source: current,
      active: false,
    };
  }, [resolveHoveredBlock]);

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

  /* ------------------------- 拖拽块多选 ------------------------- */

  // 两种起点都算框选：
  // 1）编辑器空白 / 块间隙 / 左侧 gutter（事件目标是 editorDom 本身）→ 直接框选；
  // 2）文字上（图3 的 Notion 方式）→ 先让浏览器做原生文本选择，一旦拖出起始块的
  //    纵向范围就切换为块多选（清掉文本选区、画选择矩形）。
  const beginSelectDrag = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || event.button !== 0) return;
    if (commandMenu || actionMenu) return;
    const target = event.target as HTMLElement;
    if (target.closest(".organize-block-handle")) return;
    const editorDom = editor.view.dom;
    if (!editorDom.contains(target)) return;
    const bounds = blockSelectionBoundsForElement(editorDom);
    if (!pointIsInsideBlockSelectionBounds(bounds, event.clientX, event.clientY)) return;
    if (target === editorDom) {
      // 空白区：阻止浏览器开始文本选择 / 放置光标（拖动期间的选区同步会清掉多选状态）
      event.preventDefault();
      selectDragRef.current = { startX: event.clientX, startY: event.clientY, active: false, fromText: false, blockTop: 0, blockBottom: 0, bounds };
      return;
    }
    // 文字区：记录起始块，拖出它的纵向范围后再切换
    const block = blockElementAtTarget(editorDom, target, event.clientY);
    if (!block) return;
    const rect = block.getBoundingClientRect();
    selectDragRef.current = { startX: event.clientX, startY: event.clientY, active: false, fromText: true, blockTop: rect.top, blockBottom: rect.bottom, bounds };
  }, [actionMenu, commandMenu, editor]);

  const moveSelectDrag = useCallback((event: MouseEvent) => {
    const drag = selectDragRef.current;
    if (!drag || !editor) return;
    if (!pointIsInsideBlockSelectionBounds(drag.bounds, event.clientX, event.clientY)) {
      if (drag.active) {
        window.getSelection()?.removeAllRanges();
        setSelectRect(null);
        setMultiSelectedBlocks(editor, []);
      }
      return;
    }
    if (!drag.active) {
      if (drag.fromText) {
        // 还在起始块内部：保持原生文本选择
        if (event.clientY >= drag.blockTop && event.clientY <= drag.blockBottom) return;
      } else if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) {
        return;
      }
      drag.active = true;
      setMultiSelectDragInProgress(true);
      // 冻结文本选择（Notion 切换到块选择时的表现）
      editor.view.dom.style.userSelect = "none";
      hoveredRef.current = null;
      setHoveredBlock(null);
    }
    // 浏览器的拖选以 mousedown 为锚点会在拖动中持续扩展文本选区，
    // 块多选激活期间每一帧都清掉它，避免文字高亮和块高亮打架
    window.getSelection()?.removeAllRanges();
    const top = Math.min(drag.startY, event.clientY);
    const bottom = Math.max(drag.startY, event.clientY);
    const left = Math.min(drag.startX, event.clientX);
    const right = Math.max(drag.startX, event.clientX);
    setSelectRect({ left, top, width: right - left, height: bottom - top });
    const positions: number[] = [];
    for (const child of Array.from(editor.view.dom.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const rect = child.getBoundingClientRect();
      if (rect.bottom < top || rect.top > bottom) continue;
      // 从 gutter/空白起拖按行选（纵向命中即可）；从文字起拖按矩形相交
      if (!drag.fromText || (rect.right >= left && rect.left <= right)) {
        positions.push(nodePosForElement(editor, child));
      }
    }
    setMultiSelectedBlocks(editor, positions);
  }, [editor]);

  const finishSelectDrag = useCallback((event: MouseEvent) => {
    const drag = selectDragRef.current;
    selectDragRef.current = null;
    if (!editor || !drag) return;
    if (drag.active) {
      // 拖动结束：恢复可选中，保留块多选高亮
      editor.view.dom.style.userSelect = "";
      setMultiSelectDragInProgress(false);
      setSelectRect(null);
      if (!pointIsInsideBlockSelectionBounds(drag.bounds, event.clientX, event.clientY)) {
        setMultiSelectedBlocks(editor, []);
      }
      return;
    }
    // 只是点击（没拖起来）：清空多选
    setMultiSelectedBlocks(editor, []);
    // Notion 风格：点击正文末尾下方的空白区域，把光标放到最后一行；
    // 最后一个块不是文本块（图片/表格等）时先补一个空段落
    const editorDom = editor.view.dom;
    if (!pointIsInsideBlockSelectionBounds(drag.bounds, event.clientX, event.clientY)) return;
    const lastChild = editorDom.lastElementChild;
    if (lastChild && event.clientY > lastChild.getBoundingClientRect().bottom) {
      const lastNode = editor.state.doc.lastChild;
      if (lastNode && !lastNode.isTextblock) {
        const end = editor.state.doc.content.size;
        editor
          .chain()
          .focus()
          .insertContentAt(end, { type: "paragraph" })
          .setTextSelection(end + 1)
          .run();
      } else {
        editor.commands.focus("end");
      }
    }
  }, [editor]);

  useEffect(() => {
    window.addEventListener("mousemove", moveSelectDrag, true);
    window.addEventListener("mouseup", finishSelectDrag, true);
    return () => {
      window.removeEventListener("mousemove", moveSelectDrag, true);
      window.removeEventListener("mouseup", finishSelectDrag, true);
      selectDragRef.current = null;
      setMultiSelectDragInProgress(false);
      if (editor) editor.view.dom.style.userSelect = "";
    };
  }, [editor, finishSelectDrag, moveSelectDrag]);

  // 多选状态同步到 React（隐藏光标用）；插件在输入/点击时会自动清空，这里跟随
  useEffect(() => {
    if (!editor) return;
    const sync = () => setBlockSelectCount(getMultiSelectedBlocks(editor).length);
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div
      className="relative organize-editor-shell"
      ref={rootRef}
      onMouseMove={updateHoveredBlock}
      onMouseDown={beginSelectDrag}
      data-block-selecting={blockSelectCount > 0 ? "true" : "false"}
    >
      <BubbleMenu editor={editor} tippyOptions={{ duration: 150, maxWidth: "none", zIndex: 50 }}>
        <BubbleToolbar editor={editor} onUploadImage={() => uploadImage()} onAddImageUrl={addImageUrl} onAddTable={addTable} onAddReference={() => addReadingReference()} />
      </BubbleMenu>
      <EditorContent editor={editor} />
      <div
        className="organize-block-handle"
        data-visible={hoveredBlock ? "true" : "false"}
        data-dragging={isDraggingBlock ? "true" : "false"}
        style={{ top: hoveredBlock?.top ?? 0, left: hoveredBlock?.left ?? 1 }}
        aria-hidden={!hoveredBlock}
      >
        <button
          type="button"
          className="organize-block-add"
          aria-label="在下方添加区块"
          data-tooltip={"点击以在下方添加块\n按住 Option 键点击以在上方添加块"}
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
          data-tooltip={"拖动以移动\n点击 或 ⌘/ 打开菜单"}
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
      {selectRect && <div className="organize-select-rect" style={selectRect} aria-hidden="true" />}
      {commandMenu && <BlockCommandMenu editor={editor} pos={commandMenu.pos} point={commandMenu.point} clearTrigger={Boolean(commandMenu.slash)} onClose={closeMenus} />}
      {actionMenu && <BlockActionMenu editor={editor} noteId={noteId} target={actionMenu.target} point={actionMenu.point} skills={skills} commentCount={commentCounts[actionMenu.target.id] || 0} onClose={closeMenus} onPresent={(target) => setPresentationStart(target.id)} />}
      <EditorDialogs editor={editor} noteId={noteId} dialog={dialog} onClose={() => setDialog(null)} />
      {presentationStart && <PresentationMode doc={editor.getJSON()} startBlockId={presentationStart} onClose={() => setPresentationStart(null)} />}
    </div>
  );
}
