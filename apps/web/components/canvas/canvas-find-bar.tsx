"use client";

import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Search, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { CanvasFindHit } from "@/lib/canvas/board-find";

export function CanvasFindBar({ query, onQueryChange, hits, index, onStep, onClose, focusNonce }: {
  query: string;
  onQueryChange: (query: string) => void;
  hits: CanvasFindHit[];
  index: number;
  onStep: (step: 1 | -1) => void;
  onClose: () => void;
  focusNonce: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [focusNonce]);
  const current = hits[index];
  return (
    <div className="canvas-find-bar" data-testid="canvas-find-bar" role="search" aria-label="画布内查找"
      onKeyDown={(event) => {
        if (event.target !== inputRef.current) return;
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey) return;
        if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          onStep(event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey) ? -1 : 1);
        }
      }}>
      <div className="flex min-w-0 items-center gap-1">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)}
          aria-label="查找画布内容" placeholder="查找画布内容…"
          className="h-8 min-w-0 flex-1 rounded border-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" role="status" aria-live="polite">
          {hits.length ? index + 1 : 0} / {hits.length}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label="上一处" title="上一处（Shift+Enter / ↑）"
          disabled={!hits.length} onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(-1)}><ArrowUp className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="下一处" title="下一处（Enter / ↓）"
          disabled={!hits.length} onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(1)}><ArrowDown className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="关闭画布查找" title="关闭（Esc）" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <p className="canvas-find-snippet text-xs text-muted-foreground" aria-live="polite">
        {current ? <>{current.snippet.before}<mark className="bg-accent text-foreground">{current.snippet.match}</mark>{current.snippet.after}</>
          : query.trim() ? "无结果" : "输入关键词，Enter / ↑↓ 在命中间跳转"}
      </p>
    </div>
  );
}
