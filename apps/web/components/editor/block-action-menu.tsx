"use client";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  Copy,
  FileInput,
  Link2,
  List as ListIcon,
  MessageSquare,
  Palette,
  PlaySquare,
  Search,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { BLOCK_COMMANDS, commandMatches } from "./block-commands";
import { stripBlockIds } from "./block-utils";
import { focusAndHighlightBlock } from "./extensions/block-selection";
import {
  findListParent,
  setListStyle,
  type ListStyle,
} from "./extensions/list-style";
import { EditorPopover } from "./editor-popover";
import type { EditorBlockTarget, EditorMenuPoint } from "./types";

export interface EditorSkillAction {
  id: string;
  label: string;
  icon?: string;
  run: (target: EditorBlockTarget) => void | Promise<void>;
}

const TEXT_COLORS = [
  { label: "默认", value: null },
  { label: "灰色", value: "#787774" },
  { label: "棕色", value: "#9f6b53" },
  { label: "橙色", value: "#d9730d" },
  { label: "黄色", value: "#cb912f" },
  { label: "绿色", value: "#448361" },
  { label: "蓝色", value: "#337ea9" },
  { label: "紫色", value: "#9065b0" },
  { label: "红色", value: "#d44c47" },
];

const BACKGROUNDS = [
  { label: "无背景", value: null },
  { label: "灰色背景", value: "rgba(120,119,116,.12)" },
  { label: "棕色背景", value: "rgba(159,107,83,.14)" },
  { label: "橙色背景", value: "rgba(217,115,13,.14)" },
  { label: "黄色背景", value: "rgba(203,145,47,.16)" },
  { label: "绿色背景", value: "rgba(68,131,97,.14)" },
  { label: "蓝色背景", value: "rgba(51,126,169,.14)" },
  { label: "紫色背景", value: "rgba(144,101,176,.14)" },
  { label: "红色背景", value: "rgba(212,76,71,.14)" },
];

// 可直接转换的块：普通文本块、列表项 / 待办项 / 折叠列表和分栏。
// 分栏转换为普通块时由 block-commands 按换行合并各栏文字；切换列数则保留栏内结构。
const TEXT_TRANSFORMABLE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "callout",
  "details",
  "listItem",
  "taskItem",
  "columns",
]);

// 列表项 / 待办项转换前，先把光标放进去并用 liftListItem 把它移出列表，变成顶层段落，
// 再返回该段落的位置交给目标块命令替换；其它类型直接返回原位置。
function resolveTransformPos(editor: Editor, target: EditorBlockTarget): number {
  if (target.type !== "listItem" && target.type !== "taskItem") return target.pos;
  try {
    const near = TextSelection.near(editor.state.doc.resolve(target.pos + 1));
    editor.view.dispatch(editor.state.tr.setSelection(near));
  } catch {
    return target.pos;
  }
  // liftListItem 每次只 lift 一层，嵌套列表项需要循环 lift 到顶层，
  // 否则 $from.before(1) 会指向顶层列表节点，replaceBlock 会把整个列表替换掉
  let lifted = editor.commands.liftListItem(target.type);
  while (lifted && editor.state.selection.$from.depth > 1) {
    lifted = editor.commands.liftListItem(target.type);
  }
  if (!lifted || editor.state.selection.$from.depth !== 1) return target.pos;
  const pos = editor.state.selection.$from.before(1);
  // lift 产生的新段落会被 UniqueID 分配新 id，把原 listItem 的 id 写回，
  // 保证后续的 focusAndHighlightBlock(target.id)、评论锚点和 #block-<id> 深链仍然有效
  if (target.id) {
    const node = editor.state.doc.nodeAt(pos);
    if (node && node.attrs.id !== target.id) {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: target.id })
      );
    }
  }
  return pos;
}

function dispatchDialog(editor: Editor, type: string, target: EditorBlockTarget) {
  editor.view.dom.dispatchEvent(
    new CustomEvent("organize-editor-action", { bubbles: true, detail: { type, target } })
  );
}

function duplicateBlock(editor: Editor, target: EditorBlockTarget) {
  const node = editor.state.doc.nodeAt(target.pos);
  if (!node) return;
  const json = stripBlockIds(node.toJSON());
  editor.chain().focus().insertContentAt(target.pos + node.nodeSize, json).run();
}

