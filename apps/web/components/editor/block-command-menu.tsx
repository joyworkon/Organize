"use client";

import type { Editor } from "@tiptap/core";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BLOCK_COMMANDS, commandMatches } from "./block-commands";
import { EditorPopover } from "./editor-popover";
import type { EditorMenuPoint } from "./types";

export function BlockCommandMenu({
  editor,
  pos,
  point,
  onClose,
}: {
  editor: Editor;
  pos: number;
  point: EditorMenuPoint;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => BLOCK_COMMANDS.filter((item) => commandMatches(item, query)), [query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActiveIndex(0), [query]);

  const execute = (index: number) => {
    const command = options[index];
    if (!command) return;
    command.run(editor, pos);
    onClose();
  };

  const categories = ["建议", "基本区块", "媒体", "布局"] as const;

  return (
    <EditorPopover point={point} onClose={onClose} className="block-command-popover">
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
      <button className="editor-menu-close" type="button" onClick={onClose}><span>关闭菜单</span><kbd>esc</kbd></button>
    </EditorPopover>
  );
}
