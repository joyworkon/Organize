"use client";

/**
 * B04（R09 续）：气泡工具栏层——从 tiptap-editor.tsx 原样拆出（纯移动，无逻辑改动）。
 * 范围：块类型配置表（blockOptions）、文字/背景色板、表情选择器、
 * 浮动工具栏（BubbleToolbar）与插入二级菜单（InsertMenu）。
 * 全部为 props 驱动的自包含组件：仅依赖 editor 实例与宿主传入的回调，
 * 不感知笔记页/协作状态。交互契约（二级菜单、外点关闭）保持不变。
 */
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
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
import { cn } from "@/lib/utils";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { BLOCK_COMMANDS } from "./block-commands";
import { TableGridPicker } from "./table-controls";
import { BLOCK_BACKGROUND_TYPES } from "./extensions/block-style";

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

export function BubbleToolbar({
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
