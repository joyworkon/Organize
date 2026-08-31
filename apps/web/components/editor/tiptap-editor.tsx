"use client";

import "katex/dist/katex.min.css";
import { useEditor, EditorContent, BubbleMenu, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import type { JSONContent } from "@tiptap/core";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TaskItemLinked } from "./extensions/task-item-linked";
import Details from "@tiptap/extension-details";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import { Callout } from "./extensions/callout";
import { InlineMath, MathBlock, MathCommands } from "./extensions/math";
import { Columns, Column } from "./extensions/columns";
import { BlockStyle, BLOCK_BACKGROUND_TYPES } from "./extensions/block-style";
import { ListBackspaceFix } from "./extensions/list-backspace";
import { ListStyleExtension } from "./extensions/list-style";
import {
  createTableContent,
  getActiveTable,
  OrganizeTable,
  OrganizeTableCell,
  OrganizeTableHeader,
  OrganizeTableRow,
  OrganizeTableView,
  topLevelBlockPlaceholder,
} from "./extensions/table-style";
import { HtmlEmbed } from "./extensions/html-embed";
import { ResizableImage } from "./extensions/resizable-image";
import { FileAttachment } from "./extensions/file-attachment";
import { TableOfContents } from "./extensions/table-of-contents";
import { Breadcrumb } from "./extensions/breadcrumb";
import { ButtonBlock } from "./extensions/button-node";
import { Tabs, Tab } from "./extensions/tabs-node";
import { Mermaid } from "./extensions/mermaid-node";
import { Embed } from "./extensions/embed";
import { SyncedBlock } from "./extensions/synced-block";
import { createSyncedBlockAt } from "./extensions/synced-block-client";
import { DatabaseBlock } from "./extensions/database-block";
import { insertInlineDatabase, insertPageDatabase, insertLinkedDatabase } from "./extensions/database-block-client";
import { SlashCommand } from "./extensions/slash-command";
import { BlockDeepLink } from "./extensions/deep-link";
import {
  InternalLinkStateDecorations,
  internalLinkStateKey,
} from "./extensions/internal-link-state";
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
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { cn } from "@/lib/utils";
import { BLOCK_ID_TYPES, findBlockById, isSameNodeSnapshot, moveBlockTransaction, nodeText } from "./block-utils";
import { BLOCK_COMMANDS } from "./block-commands";
import { BlockCommandMenu } from "./block-command-menu";
import { BlockActionMenu, type EditorSkillAction } from "./block-action-menu";
import { EditorDialogs } from "./editor-dialogs";
import { EditorPopover } from "./editor-popover";
import { PresentationMode } from "./presentation-mode";
import { TableGridPicker, TableToolbar } from "./table-controls";
import { TableDirectControls } from "./table-direct-controls";
import type { EditorBlockTarget, EditorDialog, EditorMenuPoint } from "./types";
import { usePluginStore } from "@/lib/plugin/store";
import type { AIActionExtension, PluginContext, ToolbarActionExtension } from "@organize/plugin-sdk";
import {
  internalLinkKeyFromHref,
  type InternalLinkStateRow,
} from "@/lib/note-links";
import { createClient } from "@/lib/supabase/client";
import { createNewNote } from "@/lib/notes/create-note";
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
  Paperclip,
  Undo2,
  Redo2,
  RemoveFormatting,
  Palette,
  Columns as ColumnsIcon,
  Columns2,
  Columns3,
  Columns4,
} from "lucide-react";

/** 事务来源分类（见 docs/g0-protocol.md §4）。 */
export type TransactionSource =
  | "user"
  | "hydrate"
  | "remote-sync"
  | "version-restore"
  | "backup-restore";

