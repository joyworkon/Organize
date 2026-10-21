"use client";

import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TextSelection } from "@tiptap/pm/state";
import {
  ArrowDown,
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
} from "@/components/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TEXT_COLORS, BACKGROUNDS, TEXT_TRANSFORMABLE_TYPES } from "./block-action-options";
import { BLOCK_COMMANDS, commandMatches } from "./block-commands";
import { copyBlockDeepLink, duplicateBlockAtPosition } from "./block-shortcuts";
import { focusAndHighlightBlock } from "./extensions/block-selection";
import {
  findListParent,
  setListStyle,
  type ListStyle,
} from "./extensions/list-style";
import { EditorPopover } from "./editor-popover";
import { CALLOUT_TONES, normalizeCalloutTone } from "@/lib/editor/callout-icons";
import type { EditorBlockTarget, EditorMenuPoint } from "./types";

export interface EditorSkillAction {
  id: string;
  label: string;
  icon?: string;
  run: (target: EditorBlockTarget) => void | Promise<void>;
}

const ROW_BUTTON_CLASS = "h-auto w-full justify-start gap-2 whitespace-normal px-2 py-1 text-left font-normal";

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

function deleteBlock(editor: Editor, target: EditorBlockTarget) {
  const node = editor.state.doc.nodeAt(target.pos);
  if (!node) return;
  const complex = ["table", "image", "htmlEmbed", "columns", "details"].includes(node.type.name) || node.content.size > 500;
  if (complex && !window.confirm("删除这个复杂区块？此操作可通过撤销恢复。")) return;
  let from = target.pos;
  let to = target.pos + node.nodeSize;
  // 删除折叠内容区里最后一个块时，原地补一个空段落而不是整块删除，
  // 否则 detailsContent 被掏空（schema 要求 block+），折叠块也无法再点进去
  const $target = editor.state.doc.resolve(target.pos);
  if ($target.parent.type.name === "detailsContent" && $target.parent.childCount === 1) {
    editor.chain().focus().insertContentAt({ from, to }, { type: "paragraph" }).run();
    return;
  }
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
  // 同级交换：顶层块在文档顶层移动；折叠内容 / 列表里的块在自己的父容器内
  // 与相邻兄弟互换位置（到边界则不动作）。
  const $pos = editor.state.doc.resolve(target.pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const destinationIndex = index + direction;
  if (destinationIndex < 0 || destinationIndex >= parent.childCount) return;

  const current = editor.state.doc.nodeAt(target.pos);
  if (!current) return;
  const contentStart = $pos.start();
  const positions: { pos: number; size: number }[] = [];
  parent.forEach((node, offset) => positions.push({ pos: contentStart + offset, size: node.nodeSize }));
  const destination = positions[destinationIndex];
  const tr = editor.state.tr;
  if (direction < 0) {
    tr.delete(target.pos, target.pos + current.nodeSize);
    tr.insert(destination.pos, current);
  } else {
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
  const [query, setQuery] = useState("");
  const [subQuery, setSubQuery] = useState("");
  const [preview, setPreview] = useState<{ commandId: string; top: number; left: number } | null>(null);
  // 二级 flyout：subView 为当前展开的二级菜单，subAnchor 为其锚点坐标（视口内 fixed 定位）
  const [subView, setSubView] = useState<"transform" | "color" | "list-style" | "skills" | null>(null);
  const [subAnchor, setSubAnchor] = useState<{ top: number; left: number } | null>(null);
  const transformCommands = useMemo(
    () => BLOCK_COMMANDS.filter((item) => {
      if (!item.canTransform || !commandMatches(item, subQuery)) return false;
      if (target.type === "paragraph" && item.id === "paragraph") return false;
      if (target.type === "heading" && item.id === `heading-${target.json.attrs?.level}`) return false;
      return true;
    }),
    [subQuery, target.json.attrs?.level, target.type]
  );
  const canTransformTarget = TEXT_TRANSFORMABLE_TYPES.has(target.type);
  const listParent = findListParent(editor.state.doc, target.pos);

  // 二级菜单 hover 展开（Notion 同款）：短延迟避免鼠标滑过项时误触发；
  // 鼠标移入 flyout 或回到菜单项上时取消关闭；触屏设备点击菜单项也能立即展开。
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const cancelOpenTimer = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const cancelCloseTimer = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const clearFlyout = () => {
    setSubView(null);
    setSubAnchor(null);
    setPreview(null);
  };
  const openSubView = (next: "transform" | "color" | "list-style" | "skills", rect: DOMRect) => {
    cancelOpenTimer();
    cancelCloseTimer();
    setSubView(next);
    setSubQuery("");
    setPreview(null);
    const left = Math.min(rect.right + 6, Math.max(8, window.innerWidth - 336));
    const top = Math.max(8, Math.min(rect.top - 8, window.innerHeight - 320));
    setSubAnchor({ top, left });
  };
  const scheduleOpenSubView = (next: "transform" | "color" | "list-style" | "skills") => (event: React.MouseEvent<HTMLElement>) => {
    cancelCloseTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    cancelOpenTimer();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      openSubView(next, rect);
    }, 120);
  };
  const closeSubView = () => {
    cancelOpenTimer();
    cancelCloseTimer();
    clearFlyout();
  };
  const scheduleCloseSubView = () => {
    cancelOpenTimer();
    cancelCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      clearFlyout();
    }, 200);
  };
  useEffect(() => () => { cancelOpenTimer(); cancelCloseTimer(); }, []);

  const finish = (callback: () => void | Promise<void>) => {
    void callback();
    onClose();
  };

  const flyout = subView && subAnchor
    ? createPortal(
        <div
          className="editor-popover block-action-popover block-action-flyout"
          style={{ left: subAnchor.left, top: subAnchor.top, maxHeight: "calc(100vh - 16px)" }}
          onMouseEnter={cancelCloseTimer}
          onMouseLeave={scheduleCloseSubView}
        >
          {subView === "transform" && (
            <>
              <div className="editor-menu-search"><Search className="h-4 w-4" /><input value={subQuery} onChange={(event) => setSubQuery(event.target.value)} placeholder="搜索转换目标…" autoFocus /></div>
              <div className="editor-menu-scroll compact" onMouseLeave={() => setPreview(null)}>
                {!canTransformTarget && <div className="editor-menu-empty">{target.type} 是结构化区块，不能直接转换；请先复制其中的文本。</div>}
                {canTransformTarget && transformCommands.map((command) => {
                  const Icon = command.icon;
                  return <Button variant="ghost" size="sm" className={ROW_BUTTON_CLASS} key={command.id} type="button"
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
                    })}><Icon className="h-4 w-4" /><span>{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</Button>;
                })}
              </div>
              {(() => {
                const previewCommand = preview ? transformCommands.find((item) => item.id === preview.commandId) : null;
                return previewCommand?.preview ? (
                  <div className="block-transform-preview" style={{ top: preview!.top, left: preview!.left }} aria-hidden="true">
                    <div className={`block-transform-preview-sample preview-${previewCommand.id}`}>{previewCommand.preview.sample}</div>
                    <div className="block-transform-preview-caption">{previewCommand.preview.caption}</div>
                  </div>
                ) : null;
              })()}
            </>
          )}
          {subView === "color" && (
            <div className="editor-menu-scroll compact color-menu">
              {target.type === "callout" && (
                <>
                  <div className="editor-menu-label">标注色调</div>
                  {CALLOUT_TONES.map((tone) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={ROW_BUTTON_CLASS}
                      key={tone.value}
                      type="button"
                      aria-pressed={normalizeCalloutTone(target.json.attrs?.tone) === tone.value}
                      onClick={() => finish(() => {
                        const node = editor.state.doc.nodeAt(target.pos);
                        if (!node || node.type.name !== "callout") return;
                        editor.view.dispatch(
                          editor.state.tr.setNodeMarkup(target.pos, undefined, {
                            ...node.attrs, tone: tone.value === "default" ? undefined : tone.value,
                          })
                        );
                        editor.commands.focus();
                      })}
                    >
                      <span aria-hidden="true" className={`callout-tone-dot callout-tone-${tone.value}`} />
                      <span>{tone.label}</span>
                      {normalizeCalloutTone(target.json.attrs?.tone) === tone.value && <Check className="h-4 w-4" />}
                    </Button>
                  ))}
                </>
              )}
              <div className="editor-menu-label">文字颜色</div>
              {TEXT_COLORS.map((color) => (
                <Button variant="ghost" size="sm" className={ROW_BUTTON_CLASS} key={color.label} type="button" onClick={() => finish(() => {
                  if (!selectBlockText(editor, target)) return;
                  color.value ? editor.chain().focus().setColor(color.value).run() : editor.chain().focus().unsetColor().run();
                })}>
                  <span aria-hidden="true" className="color-swatch text-swatch" style={{ color: color.value || "inherit" }}>A</span><span>{color.label}</span>
                </Button>
              ))}
              <div className="editor-menu-label">背景颜色</div>
              {BACKGROUNDS.map((color) => (
                <Button variant="ghost" size="sm" className={ROW_BUTTON_CLASS} key={color.label} type="button" onClick={() => finish(() => { editor.commands.setBlockBackground(target.pos, color.value); })}>
                  <span className="color-swatch" style={{ background: color.value || "transparent" }} /><span>{color.label}</span>
                </Button>
              ))}
            </div>
          )}
          {subView === "list-style" && listParent && (
            <div className="editor-menu-scroll compact">
              <div className="editor-menu-label">列表格式</div>
              {((
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
                    ]
              ) as Array<{ label: string; value: ListStyle }>).map((option) => (
                <Button
                  variant="ghost"
                  size="sm"
                  key={option.value}
                  type="button"
                  aria-pressed={listParent.style === option.value}
                  className={cn(ROW_BUTTON_CLASS, listParent.style === option.value && "is-active bg-accent text-accent-foreground")}
                  onClick={() =>
                    finish(() => {
                      setListStyle(editor, target.pos, option.value);
                    })
                  }
                >
                  <ListStylePreview type={listParent.type} style={option.value} />
                  <span>{option.label}</span>
                  {listParent.style === option.value && <Check className="h-4 w-4" />}
                </Button>
              ))}
            </div>
          )}
          {subView === "skills" && (
            <>
              <div className="editor-menu-search"><Search className="h-4 w-4" /><input value={subQuery} onChange={(event) => setSubQuery(event.target.value)} placeholder="搜索技能…" autoFocus /></div>
              <div className="editor-menu-scroll compact">
                {skills.filter((skill) => skill.label.toLowerCase().includes(subQuery.toLowerCase())).map((skill) => (
                  <Button variant="ghost" size="sm" className={ROW_BUTTON_CLASS} key={skill.id} type="button" onClick={() => finish(() => skill.run(target))}><span className="skill-icon">{skill.icon || "✦"}</span><span>{skill.label}</span></Button>
                ))}
                {skills.length === 0 && <div className="editor-menu-empty">没有已启用的笔记技能</div>}
              </div>
            </>
          )}
        </div>,
        document.body
      )
    : null;


  return (
    <EditorPopover point={point} onClose={onClose} className="block-action-popover" ignoreOutsideSelector=".block-action-flyout">
      <div className="editor-menu-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索操作…" autoFocus /></div>
      <div className="editor-menu-scroll compact" onMouseLeave={subView ? scheduleCloseSubView : undefined}>
        <div className="editor-menu-label">文本</div>
        <Action icon={FileInput} label="转换成" suffix={<ChevronRight />} onClick={(event) => openSubView("transform", event.currentTarget.getBoundingClientRect())} onMouseEnter={scheduleOpenSubView("transform")} onMouseLeave={scheduleCloseSubView} active={subView === "transform"} query={query} />
        <Action icon={Palette} label="颜色" suffix={<ChevronRight />} onClick={(event) => openSubView("color", event.currentTarget.getBoundingClientRect())} onMouseEnter={scheduleOpenSubView("color")} onMouseLeave={scheduleCloseSubView} active={subView === "color"} query={query} />
        {listParent && (
          <Action
            icon={ListIcon}
            label="列表格式"
            suffix={<ChevronRight />}
            onClick={(event) => openSubView("list-style", event.currentTarget.getBoundingClientRect())}
            onMouseEnter={scheduleOpenSubView("list-style")}
            onMouseLeave={scheduleCloseSubView}
            active={subView === "list-style"}
            query={query}
          />
        )}
        <div className="editor-menu-separator" />
        <Action icon={Link2} label="拷贝区块链接" shortcut="⌘⌥L" onMouseEnter={closeSubView} onClick={() => finish(() => { void copyBlockDeepLink(noteId, target.id); })} query={query} />
        <Action icon={Copy} label="创建副本" shortcut="⌘D" onMouseEnter={closeSubView} onClick={() => finish(() => { duplicateBlockAtPosition(editor, target.pos); })} query={query} />
        <Action icon={ArrowUp} label="上移" onMouseEnter={closeSubView} onClick={() => finish(() => moveBlock(editor, target, -1))} query={query} />
        <Action icon={ArrowDown} label="下移" onMouseEnter={closeSubView} onClick={() => finish(() => moveBlock(editor, target, 1))} query={query} />
        <Action icon={FileInput} label="移动到" onMouseEnter={closeSubView} onClick={() => finish(() => dispatchDialog(editor, "move", target))} query={query} />
        <Action icon={Trash2} label="删除" shortcut="Del" danger onMouseEnter={closeSubView} onClick={() => finish(() => deleteBlock(editor, target))} query={query} />
        <div className="editor-menu-separator" />
        <Action icon={MessageSquare} label="评论" badge={commentCount || undefined} onMouseEnter={closeSubView} onClick={() => finish(() => dispatchDialog(editor, "comment", target))} query={query} />
        <Action icon={WandSparkles} label="编辑建议" onMouseEnter={closeSubView} onClick={() => finish(() => dispatchDialog(editor, "suggestion", target))} query={query} />
        <div className="editor-menu-separator" />
        <Action icon={PlaySquare} label="从此处演示" onMouseEnter={closeSubView} onClick={() => finish(() => onPresent(target))} query={query} />
        <Action icon={Bot} label="万事问 AI" onMouseEnter={closeSubView} onClick={() => finish(() => dispatchDialog(editor, "ask-ai", target))} query={query} />
        <Action icon={Sparkles} label="技能" suffix={<ChevronRight />} onClick={(event) => openSubView("skills", event.currentTarget.getBoundingClientRect())} onMouseEnter={scheduleOpenSubView("skills")} onMouseLeave={scheduleCloseSubView} active={subView === "skills"} query={query} />
      </div>
      <div className="editor-menu-meta">当前块 · {target.type}</div>
      {flyout}
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

function Action({ icon: Icon, label, onClick, query, suffix, shortcut, danger, badge, onMouseEnter, onMouseLeave, active }: { icon: typeof Check; label: string; onClick: (() => void) | ((event: React.MouseEvent<HTMLButtonElement>) => void); query: string; suffix?: React.ReactNode; shortcut?: string; danger?: boolean; badge?: number; onMouseEnter?: (event: React.MouseEvent<HTMLButtonElement>) => void; onMouseLeave?: () => void; active?: boolean }) {
  if (query && !label.toLowerCase().includes(query.toLowerCase())) return null;
  return (
    <Button variant="ghost" size="sm" type="button" aria-pressed={active} className={cn(
      ROW_BUTTON_CLASS,
      active && "is-active bg-accent text-accent-foreground",
      danger && "danger text-destructive hover:bg-destructive/10 hover:text-destructive"
    )} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <Icon className={cn("h-4 w-4 shrink-0", danger && "text-destructive")} /><span>{label}</span>{badge ? <em>{badge}</em> : null}{shortcut && <kbd>{shortcut}</kbd>}{suffix && <span className="menu-suffix">{suffix}</span>}
    </Button>
  );
}
