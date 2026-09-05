"use client";

import type { Editor } from "@tiptap/core";
import { Puzzle, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createEditorBridge } from "@/lib/plugin/editor-bridge";
import { slashCommandRegistry } from "@/lib/plugin/slash-commands";
import { BLOCK_COMMANDS, commandMatches, executeNestedCommand, isCommandAvailableInContext } from "./block-commands";
import { EditorPopover } from "./editor-popover";
import { resolveTriggerDeleteRange } from "./slash-trigger";
import type { BlockCommandDefinition, BlockCommandContext } from "./types";
import type { EditorMenuPoint } from "./types";

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

  // 插件贡献的斜杠命令（注册表订阅；插件停用后自动消失）
  const pluginSlashCommands = useSyncExternalStore(
    (onStoreChange) => slashCommandRegistry.subscribe(onStoreChange),
    () => slashCommandRegistry.list(),
    () => []
  );

  // 可用性由命令定义的 supportedContexts 统一判定（R06）：
  // 嵌套菜单只显示在嵌套上下文有真实执行路径的命令；插件命令需要顶层块位置语义
  const availableCommands = useMemo<BlockCommandDefinition[]>(() => {
    const builtin = BLOCK_COMMANDS.filter((cmd) => isCommandAvailableInContext(cmd, nested));
    if (nested || pluginSlashCommands.length === 0) return builtin;
    const pluginCommands: BlockCommandDefinition[] = pluginSlashCommands.map((entry) => ({
      id: entry.id,
      label: entry.command.icon ? `${entry.command.icon} ${entry.command.label}` : entry.command.label,
      description: entry.command.description,
      category: "插件",
      icon: Puzzle,
      keywords: entry.command.keywords ?? [],
      supportedContexts: ["top"] as const,
      run: (editor, pos) => {
        const bridge = createEditorBridge(editor, pos);
        return entry.command.handler(bridge, entry.ctx);
      },
    }));
    return [...builtin, ...pluginCommands];
  }, [nested, pluginSlashCommands]);

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
      // 嵌套场景：只有能真实处理的命令才消费触发字符（R06 一致性约定）；
      // unsupported 时不动文档——"/" 与已输入字符保留，用户可继续编辑
      const result = executeNestedCommand(editor, command.id, range);
      if (result !== "handled") {
        onClose();
        return;
      }
    } else {
      clearTriggerText();
      command.run(editor, pos);
    }

    onClose();
  };

  const categories = ["建议", "基本区块", "媒体", "布局", "插件"] as const;

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