interface EditorProps {
  noteId: string;
  noteTitle?: string;
  content: Record<string, unknown>;
  /**
   * 内容变化回调。
   * @param content 编辑器 JSON
   * @param source 变更来源：
   *   - "user":用户主动编辑（键盘/鼠标/命令）——G2/G3 会激活 legacy、生成 task mutation、进 Undo
   *   - "hydrate":打开笔记初始加载
   *   - "remote-sync":Realtime 远端推入（G3 引入）
   *   - "version-restore":版本恢复
   *   - "backup-restore":备份恢复
   *   系统事务（非 user）不得激活 legacy、不得生成 mutation、不得进 Undo（见 docs/g0-protocol.md §4）。
   */
  onUpdate: (content: Record<string, unknown>, source: TransactionSource) => void;
  /** 编辑器实例就绪 / 销毁时回调，供页面标题与正文联动（T1/T2） */
  onEditorReady?: (editor: Editor | null) => void;
  /** 笔记树（含 parent_note_id），供路径栏(Breadcrumb)块渲染父级链；不传则该块显示占位 */
  noteTree?: { id: string; title: string | null; icon: string | null; parent_note_id: string | null }[];
  /** 当前正文内站内链接的受控状态；删除/缺失目标不可继续导航。 */
  internalLinkStates?: Record<string, InternalLinkStateRow>;
  /** 只读模式（协作 viewer）：编辑器不可输入，默认 true 不影响单用户链路 */
  editable?: boolean;
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
      void showPrompt({ title: "输入 LaTeX 公式", placeholder: "例如 E = mc^2" }).then((latex) => {
        if (latex) e.chain().focus().insertMathBlock(latex).run();
      });
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

const BUBBLE_TEXT_COLORS = [
  { label: "默认", value: null },
  { label: "灰色", value: "#787774" },
  { label: "棕色", value: "#9f6b53" },
  { label: "橙色", value: "#d9730d" },
  { label: "黄色", value: "#cb912f" },
  { label: "绿色", value: "#448361" },
  { label: "蓝色", value: "#337ea9" },
  { label: "紫色", value: "#9065b0" },
  { label: "红色", value: "#d44c47" },
] as const;

const BUBBLE_BACKGROUNDS = [
  { label: "无背景", value: null },
  { label: "灰色背景", value: "rgba(120,119,116,.12)" },
  { label: "棕色背景", value: "rgba(159,107,83,.14)" },
  { label: "橙色背景", value: "rgba(217,115,13,.14)" },
  { label: "黄色背景", value: "rgba(203,145,47,.16)" },
  { label: "绿色背景", value: "rgba(68,131,97,.14)" },
  { label: "蓝色背景", value: "rgba(51,126,169,.14)" },
  { label: "紫色背景", value: "rgba(144,101,176,.14)" },
  { label: "红色背景", value: "rgba(212,76,71,.14)" },
] as const;

function ColorMenuRow({ label, swatch, onClick }: { label: string; swatch: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
    >
      {swatch}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

/** 气泡工具栏的「颜色」菜单：文字颜色 / 文字背景（高亮）/ 块背景 */
function BubbleColorMenu({ editor, close }: { editor: Editor; close: () => void }) {
  // 块背景作用于选区覆盖到的所有最外层可着色块；setNodeMarkup 不改节点大小，位置稳定
  const applyBlockBackground = (color: string | null) => {
    const { from, to } = editor.state.selection;
    const tr = editor.state.tr;
    let changed = false;
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (BLOCK_BACKGROUND_TYPES.has(node.type.name)) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: color });
        changed = true;
        return false;
      }
      return true;
    });
    if (changed) editor.view.dispatch(tr);
  };
  return (
    <div className="max-h-96 w-52 overflow-y-auto">
      <div className="px-2.5 pb-1 pt-1.5 text-xs text-muted-foreground">文字颜色</div>
      {BUBBLE_TEXT_COLORS.map((color) => (
        <ColorMenuRow
          key={`text-${color.label}`}
          label={color.label}
          swatch={<span className="color-swatch text-swatch" style={{ color: color.value || "inherit" }}>A</span>}
          onClick={() => {
            if (color.value) editor.chain().focus().setColor(color.value).run();
            else editor.chain().focus().unsetColor().run();
            close();
          }}
        />
      ))}
      <div className="px-2.5 pb-1 pt-2 text-xs text-muted-foreground">文字背景</div>
      {BUBBLE_BACKGROUNDS.map((color) => (
        <ColorMenuRow
          key={`hl-${color.label}`}
          label={color.label}
          swatch={<span className="color-swatch" style={{ background: color.value || "transparent" }} />}
          onClick={() => {
            if (color.value) editor.chain().focus().setHighlight({ color: color.value }).run();
            else editor.chain().focus().unsetHighlight().run();
            close();
          }}
        />
      ))}
      <div className="px-2.5 pb-1 pt-2 text-xs text-muted-foreground">块背景</div>
      {BUBBLE_BACKGROUNDS.map((color) => (
        <ColorMenuRow
          key={`block-${color.label}`}
          label={color.label}
          swatch={<span className="color-swatch" style={{ background: color.value || "transparent" }} />}
          onClick={() => {
            applyBlockBackground(color.value);
            close();
          }}
        />
      ))}
    </div>
  );
}

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
  onUploadAttachment,
  onAddTable,
  onAddReference,
}: {
  editor: Editor;
  onUploadImage: () => void;
  onAddImageUrl: () => void;
  onUploadAttachment: () => void;
  onAddTable: (rows: number, cols: number) => void;
  onAddReference: () => void;
}) {
  const activeBlock = getActiveBlock(editor);
  const ActiveBlockIcon = activeBlock.icon;

  const addLink = () => {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    void showPrompt({
      title: previousUrl ? "编辑链接 URL（留空可取消链接）" : "输入链接 URL",
      defaultValue: previousUrl || "",
      placeholder: "https://",
    }).then((url) => {
      if (url === null) return;
      if (url === "") {
        editor.chain().focus().unsetLink().run();
      } else {
        editor.chain().focus().setLink({ href: url }).run();
      }
    });
  };

  const addInlineMath = () => {
    void showPrompt({ title: "输入 LaTeX 公式", placeholder: "例如 a^2 + b^2 = c^2" }).then((latex) => {
      if (latex) {
        editor.chain().focus().insertInlineMath(latex).run();
      }
    });
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

      {/* 颜色：文字颜色 / 文字背景 / 块背景 */}
      <Dropdown
        trigger={(open) => (
          <button
            type="button"
            title="颜色"
            className={cn(
              "rounded p-1.5 transition-colors hover:bg-accent",
              open || editor.isActive("highlight") || editor.getAttributes("textStyle").color
                ? "bg-accent text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Palette className="h-4 w-4" />
          </button>
        )}
      >
        {(close) => <BubbleColorMenu editor={editor} close={close} />}
      </Dropdown>

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
          <InsertMenu
            onUploadImage={() => {
              onUploadImage();
              close();
            }}
            onAddImageUrl={() => {
              onAddImageUrl();
              close();
            }}
            onUploadAttachment={() => {
              onUploadAttachment();
              close();
            }}
            onAddTable={(rows, cols) => {
              onAddTable(rows, cols);
              close();
            }}
            onAddReference={() => {
              onAddReference();
              close();
            }}
          />
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

function InsertMenu({
  onUploadImage,
  onAddImageUrl,
  onUploadAttachment,
  onAddTable,
  onAddReference,
}: {
  onUploadImage: () => void;
  onAddImageUrl: () => void;
  onUploadAttachment: () => void;
  onAddTable: (rows: number, cols: number) => void;
  onAddReference: () => void;
}) {
  const [view, setView] = useState<"main" | "table">("main");
  if (view === "table") {
    return (
      <div className="table-grid-submenu">
        <button
          type="button"
          className="table-grid-back"
          onClick={() => setView("main")}
        >
          <ChevronDown className="h-4 w-4 rotate-90" />
          <span>返回插入菜单</span>
        </button>
        <TableGridPicker onSelect={onAddTable} />
      </div>
    );
  }
  return (
    <>
      <MenuItem icon={Upload} label="上传图片" onClick={onUploadImage} />
      <MenuItem icon={ImageIcon} label="图片 URL" onClick={onAddImageUrl} />
      <MenuItem icon={Paperclip} label="上传附件" onClick={onUploadAttachment} />
      <button
        type="button"
        className="table-insert-menu-item"
        onClick={() => setView("table")}
      >
        <TableIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>表格</span>
        <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground" />
      </button>
      <MenuItem icon={Bookmark} label="引用阅读条目" onClick={onAddReference} />
    </>
  );
}

/* ------------------------------- 编辑器 ------------------------------- */

interface OpenMenuState {
  pos: number;
  point: EditorMenuPoint;
  /** 由 "/" 触发时为 true：菜单执行/关闭时需清掉块里的触发字符 */
  slash?: boolean;
  /** 嵌套场景（表格/列表内等）：在当前位置插入而非替换顶层块 */
  nested?: boolean;
  /** 斜杠命令触发时的文本范围，用于删除 "/" 字符 */
  range?: { from: number; to: number };
}

interface OpenActionState extends OpenMenuState {
  target: EditorBlockTarget;
}

type OpenTablePickerState = OpenMenuState;

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

  // 折叠列表 / 折叠标题的内容区：里面的直接子块是独立块（hover 出手柄、
  // 可拖拽排序、6 点菜单作用在单个块上），而不是整体算到外层折叠块上。
  // 嵌套折叠时 closest 取到最内层内容区，符合"最贴近指针的块"直觉。
  const detailsContent = target.closest('div[data-type="detailsContent"]');
  if (detailsContent instanceof HTMLElement && editorDom.contains(detailsContent)) {
    let inner: HTMLElement | null = target;
    while (inner?.parentElement && inner.parentElement !== detailsContent) inner = inner.parentElement;
    if (inner?.parentElement === detailsContent) return inner;
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
  // 标注块（callout）：手柄与块上边对齐（锚定顶部 emoji 图标），
  // 不随多行内容垂直居中。
  const callout = block.matches("[data-callout]")
    ? block
    : block.querySelector("[data-callout]");
  if (callout instanceof HTMLElement) {
    const emoji = callout.querySelector(".callout-emoji");
    const iconRect = (emoji instanceof HTMLElement ? emoji : callout).getBoundingClientRect();
    return iconRect.top - shellRect.top + Math.max(0, (iconRect.height - HANDLE_HEIGHT) / 2);
  }
  // 选项卡：ReactNodeViewRenderer 会在 [data-tabs] 外再包一层 .react-renderer，
  // 悬停解析出的块是外层包装，故用 :scope 直接子选择器向下找一层。
  // 顶部是 contentEditable=false 的标签栏，块内第一个文本块在标签栏之下，
  // 按通用规则手柄会偏到内容区第一行；改为锚定标签栏，与块顶部对齐。
  const tabs = block.matches("[data-tabs]")
    ? block
    : block.querySelector(":scope > [data-tabs]");
  if (tabs instanceof HTMLElement) {
    const bar = tabs.querySelector(".organize-tabs-bar");
    const barRect = (bar instanceof HTMLElement ? bar : tabs).getBoundingClientRect();
    return barRect.top - shellRect.top + Math.max(0, (barRect.height - HANDLE_HEIGHT) / 2);
  }
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

  // 普通项目符号 / 编号列表的 li 左缘是正文轴，原生 marker 位于父列表的 gutter。
  // 手柄贴父列表左缘，避免与圆点或序号重叠。TaskItem 的 li 已包含 checkbox 槽。
  if (block.matches("li") && !block.parentElement?.matches('ul[data-type="taskList"]')) {
    blockLeft = block.parentElement?.getBoundingClientRect().left ?? blockLeft;
  }

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

function pointIsOverRenderedText(block: HTMLElement, clientX: number, clientY: number): boolean {
  const anchor = firstTextblockElement(block);
  if (!anchor.textContent) return false;
  const range = document.createRange();
  range.selectNodeContents(anchor);
  return Array.from(range.getClientRects()).some((rect) => (
    clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom
  ));
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

function activeTableReferenceRect(editor: Editor) {
  const table = getActiveTable(editor);
  if (!table) return editor.view.dom.getBoundingClientRect();
  const dom = editor.view.nodeDOM(table.pos);
  const tableElement = dom instanceof HTMLTableElement
    ? dom
    : dom instanceof HTMLElement
      ? dom.querySelector("table")
      : null;
  return tableElement?.getBoundingClientRect()
    ?? editor.view.dom.getBoundingClientRect();
}

function shouldShowTextToolbar({
  editor,
  element,
  view,
  state,
  from,
  to,
}: {
  editor: Editor;
  element: HTMLElement;
  view: EditorView;
  state: EditorState;
  from: number;
  to: number;
}) {
  const { doc, selection } = state;
  if (selection instanceof CellSelection) return false;

  const isEmptyTextBlock = !doc.textBetween(from, to).length
    && selection instanceof TextSelection;
  const isChildOfMenu = element.contains(document.activeElement);
  const hasEditorFocus = view.hasFocus() || isChildOfMenu;

  return hasEditorFocus
    && !selection.empty
    && !isEmptyTextBlock
    && editor.isEditable;
}

export function TipTapEditor({
  noteId,
  noteTitle = "",
  content,
  onUpdate,
  onEditorReady,
  noteTree,
  internalLinkStates = {},
  editable = true,
}: EditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const initialContentRef = useRef(content);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const internalLinkStatesRef = useRef(internalLinkStates);
  internalLinkStatesRef.current = internalLinkStates;
  const hoveredRef = useRef<HoveredBlock | null>(null);
  const pointerDragRef = useRef<BlockPointerDrag | null>(null);
  const dropTargetRef = useRef<BlockDropTarget | null>(null);
  const suppressGripClickRef = useRef(false);
  const [hoveredBlock, setHoveredBlock] = useState<HoveredBlock | null>(null);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);
  const [dropTarget, setDropTarget] = useState<BlockDropTarget | null>(null);
  const [commandMenu, setCommandMenu] = useState<OpenMenuState | null>(null);
  const [actionMenu, setActionMenu] = useState<OpenActionState | null>(null);
  const [tablePicker, setTablePicker] = useState<OpenTablePickerState | null>(null);
  const [tableFullscreen, setTableFullscreen] = useState(false);
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
      ListStyleExtension,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      ResizableImage.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: topLevelBlockPlaceholder }),
      TaskList,
      TaskItemLinked.configure({ nested: true }),
      OrganizeTable.configure({
        resizable: true,
        allowTableNodeSelection: true,
        lastColumnResizable: true,
        cellMinWidth: 48,
        View: OrganizeTableView,
      }),
      OrganizeTableRow,
      OrganizeTableCell,
      OrganizeTableHeader,
      // persist: 展开/收起状态写入文档（刷新后保持）；默认展开，
      // 新建折叠块直接进入可编辑状态，旧文档里没有 open 属性的折叠块也会展开显示。
      Details.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            open: {
              default: true,
              parseHTML: (el) => (el as HTMLElement).hasAttribute("open"),
              renderHTML: ({ open }) => (open ? { open: "" } : {}),
            },
          };
        },
      }).configure({ persist: true }),
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
    FileAttachment,
    TableOfContents,
    Breadcrumb,
    ButtonBlock,
    Tabs,
    Tab,
    Mermaid,
    Embed,
    SyncedBlock,
    DatabaseBlock,
      SlashCommand,
      BlockDeepLink,
      InternalLinkStateDecorations.configure({
        getStates: () => internalLinkStatesRef.current,
      }),
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
    onUpdate: ({ editor, transaction }) => {
      // 仅用于强制 NodeView 刷新的无内容变化事务，不触发上层 onUpdate/自动保存
      if (transaction.getMeta("breadcrumb:storage-refresh")) return;
      // 从 transaction meta 读来源；无 meta（用户键盘/鼠标操作）= "user"
      const source = (transaction.getMeta("transactionSource") as TransactionSource) || "user";
      onUpdateRef.current(editor.getJSON(), source);
    },
    editorProps: {
      attributes: {
        // 正文 16px（sm 以下 prose-sm）：与阅读页 17px/1.8 有意区分——编辑态需要操作密度
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
        // ⌘F / Ctrl+F：编辑器聚焦时打开页面内块搜索（覆盖浏览器查找）
        if ((event.metaKey || event.ctrlKey) && (event.key === "f" || event.key === "F")) {
          event.preventDefault();
          setDialog({ type: "search" });
          return true;
        }
        return false;
      },
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        const anchor = (event.target as HTMLElement)?.closest("a");
        if (!(anchor instanceof HTMLAnchorElement)) return false;
        const href = anchor.getAttribute("href");
        if (!href) return false;
        const linkStateKey = internalLinkKeyFromHref(href);
        const linkState = linkStateKey ? internalLinkStatesRef.current[linkStateKey] : null;
        if (linkState && linkState.state !== "active") {
          event.preventDefault();
          toast({
            title: linkState.state === "deleted" ? "链接目标已在垃圾箱中" : "链接目标不存在或无权访问",
            variant: "destructive",
          });
          return true;
        }
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        // 站内链接（如「转换成页面」/ 拖入子页面产生的 /notes/<id>）单击直接跳转
        if (href.startsWith("/")) {
          event.preventDefault();
          router.push(href);
          return true;
        }
        return false;
      },
      // 从编辑器外拖入文件（图片 / 视频 / 音频 / 附件）
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void insertFilesRef.current(files, coords?.pos);
        return true;
      },
      // 粘贴文件（截图、从文件管理器复制的文件）
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        void insertFilesRef.current(files);
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(internalLinkStateKey, true));
  }, [editor, internalLinkStates]);

  // 协作 viewer 只读：角色变化（含挂载时序）都同步到编辑器实例
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

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

  // 路径栏(Breadcrumb)块通过 editor.storage 读取当前页 id/标题与笔记树，
  // 避免在块内做网络请求；父级链由编辑器外算好后注入。
  useEffect(() => {
    if (!editor) return;
    editor.storage.breadcrumb = {
      noteId,
      noteTitle,
      noteTree: noteTree || [],
    };
    // storage 变化不会产生事务，NodeView 不会自动重渲染（路径栏块可能
    // 长期显示"当前页位于顶层"，直到用户敲字）。派发一个无内容变化的
    // meta 事务，强制订阅了编辑器更新的 NodeView 刷新。
    editor.view.dispatch(editor.state.tr.setMeta("breadcrumb:storage-refresh", true));
  }, [editor, noteId, noteTitle, noteTree]);

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
      // 系统操作（补 block id）：打 hydrate meta，使 onUpdate 读到非 user 来源，
      // 不激活 legacy / 不进 Undo（见 docs/g0-protocol.md §4）
      transaction = transaction.setMeta("transactionSource", "hydrate");
      editor.view.dispatch(transaction);
      onUpdateRef.current(editor.getJSON(), "hydrate");
      return;
    }
    const upgraded = editor.getJSON();
    if (!isSameNodeSnapshot(upgraded, initialContentRef.current)) {
      onUpdateRef.current(upgraded, "hydrate");
    }
  }, [editor]);

  const insertImage = useCallback((url: string, pos?: number, nested?: boolean, range?: { from: number; to: number }) => {
    if (!editor) return;
    if (nested && range) {
      editor.chain().focus().deleteRange(range).insertContent({ type: "image", attrs: { src: url } }).run();
    } else if (pos === undefined) {
      editor.chain().focus().setImage({ src: url }).run();
    } else {
      replaceAt(editor, pos, { type: "image", attrs: { src: url } });
    }
  }, [editor]);

  const uploadImage = useCallback((pos?: number, nested?: boolean, range?: { from: number; to: number }) => {
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
        insertImage(data.url, pos, nested, range);
      } catch {
        const reader = new FileReader();
        reader.onload = () => insertImage(String(reader.result), pos, nested, range);
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [editor, insertImage]);

  // 从外部拖入 / 粘贴 / 菜单选择的文件：图片插入图片块，其余作为附件块（视频/音频内联播放）
  const insertFiles = useCallback(async (files: File[], pos?: number) => {
    if (!editor || !files.length) return;
    const nodes: JSONContent[] = [];
    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "上传失败");
        nodes.push(
          isImage
            ? { type: "image", attrs: { src: data.url as string } }
            : {
                type: "fileAttachment",
                attrs: {
                  src: data.url as string,
                  name: (data.name as string) || file.name,
                  size: typeof data.size === "number" ? data.size : file.size,
                  mime: (data.mime as string) || file.type,
                },
              }
        );
      } catch (error) {
        if (isImage) {
          // 上传接口不可用时图片回退为 base64 内联（与 uploadImage 一致）
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => resolve("");
            reader.readAsDataURL(file);
          });
          if (dataUrl) nodes.push({ type: "image", attrs: { src: dataUrl } });
        } else {
          console.warn("[editor] 附件上传失败", error);
          toast({
            title: `「${file.name}」上传失败`,
            description: error instanceof Error ? error.message : "请稍后重试",
            variant: "destructive",
          });
        }
      }
    }
    if (!nodes.length) return;
    if (pos === undefined) {
      editor.chain().focus().insertContent(nodes).run();
      return;
    }
    try {
      editor.chain().focus().insertContentAt(pos, nodes).run();
    } catch {
      // 落点放不下块级内容（如表格单元格内）时追加到文末
      editor.chain().focus("end").insertContent(nodes).run();
    }
  }, [editor]);

  // editorProps 在编辑器初始化时定型，通过 ref 拿到最新的 insertFiles
  const insertFilesRef = useRef(insertFiles);
  insertFilesRef.current = insertFiles;

  const uploadAttachment = useCallback(() => {
    if (!editor) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length) void insertFiles(files);
    };
    input.click();
  }, [editor, insertFiles]);

  const addImageUrl = useCallback(() => {
    void showPrompt({ title: "输入图片 URL", placeholder: "https://" }).then((url) => {
      if (url) insertImage(url);
    });
  }, [insertImage]);

  const addReadingReference = useCallback((pos?: number) => {
    if (!editor) return;
    void showPrompt({ title: "输入要引用的阅读条目 URL", placeholder: "https://" }).then((url) => {
      if (!url) return;
      const paragraph = {
        type: "paragraph",
        content: [
          { type: "text", text: "📖 参考: " },
          { type: "text", marks: [{ type: "link", attrs: { href: url } }], text: url },
        ],
      };
      pos === undefined ? editor.chain().focus().insertContent(paragraph).run() : replaceAt(editor, pos, paragraph);
    });
  }, [editor]);

  const addTable = useCallback((rows: number, cols: number) => {
    editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  }, [editor]);

  const addTableAt = useCallback((pos: number, rows: number, cols: number) => {
    if (!editor) return;
    replaceAt(editor, pos, createTableContent(rows, cols));
    setTablePicker(null);
  }, [editor]);

  // 「转换成 → 页面」：以块文本为标题创建子笔记，并把块替换为指向它的链接段落。
  // 必须走浏览器端 Supabase 客户端（会话内 RLS）：/api/notes 是服务端路由，
  // 假后端（NEXT_PUBLIC_MOCK_BACKEND）模式下不可用——走它会导致转换静默失败，
  // 块原地不动也点击不进去（这正是历史 bug）。
  const convertBlockToPage = useCallback(async (pos: number) => {
    if (!editor) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const blockId = String(node.attrs?.id || "");
    if (!blockId) return;
    const title = node.textContent.trim() || "无标题笔记";
    const created = await createNewNote(supabase, {
      title,
      parent_note_id: noteId ?? null,
    });
    if (!created) {
      toast({ title: "转换成页面失败，请重试", variant: "destructive" });
      return;
    }
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
          text: title,
        },
      ],
    });
    // 刷新父页的笔记树：子页面列表（页面最底部）立即出现新页面，
    // 内容里的链接状态校验（internal link states）也会随之重取
    window.dispatchEvent(new CustomEvent("organize:notes-changed"));
    toast({ title: `已转换为子页面「${title}」` });
  }, [editor, noteId, supabase]);

  useEffect(() => {
    if (!editor) return;
    const root = rootRef.current;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { type: string; pos?: number; target?: EditorBlockTarget; point?: EditorMenuPoint; nested?: boolean; range?: { from: number; to: number } };
      if (typeof detail.pos === "number") {
        if (detail.type === "slash-menu" && detail.point) {
          setActionMenu(null);
          setTablePicker(null);
          setCommandMenu({ pos: detail.pos, point: detail.point, slash: true, nested: detail.nested, range: detail.range });
        } else if (detail.type === "html") {
          if (detail.nested && detail.range) {
            editor.chain().focus().deleteRange(detail.range).insertContent({ type: "htmlEmbed" }).run();
          } else {
            replaceAt(editor, detail.pos, { type: "htmlEmbed" });
          }
        }
        else if (detail.type === "ai-notes") setDialog({ type: "ai-notes", pos: detail.pos });
        else if (detail.type === "image") {
          uploadImage(detail.pos, detail.nested, detail.range);
        }
        else if (detail.type === "math") {
          const pos = detail.pos;
          const nestedRange = detail.nested && detail.range ? detail.range : null;
          void showPrompt({ title: "输入 LaTeX 公式", placeholder: "例如 E = mc^2" }).then((latex) => {
            if (!latex) return;
            if (nestedRange) {
              editor.chain().focus().deleteRange(nestedRange).insertContent({ type: "mathBlock", attrs: { latex } }).run();
            } else {
              replaceAt(editor, pos, { type: "mathBlock", attrs: { latex } });
            }
          });
        } else if (detail.type === "reference") {
          if (detail.nested && detail.range) {
            const range = detail.range;
            void showPrompt({ title: "输入要引用的阅读条目 URL", placeholder: "https://" }).then((url) => {
              if (!url) return;
              editor.chain().focus().deleteRange(range).insertContent({
                type: "paragraph",
                content: [
                  { type: "text", text: "📖 参考: " },
                  { type: "text", marks: [{ type: "link", attrs: { href: url } }], text: url },
                ],
              }).run();
            });
          } else {
            addReadingReference(detail.pos);
          }
        }
        else if (detail.type === "table") {
          // 表格不允许在嵌套块内插入（表格内不能再套表格）
          if (!detail.nested) {
            setTablePicker({
              pos: detail.pos,
              point: menuPointBelowBlock(editor, detail.pos, detail.pos + 1),
            });
          }
        }
        else if (detail.type === "page") {
          if (!detail.nested) {
            void convertBlockToPage(detail.pos);
          }
        }
        else if (detail.type === "synced-block") {
          // 同步区块：异步创建服务端记录拿到 id，再插入带 syncedId 的块
          void createSyncedBlockAt(editor, detail.nested ? undefined : detail.pos);
        }
        else if (detail.type === "database-inline") {
          // 行内数据库：创建 db 记录后在当前位置插入 databaseBlock
          void insertInlineDatabase(editor, noteId, detail.nested ? undefined : detail.pos);
        }
        else if (detail.type === "database-page") {
          // 整页数据库：创建子笔记 + 数据库 + 在原位置插入链接并跳转
          if (!detail.nested) {
            void insertPageDatabase(editor, noteId, detail.pos, router);
          }
        }
        else if (detail.type === "database-linked") {
          // 链接的视图：选择已有数据库，插入新视图引用
          void insertLinkedDatabase(editor, detail.nested ? undefined : detail.pos);
        }
      } else if (detail.target) {
        if (detail.type === "move") setDialog({ type: "move", target: detail.target });
        if (detail.type === "comment") setDialog({ type: "comment", target: detail.target });
        if (detail.type === "suggestion") setDialog({ type: "suggestion", target: detail.target });
        if (detail.type === "ask-ai") setDialog({ type: "ask-ai", target: detail.target });
      }
    };
    root?.addEventListener("organize-editor-action", handler);
    return () => root?.removeEventListener("organize-editor-action", handler);
  }, [addReadingReference, convertBlockToPage, editor, noteId, router, uploadImage]);

  useEffect(() => {
    if (!editor || !tableFullscreen) return;
    const shell = rootRef.current;
    if (!shell) return;

    const syncFullscreenTable = () => {
      shell
        .querySelectorAll(".organize-table-fullscreen")
        .forEach((element) => element.classList.remove("organize-table-fullscreen"));
      const table = getActiveTable(editor);
      if (!table) {
        setTableFullscreen(false);
        return;
      }
      const dom = editor.view.nodeDOM(table.pos);
      if (!(dom instanceof HTMLElement)) return;
      const tableElement = dom.matches("table")
        ? dom
        : dom.querySelector("table");
      tableElement?.classList.add("organize-table-fullscreen");
    };

    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTableFullscreen(false);
    };
    syncFullscreenTable();
    editor.on("transaction", syncFullscreenTable);
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      editor.off("transaction", syncFullscreenTable);
      window.removeEventListener("keydown", exitOnEscape);
      shell
        .querySelectorAll(".organize-table-fullscreen")
        .forEach((element) => element.classList.remove("organize-table-fullscreen"));
    };
  }, [editor, tableFullscreen]);

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
              // spread 透传 registerCommand / registerSlashCommand / onAppEvent / data 等宿主装配字段，
              // 下方仅覆盖 note-block 场景化字段与兜底
              ...baseContext,
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
              notify: baseContext?.notify || ((message) => toast({ title: message })),
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

  const showHandleForBlock = useCallback((block: HTMLElement) => {
    if (!editor) return;
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
  }, [editor]);

  const updateHoveredBlock = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || isDraggingBlock || selectDragRef.current?.active) return;
    const editorDom = editor.view.dom;
    const target = event.target as HTMLElement | null;

    if (!target || !editorDom.contains(target)) return;
    const block = blockElementAtTarget(editorDom, target, event.clientY);
    if (!block) return;
    showHandleForBlock(block);
  }, [editor, isDraggingBlock, showHandleForBlock]);

  // 触屏设备没有 hover：点按块（产生选区）时显示该块的手柄，
  // 否则触屏上既不能打开块操作菜单、也没有任何块操作入口。
  useEffect(() => {
    if (!editor) return;
    if (typeof window === "undefined" || !window.matchMedia?.("(pointer: coarse)").matches) return;
    const showHandleForSelection = () => {
      if (isDraggingBlock) return;
      const { from } = editor.state.selection;
      const domAtPos = editor.view.domAtPos(from).node;
      const el = domAtPos instanceof HTMLElement ? domAtPos : domAtPos.parentElement;
      const block = el?.closest("[data-id]") as HTMLElement | null;
      if (block) showHandleForBlock(block);
    };
    editor.on("selectionUpdate", showHandleForSelection);
    return () => {
      editor.off("selectionUpdate", showHandleForSelection);
    };
  }, [editor, isDraggingBlock, showHandleForBlock]);

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
    if (commandMenu || actionMenu || tablePicker || isDraggingBlock) return;
    hoveredRef.current = null;
    setHoveredBlock(null);
  }, [actionMenu, commandMenu, isDraggingBlock, tablePicker]);

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
    setTablePicker(null);
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
    setTablePicker(null);
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
    let blocks: HTMLElement[];
    if (sourceIsListItem && sourceParent) {
      blocks = Array.from(sourceParent.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches("li"));
    } else {
      // 指针悬在哪个折叠内容区上，候选块就是哪个内容区的直接子块；
      // 不在任何折叠内容区上时回退到顶层块。这样既能拖入/拖出折叠区，
      // 也能在折叠区内部排序。源块自己包含的内容区除外（不能拖进自己）。
      const underPointer = document.elementFromPoint(event.clientX, event.clientY);
      const detailsContent = underPointer instanceof HTMLElement
        ? underPointer.closest('div[data-type="detailsContent"]')
        : null;
      if (
        detailsContent instanceof HTMLElement
        && editorDom.contains(detailsContent)
        && !drag.source.element.contains(detailsContent)
      ) {
        blocks = Array.from(detailsContent.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      } else {
        blocks = Array.from(editorDom.children) as HTMLElement[];
      }
    }
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

  // 三种起点都算框选：
  // 1）笔记画布左右留白 / 编辑器 padding → 直接框选；
  // 2）块内没有文字的横向空白 → 直接框选；
  // 3）文字上（图3 的 Notion 方式）→ 先让浏览器做原生文本选择，一旦拖出起始块的
  //    纵向范围就切换为块多选（清掉文本选区、画选择矩形）。
  const beginSelectDrag = useCallback((event: MouseEvent) => {
    if (!editor || event.button !== 0) return;
    if (commandMenu || actionMenu || tablePicker) return;
    if (event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest(
      ".organize-block-handle, .organize-column-resizer, .editor-popover, "
      + ".table-direct-controls, "
      + "button, input, textarea, select, a, [contenteditable='false']"
    )) return;
    const editorDom = editor.view.dom;
    const bounds = blockSelectionBoundsForElement(editorDom);
    if (!pointIsInsideBlockSelectionBounds(bounds, event.clientX, event.clientY)) return;
    const startedInsideEditor = editorDom.contains(target);
    if (!startedInsideEditor || target === editorDom) {
      // 画布左右留白 / 编辑器 padding：没有原生文本选择，直接按行框选。
      event.preventDefault();
      selectDragRef.current = { startX: event.clientX, startY: event.clientY, active: false, fromText: false, blockTop: 0, blockBottom: 0, bounds };
      return;
    }
    // 文字区：记录起始块，拖出它的纵向范围后再切换
    const block = blockElementAtTarget(editorDom, target, event.clientY);
    if (!block) return;
    const rect = block.getBoundingClientRect();
    const fromText = pointIsOverRenderedText(block, event.clientX, event.clientY);
    selectDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      fromText,
      blockTop: fromText ? rect.top : 0,
      blockBottom: fromText ? rect.bottom : 0,
      bounds,
    };
  }, [actionMenu, commandMenu, editor, tablePicker]);

  useEffect(() => {
    document.addEventListener("mousedown", beginSelectDrag);
    return () => document.removeEventListener("mousedown", beginSelectDrag);
  }, [beginSelectDrag]);

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
      data-block-selecting={blockSelectCount > 0 ? "true" : "false"}
      data-table-fullscreen={tableFullscreen ? "true" : "false"}
    >
      <BubbleMenu
        editor={editor}
        shouldShow={shouldShowTextToolbar}
        tippyOptions={{ duration: 150, maxWidth: "none", zIndex: 50 }}
      >
        <BubbleToolbar editor={editor} onUploadImage={() => uploadImage()} onAddImageUrl={addImageUrl} onUploadAttachment={uploadAttachment} onAddTable={addTable} onAddReference={() => addReadingReference()} />
      </BubbleMenu>
      <BubbleMenu
        editor={editor}
        pluginKey="organizeTableToolbar"
        shouldShow={({ editor: currentEditor, from, to }) =>
          currentEditor.isActive("table")
          && (from === to || currentEditor.state.selection instanceof CellSelection)
        }
        tippyOptions={{
          duration: 120,
          maxWidth: "none",
          zIndex: 140,
          placement: "top",
          getReferenceClientRect: () => activeTableReferenceRect(editor),
        }}
      >
        <TableToolbar
          editor={editor}
          fullscreen={tableFullscreen}
          onToggleFullscreen={() => setTableFullscreen((value) => !value)}
        />
      </BubbleMenu>
      <EditorContent editor={editor} />
      <TableDirectControls editor={editor} />
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
      {commandMenu && <BlockCommandMenu editor={editor} pos={commandMenu.pos} point={commandMenu.point} clearTrigger={Boolean(commandMenu.slash)} nested={commandMenu.nested} range={commandMenu.range} onClose={closeMenus} />}
      {actionMenu && <BlockActionMenu editor={editor} noteId={noteId} target={actionMenu.target} point={actionMenu.point} skills={skills} commentCount={commentCounts[actionMenu.target.id] || 0} onClose={closeMenus} onPresent={(target) => setPresentationStart(target.id)} />}
      {tablePicker && (
        <EditorPopover
          point={tablePicker.point}
          onClose={() => {
            setTablePicker(null);
            editor.commands.focus();
          }}
          className="table-picker-popover"
        >
          <TableGridPicker
            onSelect={(rows, cols) => addTableAt(tablePicker.pos, rows, cols)}
          />
        </EditorPopover>
      )}
      <EditorDialogs editor={editor} noteId={noteId} dialog={dialog} onClose={() => setDialog(null)} />
      {presentationStart && <PresentationMode doc={editor.getJSON()} startBlockId={presentationStart} onClose={() => setPresentationStart(null)} />}
    </div>
  );
}
