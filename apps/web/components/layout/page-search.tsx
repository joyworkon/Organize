"use client";

import { forwardRef, useRef } from "react";
import { Search, X } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface PageSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** 无障碍名，默认取 placeholder */
  label?: string;
  className?: string;
  /** 命中数量播报（可选）：交给 aria-live 读，视觉上不显示 */
  liveHint?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

/**
 * 功能页页头内联搜索框（全站唯一形态）：
 * - 位置：与页面标题和主动作同一行（由 PageHeader 的 search 槽负责摆放）
 * - 视觉：未聚焦=浅灰底 + 无边框；聚焦=纸面底 + 中性焦点外框（"只有选中时才有外侧框"）
 * - 语义：只搜当前功能内的内容（标题 + 标签），不跨功能——跨功能搜索走 ⌘K 命令面板
 * 样式定义在 app/globals.css 的 `.organize-page-search*`（含暗色）。
 */
export const PageSearch = forwardRef<HTMLInputElement, PageSearchProps>(
  function PageSearch({ value, onChange, placeholder, label, className, liveHint, onKeyDown }, ref) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    return (
      <div className={cn("organize-page-search", className)}>
        <Search className="organize-page-search-icon" />
        <input
          ref={(element) => {
            inputRef.current = element;
            if (typeof ref === "function") ref(element);
            else if (ref) ref.current = element;
          }}
          type="search"
          className="organize-page-search-input"
          value={value}
          placeholder={placeholder}
          aria-label={label ?? placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {value.length > 0 && (
          <button
            type="button"
            className="organize-page-search-clear"
            onClick={() => { onChange(""); inputRef.current?.focus(); }}
            aria-label="清空搜索"
            title="清空搜索"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {liveHint && (
          <span className="sr-only" aria-live="polite">
            {liveHint}
          </span>
        )}
      </div>
    );
  }
);
