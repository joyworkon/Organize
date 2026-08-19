"use client";

import type { Editor } from "@tiptap/core";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BLOCK_COMMANDS, commandMatches } from "./block-commands";
import { EditorPopover } from "./editor-popover";
import { resolveTriggerDeleteRange } from "./slash-trigger";
import type { EditorMenuPoint } from "./types";

// 不允许在嵌套块（表格/列表/分栏内）使用的命令
const NESTED_BLOCKED_COMMANDS = new Set(["table", "page", "ai-notes", "columns-2", "columns-3", "columns-4", "columns-5"]);

export function BlockCommandMenu({
  editor,
  pos,
  point,
  clearTrigger = false,
  nested = false,
  range,
  onClose,
}: {
  editor: Editor;
  pos: number;
  point: EditorMenuPoint;
  /** 由 "/" 触发时为 true：执行/关闭时需清掉块里的触发字符；⌘/ 打开时为 false，块内容必须保留 */
  clearTrigger?: boolean;
  /** 嵌套场景（表格/列表内等） */
  nested?: boolean;
  /** 斜杠触发文本的范围 */
  range?: { from: number; to: number };
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 嵌套场景下过滤掉不适用的命令
  const availableCommands = useMemo(() => {
    if (!nested) return BLOCK_COMMANDS;
    return BLOCK_COMMANDS.filter((cmd) => !NESTED_BLOCKED_COMMANDS.has(cmd.id));
  }, [nested]);

  const options = useMemo(() => availableCommands.filter((item) => commandMatches(item, query)), [availableCommands, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActiveIndex(0), [query]);

  // 删除唤出菜单时输入的触发字符（"/" 及可能跟随输入的字符）
  const clearTriggerText = () => {
    if (!clearTrigger) return;
    if (nested && range) {
      // 嵌套场景：精确删除 "/" 及后续输入的字符
      editor.chain().deleteRange(range).run();
    } else {
      // 顶层场景：只删除 suggestion 给出的触发符范围（"/"），保留块内已有文字；
      // 查询词输入在菜单自己的输入框里，不在文档中，绝不能删到块尾
      const node = editor.state.doc.nodeAt(pos);
      if (!node || !node.isTextblock || !node.content.size) return;
      const delRange = resolveTriggerDeleteRange({
        range,
        blockPos: pos,
        blockNodeSize: node.nodeSize,
        blockText: node.textContent,
      });
      if (delRange) editor.chain().deleteRange(delRange).run();
    }
  };

  const handleClose = () => {
    if (clearTrigger) {
      if (nested && range) {
        // 检查是否还有未处理的触发文本
        const textBetween = editor.state.doc.textBetween(range.from, range.to, "");
        if (textBetween.startsWith("/")) {
          editor.chain().deleteRange(range).run();
        }
      } else {
        const node = editor.state.doc.nodeAt(pos);
        if (node?.isTextblock && node.textContent === "/") {
          editor.chain().deleteRange({ from: pos + 1, to: pos + node.nodeSize - 1 }).run();
        }
      }
    }
    onClose();
  };

  const execute = (index: number) => {
    const command = options[index];
    if (!command) return;

    if (nested && range) {
      // 嵌套场景：在一个 chain 中删除触发文本并插入内容
      executeNestedCommand(editor, command.id, range);
    } else {
      clearTriggerText();
      command.run(editor, pos);
    }

    onClose();
  };

  const categories = ["建议", "基本区块", "媒体", "布局"] as const;

  return (
    <EditorPopover point={point} onClose={handleClose} className="block-command-popover">
      <div className="editor-menu-search">
        <Search className="h-4 w-4" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((value) => Math.min(value + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              execute(activeIndex);
            }
          }}
          placeholder="输入以筛选…"
          aria-label="筛选区块"
        />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="清空"><X className="h-3.5 w-3.5" /></button>}
      </div>
      <div className="editor-menu-scroll" role="listbox">
        {options.length === 0 && <div className="editor-menu-empty">没有匹配的区块</div>}
        {categories.map((category) => {
          const entries = options.filter((item) => item.category === category);
          if (!entries.length) return null;
          return (
            <div key={category} className="editor-menu-group">
              <div className="editor-menu-label">{category}</div>
              {entries.map((command) => {
                const index = options.indexOf(command);
                const Icon = command.icon;
                return (
                  <button
                    key={command.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? "is-active" : ""}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => execute(index)}
                  >
                    <Icon className="h-5 w-5" />
                    <span><strong>{command.label}</strong>{command.description && <small>{command.description}</small>}</span>
                    {command.shortcut && <kbd>{command.shortcut}</kbd>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <button className="editor-menu-close" type="button" onClick={handleClose}><span>关闭菜单</span><kbd>esc</kbd></button>
    </EditorPopover>
  );
}

// 在嵌套场景（如表格单元格内）执行命令：在一个 chain 中删除触发文本并插入内容
function executeNestedCommand(editor: Editor, commandId: string, range: { from: number; to: number }) {
  // 对于 emit 类命令，派发事件让编辑器处理（事件处理器会负责删除 range 和插入内容）
  const emitCommands = ["image", "html", "math", "reference"];
  if (emitCommands.includes(commandId)) {
    editor.view.dom.dispatchEvent(
      new CustomEvent("organize-editor-action", {
        bubbles: true,
        detail: {
          type: commandId,
          pos: range.from,
          nested: true,
          range,
        },
      })
    );
    return;
  }

  // 直接插入内容的命令：先删除触发文本，再在当前光标位置插入内容
  // （deleteRange 后光标自动定位到删除位置，使用 insertContent 比 insertContentAt 更安全）
  let chain = editor.chain().focus().deleteRange(range);

  switch (commandId) {
    case "paragraph":
      chain = chain.insertContent({ type: "paragraph", content: [] });
      break;
    case "heading-1":
      chain = chain.insertContent({ type: "heading", attrs: { level: 1 }, content: [] });
      break;
    case "heading-2":
      chain = chain.insertContent({ type: "heading", attrs: { level: 2 }, content: [] });
      break;
    case "heading-3":
      chain = chain.insertContent({ type: "heading", attrs: { level: 3 }, content: [] });
      break;
    case "heading-4":
      chain = chain.insertContent({ type: "heading", attrs: { level: 4 }, content: [] });
      break;
    case "bullet-list":
      chain = chain.insertContent({
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [] }] }],
      });
      break;
    case "ordered-list":
      chain = chain.insertContent({
        type: "orderedList",
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [] }] }],
      });
      break;
    case "task-list":
      chain = chain.insertContent({
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }],
      });
      break;
    case "details":
      chain = chain.insertContent({
        type: "details",
        content: [
          { type: "detailsSummary", content: [] },
          { type: "detailsContent", content: [{ type: "paragraph" }] },
        ],
      });
      break;
    case "quote":
      chain = chain.insertContent({ type: "blockquote", content: [{ type: "paragraph" }] });
      break;
    case "code":
      chain = chain.insertContent({ type: "codeBlock", content: [] });
      break;
    case "callout":
      chain = chain.insertContent({ type: "callout", attrs: { emoji: "💡" }, content: [{ type: "paragraph" }] });
      break;
    case "toggle-heading-1":
      chain = chain.insertContent({
        type: "details",
        content: [
          { type: "detailsSummary", attrs: { level: 1 }, content: [] },
          { type: "detailsContent", content: [{ type: "paragraph" }] },
        ],
      });
      break;
    case "toggle-heading-2":
      chain = chain.insertContent({
        type: "details",
        content: [
          { type: "detailsSummary", attrs: { level: 2 }, content: [] },
          { type: "detailsContent", content: [{ type: "paragraph" }] },
        ],
      });
      break;
    case "toggle-heading-3":
      chain = chain.insertContent({
        type: "details",
        content: [
          { type: "detailsSummary", attrs: { level: 3 }, content: [] },
          { type: "detailsContent", content: [{ type: "paragraph" }] },
        ],
      });
      break;
    case "toggle-heading-4":
      chain = chain.insertContent({
        type: "details",
        content: [
          { type: "detailsSummary", attrs: { level: 4 }, content: [] },
          { type: "detailsContent", content: [{ type: "paragraph" }] },
        ],
      });
      break;
    case "divider":
      chain = chain.insertContent({ type: "horizontalRule" });
      break;
    default:
      break;
  }
  chain.run();
}
