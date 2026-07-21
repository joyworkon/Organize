"use client";

import "katex/dist/katex.min.css";
import { useEditor, EditorContent, BubbleMenu, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
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

export function TipTapEditor({ content, onUpdate }: EditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Underline,
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder: "开始写作，选中文字即可格式化...",
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
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
    ],
    content,
    onUpdate: ({ editor }) => {
      onUpdate(editor.getJSON());
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose max-w-none min-h-[50vh] focus:outline-none py-2 organize-editor",
      },
    },
  });

  const addImageUrl = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("输入图片 URL");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  const uploadImage = useCallback(() => {
    if (!editor) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.url) {
          editor.chain().focus().setImage({ src: data.url }).run();
        }
      } catch {
        // 上传失败时回退到 base64
        const reader = new FileReader();
        reader.onload = () => {
          editor.chain().focus().setImage({ src: reader.result as string }).run();
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [editor]);

  const addReadingReference = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("输入要引用的阅读条目 URL（可在阅读库中复制链接）");
    if (url) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "paragraph",
          content: [
            { type: "text", text: "📖 参考: " },
            {
              type: "text",
              marks: [{ type: "link", attrs: { href: url } }],
              text: url,
            },
          ],
        })
        .run();
    }
  }, [editor]);

  const addTable = useCallback(() => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="relative">
      {/* 选中文字后弹出的浮动工具栏 */}
      <BubbleMenu
        editor={editor}
        tippyOptions={{ duration: 150, maxWidth: "none", zIndex: 50 }}
      >
        <BubbleToolbar
          editor={editor}
          onUploadImage={uploadImage}
          onAddImageUrl={addImageUrl}
          onAddTable={addTable}
          onAddReference={addReadingReference}
        />
      </BubbleMenu>

      {/* 编辑区（无边框，Notion 风格） */}
      <EditorContent editor={editor} />
    </div>
  );
}