function deleteBlock(editor: Editor, target: EditorBlockTarget) {
  const node = editor.state.doc.nodeAt(target.pos);
  if (!node) return;
  const complex = ["table", "image", "htmlEmbed", "columns", "details"].includes(node.type.name) || node.content.size > 500;
  if (complex && !window.confirm("删除这个复杂区块？此操作可通过撤销恢复。")) return;
  let from = target.pos;
  let to = target.pos + node.nodeSize;
  // 删除列表中最后一个列表项时，连同父列表一起删除，
  // 否则会残留没有 listItem 的空 bulletList/taskList（schema 要求 listItem+）
  if (node.type.name === "listItem" || node.type.name === "taskItem") {
    const $pos = editor.state.doc.resolve(target.pos);
    const parent = $pos.parent;
    if (
      ["bulletList", "orderedList", "taskList"].includes(parent.type.name) &&
      parent.childCount === 1
    ) {
      from = $pos.before($pos.depth);
      to = $pos.after($pos.depth);
    }
  }
  const tr = editor.state.tr.delete(from, to);
  if (tr.doc.childCount === 0) tr.insert(0, editor.schema.nodes.paragraph.create());
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

function moveBlock(editor: Editor, target: EditorBlockTarget, direction: -1 | 1) {
  const positions: { pos: number; size: number }[] = [];
  editor.state.doc.forEach((node, offset) => positions.push({ pos: offset, size: node.nodeSize }));
  const index = positions.findIndex((entry) => entry.pos === target.pos);
  const destinationIndex = index + direction;
  if (index < 0 || destinationIndex < 0 || destinationIndex >= positions.length) return;

  const current = editor.state.doc.nodeAt(target.pos);
  if (!current) return;
  const tr = editor.state.tr;
  if (direction < 0) {
    const destination = positions[destinationIndex];
    tr.delete(target.pos, target.pos + current.nodeSize);
    tr.insert(destination.pos, current);
  } else {
    const destination = positions[destinationIndex];
    tr.delete(target.pos, target.pos + current.nodeSize);
    tr.insert(destination.pos + destination.size - current.nodeSize, current);
  }
  editor.view.dispatch(tr.scrollIntoView());
}

function selectBlockText(editor: Editor, target: EditorBlockTarget) {
  const node = editor.state.doc.nodeAt(target.pos);
  if (!node || !node.content.size) return false;
  const from = target.pos + 1;
  const to = Math.max(from, target.pos + node.nodeSize - 1);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  return true;
}

export function BlockActionMenu({
  editor,
  noteId,
  target,
  point,
  skills,
  commentCount = 0,
  onClose,
  onPresent,
}: {
  editor: Editor;
  noteId: string;
  target: EditorBlockTarget;
  point: EditorMenuPoint;
  skills: EditorSkillAction[];
  commentCount?: number;
  onClose: () => void;
  onPresent: (target: EditorBlockTarget) => void;
}) {
  const [view, setView] = useState<
    "main" | "transform" | "color" | "list-style" | "skills"
  >("main");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{ commandId: string; top: number; left: number } | null>(null);
  const transformCommands = useMemo(
    () => BLOCK_COMMANDS.filter((item) => {
      if (!item.canTransform || !commandMatches(item, query)) return false;
      if (target.type === "paragraph" && item.id === "paragraph") return false;
      if (target.type === "heading" && item.id === `heading-${target.json.attrs?.level}`) return false;
      return true;
    }),
    [query, target.json.attrs?.level, target.type]
  );
  const canTransformTarget = TEXT_TRANSFORMABLE_TYPES.has(target.type);
  const listParent = findListParent(editor.state.doc, target.pos);
  // moveBlock 只收集顶层块，对嵌套的 listItem/taskItem 永远找不到目标，
  // 「上移 / 下移」会静默无效，因此对这两类块直接隐藏
  const canMoveTarget = target.type !== "listItem" && target.type !== "taskItem";

  const finish = (callback: () => void | Promise<void>) => {
    void callback();
    onClose();
  };

  if (view === "transform") {
    const previewCommand = preview ? transformCommands.find((item) => item.id === preview.commandId) : null;
    return (
      <EditorPopover point={point} onClose={onClose} className="block-action-popover">
        <MenuHeader title="转换成" query={query} onQuery={setQuery} onBack={() => { setPreview(null); setView("main"); }} />
        <div className="editor-menu-scroll compact" onMouseLeave={() => setPreview(null)}>
          {!canTransformTarget && <div className="editor-menu-empty">{target.type} 是结构化区块，不能直接转换；请先复制其中的文本。</div>}
          {canTransformTarget && transformCommands.map((command) => {
            const Icon = command.icon;
            return <button key={command.id} type="button"
              onMouseEnter={(event) => {
                if (!command.preview) {
                  setPreview(null);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                setPreview({
                  commandId: command.id,
                  top: Math.max(8, Math.min(rect.top, window.innerHeight - 180)),
                  left: Math.min(rect.right + 8, window.innerWidth - 216),
                });
              }}
              onClick={() => finish(() => {
                const pos = resolveTransformPos(editor, target);
                command.run(editor, pos);
                focusAndHighlightBlock(editor, target.id);
              })}><Icon className="h-4 w-4" /><span>{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</button>;
          })}
        </div>
        {previewCommand?.preview && (
          <div className="block-transform-preview" style={{ top: preview!.top, left: preview!.left }} aria-hidden="true">
            <div className={`block-transform-preview-sample preview-${previewCommand.id}`}>{previewCommand.preview.sample}</div>
            <div className="block-transform-preview-caption">{previewCommand.preview.caption}</div>
          </div>
        )}
      </EditorPopover>
    );
  }

  if (view === "color") {
    return (
      <EditorPopover point={point} onClose={onClose} className="block-action-popover">
        <MenuHeader title="颜色" query="" onQuery={() => {}} onBack={() => setView("main")} hideSearch />
        <div className="editor-menu-scroll compact color-menu">
          <div className="editor-menu-label">文字颜色</div>
          {TEXT_COLORS.map((color) => (
            <button key={color.label} type="button" onClick={() => finish(() => {
              if (!selectBlockText(editor, target)) return;
              color.value ? editor.chain().focus().setColor(color.value).run() : editor.chain().focus().unsetColor().run();
            })}>
              <span className="color-swatch text-swatch" style={{ color: color.value || "inherit" }}>A</span><span>{color.label}</span>
            </button>
          ))}
          <div className="editor-menu-label">背景颜色</div>
          {BACKGROUNDS.map((color) => (
            <button key={color.label} type="button" onClick={() => finish(() => { editor.commands.setBlockBackground(target.pos, color.value); })}>
              <span className="color-swatch" style={{ background: color.value || "transparent" }} /><span>{color.label}</span>
            </button>
          ))}
        </div>
      </EditorPopover>
    );
  }

  if (view === "list-style" && listParent) {
    const options: Array<{ label: string; value: ListStyle }> =
      listParent.type === "orderedList"
        ? [
            { label: "默认", value: "default" },
            { label: "数字", value: "decimal" },
            { label: "字母", value: "lower-alpha" },
            { label: "罗马数字", value: "lower-roman" },
          ]
        : [
            { label: "默认", value: "default" },
            { label: "盘型", value: "disc" },
            { label: "圆形", value: "circle" },
            { label: "方形", value: "square" },
          ];
    return (
      <EditorPopover point={point} onClose={onClose} className="block-action-popover">
        <MenuHeader
          title="列表格式"
          query=""
          onQuery={() => {}}
          onBack={() => setView("main")}
          hideSearch
        />
        <div className="editor-menu-scroll compact">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={listParent.style === option.value ? "is-active" : ""}
              onClick={() =>
                finish(() => {
                  setListStyle(editor, target.pos, option.value);
                })
              }
            >
              <ListStylePreview type={listParent.type} style={option.value} />
              <span>{option.label}</span>
              {listParent.style === option.value && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      </EditorPopover>
    );
  }

  if (view === "skills") {
    return (
      <EditorPopover point={point} onClose={onClose} className="block-action-popover">
        <MenuHeader title="技能" query={query} onQuery={setQuery} onBack={() => setView("main")} />
        <div className="editor-menu-scroll compact">
          {skills.filter((skill) => skill.label.toLowerCase().includes(query.toLowerCase())).map((skill) => (
            <button key={skill.id} type="button" onClick={() => finish(() => skill.run(target))}><span className="skill-icon">{skill.icon || "✦"}</span><span>{skill.label}</span></button>
          ))}
          {skills.length === 0 && <div className="editor-menu-empty">没有已启用的笔记技能</div>}
        </div>
      </EditorPopover>
    );
  }

  const copyLink = async () => {
    const href = `${window.location.origin}/notes/${noteId}#block-${target.id}`;
    try {
      // 非安全上下文里 navigator.clipboard 可能为 undefined 或 reject
      await navigator.clipboard.writeText(href);
    } catch {
      window.prompt("复制链接", href);
    }
  };

  return (
    <EditorPopover point={point} onClose={onClose} className="block-action-popover">
      <div className="editor-menu-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索操作…" autoFocus /></div>
      <div className="editor-menu-scroll compact">
        <div className="editor-menu-label">文本</div>
        <Action icon={FileInput} label="转换成" suffix={<ChevronRight />} onClick={() => setView("transform")} query={query} />
        <Action icon={Palette} label="颜色" suffix={<ChevronRight />} onClick={() => setView("color")} query={query} />
        {listParent && (
          <Action
            icon={ListIcon}
            label="列表格式"
            suffix={<ChevronRight />}
            onClick={() => setView("list-style")}
            query={query}
          />
        )}
        <div className="editor-menu-separator" />
        <Action icon={Link2} label="拷贝区块链接" shortcut="⌘⌥L" onClick={() => finish(copyLink)} query={query} />
        <Action icon={Copy} label="创建副本" shortcut="⌘D" onClick={() => finish(() => duplicateBlock(editor, target))} query={query} />
        {canMoveTarget && <Action icon={ArrowUp} label="上移" onClick={() => finish(() => moveBlock(editor, target, -1))} query={query} />}
        {canMoveTarget && <Action icon={ArrowDown} label="下移" onClick={() => finish(() => moveBlock(editor, target, 1))} query={query} />}
        <Action icon={FileInput} label="移动到" onClick={() => finish(() => dispatchDialog(editor, "move", target))} query={query} />
        <Action icon={Trash2} label="删除" shortcut="Del" danger onClick={() => finish(() => deleteBlock(editor, target))} query={query} />
        <div className="editor-menu-separator" />
        <Action icon={MessageSquare} label="评论" badge={commentCount || undefined} onClick={() => finish(() => dispatchDialog(editor, "comment", target))} query={query} />
        <Action icon={WandSparkles} label="编辑建议" onClick={() => finish(() => dispatchDialog(editor, "suggestion", target))} query={query} />
        <div className="editor-menu-separator" />
        <Action icon={PlaySquare} label="从此处演示" onClick={() => finish(() => onPresent(target))} query={query} />
        <Action icon={Bot} label="万事问 AI" onClick={() => finish(() => dispatchDialog(editor, "ask-ai", target))} query={query} />
        <Action icon={Sparkles} label="技能" suffix={<ChevronRight />} onClick={() => setView("skills")} query={query} />
      </div>
      <div className="editor-menu-meta">当前块 · {target.type}</div>
    </EditorPopover>
  );
}

function ListStylePreview({
  type,
  style,
}: {
  type: "bulletList" | "orderedList";
  style: ListStyle;
}) {
  const marker =
    type === "bulletList"
      ? style === "circle"
        ? "○"
        : style === "square"
          ? "▪"
          : "•"
      : style === "lower-alpha"
        ? "a."
        : style === "lower-roman"
          ? "i."
          : "1.";
  return (
    <span className="list-style-preview" aria-hidden="true">
      {marker}
    </span>
  );
}

function MenuHeader({ title, query, onQuery, onBack, hideSearch = false }: { title: string; query: string; onQuery: (value: string) => void; onBack: () => void; hideSearch?: boolean }) {
  return (
    <>
      <div className="editor-menu-subtitle"><button type="button" onClick={onBack}><ArrowLeft className="h-4 w-4" /></button><strong>{title}</strong></div>
      {!hideSearch && <div className="editor-menu-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={`搜索${title}…`} autoFocus /></div>}
    </>
  );
}

function Action({ icon: Icon, label, onClick, query, suffix, shortcut, danger, badge }: { icon: typeof Check; label: string; onClick: () => void; query: string; suffix?: React.ReactNode; shortcut?: string; danger?: boolean; badge?: number }) {
  if (query && !label.toLowerCase().includes(query.toLowerCase())) return null;
  return (
    <button type="button" className={danger ? "danger" : ""} onClick={onClick}>
      <Icon className="h-4 w-4" /><span>{label}</span>{badge ? <em>{badge}</em> : null}{shortcut && <kbd>{shortcut}</kbd>}{suffix && <span className="menu-suffix">{suffix}</span>}
    </button>
  );
}
