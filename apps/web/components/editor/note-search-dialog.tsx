"use client";

/**
 * 笔记内查找条（⌘F）：固定在编辑器壳顶部，不再用居中弹层。
 *
 * 键盘（焦点在查找 / 替换输入时）：Enter 下一处，Shift+Enter 上一处，
 * ↑/↓ 与按钮一样切换当前命中（计数、列表选中、正文高亮共用一个索引）。
 * 替换输入里 Enter 执行单处替换。Esc 关闭查找条并清高亮。
 * 结果列表在查询非空时展开，点一行跳到该命中。
 */

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Search, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { hasOpenDialog } from "@/lib/hooks/use-hotkey";
import {
  applyReplaceAll,
  applyReplaceAtHit,
  searchTextBlocks,
  type SearchHit,
} from "@/lib/editor/note-find-replace";
import { cn } from "@/lib/utils";

export { buildSnippet, searchTextBlocks } from "@/lib/editor/note-find-replace";
export type { SearchHit } from "@/lib/editor/note-find-replace";

const TYPE_LABELS: Record<string, string> = {
  heading: "标题",
  paragraph: "段落",
  codeBlock: "代码",
  listItem: "列表项",
  taskItem: "任务项",
  tableCell: "单元格",
  tableHeader: "表头",
  detailsSummary: "摘要",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] || type;
}

function clearSearchHighlights() {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".organize-search-hit").forEach((el) => {
    el.classList.remove("organize-search-hit");
  });
}

function hitElement(editor: Editor, pos: number): HTMLElement | null {
  if (editor.isDestroyed) return null;
  try {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) return dom;
    if (dom instanceof Text) return dom.parentElement;
  } catch {
    return null;
  }
  return null;
}

function safeIndex(hits: SearchHit[], activeIndex: number): number {
  if (!hits.length) return 0;
  return Math.min(activeIndex, hits.length - 1);
}

function keepFindFocus(event: React.MouseEvent) {
  event.preventDefault();
}

export function NoteFindBar({
  editor,
  onClose,
  focusNonce = 0,
}: {
  editor: Editor;
  onClose: () => void;
  /** 再次按 ⌘F 时递增，用来把焦点拉回查询框 */
  focusNonce?: number;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [, setDocVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollKeyRef = useRef("");
  const canReplace = editor.isEditable;

  // setDocVersion 在事务后触发重渲染；命中跟当前 doc 走，不把计数器本身塞进依赖。
  const doc = editor.state.doc;
  const hits = useMemo(() => searchTextBlocks(doc, query), [doc, query]);
  const index = safeIndex(hits, activeIndex);
  const current = hits[index] ?? null;
  const countLabel = !query.trim() ? "" : hits.length === 0 ? "0 / 0" : `${index + 1} / ${hits.length}`;

  useEffect(() => {
    const onUpdate = () => setDocVersion((version) => version + 1);
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusNonce]);

  const close = useCallback(() => {
    clearSearchHighlights();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      const inBar = target instanceof Node && rootRef.current?.contains(target);
      if (!inBar && hasOpenDialog()) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [close]);

  useEffect(() => {
    if (!query.trim() || !current) {
      clearSearchHighlights();
      scrollKeyRef.current = "";
      return;
    }
    const element = hitElement(editor, current.pos);
    clearSearchHighlights();
    if (!element) return;
    element.classList.add("organize-search-hit");
    const scrollKey = `${query}\0${current.pos}\0${index}`;
    if (scrollKeyRef.current !== scrollKey) {
      element.scrollIntoView?.({ block: "center", behavior: "smooth" });
      scrollKeyRef.current = scrollKey;
    }
    return () => clearSearchHighlights();
  }, [editor, query, current, index]);

  const go = useCallback((delta: number) => {
    if (!hits.length) return;
    setActiveIndex((safeIndex(hits, activeIndex) + delta + hits.length) % hits.length);
  }, [activeIndex, hits]);

  const replaceOne = useCallback(() => {
    const hit = hits[safeIndex(hits, activeIndex)];
    if (!hit || !canReplace) return;
    const beforePos = hit.textPos;
    if (!applyReplaceAtHit(editor, hit, query, replacement)) return;
    const nextHits = searchTextBlocks(editor.state.doc, query);
    if (!nextHits.length) {
      setActiveIndex(0);
      return;
    }
    const still = nextHits.findIndex((item) => item.textPos === beforePos);
    setActiveIndex(still >= 0 ? (still + 1) % nextHits.length : Math.min(activeIndex, nextHits.length - 1));
  }, [activeIndex, canReplace, editor, hits, query, replacement]);

  const replaceAll = useCallback(() => {
    if (!canReplace) return;
    if (applyReplaceAll(editor, query, replacement) > 0) setActiveIndex(0);
  }, [canReplace, editor, query, replacement]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    if (!(event.target instanceof HTMLInputElement)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      go(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      go(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const inReplacement = event.target.getAttribute("aria-label") === "替换为";
      if (inReplacement && !event.shiftKey) replaceOne();
      else go(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <div
      ref={rootRef}
      role="search"
      aria-label="页面内搜索"
      className="note-find-bar sticky top-0 z-40 mb-2 rounded-md border bg-background/95 shadow-sm"
      onKeyDown={onKeyDown}
    >
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          placeholder="搜索本页内容…"
          aria-label="搜索本页内容"
          className="h-8 min-w-[8rem] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <span role="status" aria-live="polite" className="min-w-[3.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground">{countLabel}</span>
        <Button type="button" variant="ghost" size="icon" aria-label="上一处" title="上一处（Shift+Enter）" disabled={!hits.length} onMouseDown={keepFindFocus} onClick={() => go(-1)}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="下一处" title="下一处（Enter）" disabled={!hits.length} onMouseDown={keepFindFocus} onClick={() => go(1)}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        {canReplace && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={replaceOpen ? "收起替换" : "展开替换"}
            aria-expanded={replaceOpen}
            title="替换"
            onMouseDown={keepFindFocus}
            onClick={() => setReplaceOpen((open) => !open)}
          >
            <ChevronDown className={cn("h-4 w-4", replaceOpen && "rotate-180")} />
            替换
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon" aria-label="关闭" title="关闭（Esc）" onMouseDown={keepFindFocus} onClick={close}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {canReplace && replaceOpen && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1.5">
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder="替换为…"
            aria-label="替换为"
            className="h-8 min-w-[8rem] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button type="button" variant="ghost" size="sm" aria-label="替换" disabled={!hits.length} onMouseDown={keepFindFocus} onClick={replaceOne}>
            替换
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-label="全部替换" disabled={!hits.length} onMouseDown={keepFindFocus} onClick={replaceAll}>
            全部替换
          </Button>
        </div>
      )}
      {query.trim() === "" ? (
        <p className="note-search-empty">输入关键词，↑↓ 或 Enter 在命中间跳转</p>
      ) : (
        <div className="note-search-results border-t border-border">
          {hits.length === 0 ? (
            <p className="note-search-empty">无结果</p>
          ) : (
            <ul aria-label="搜索结果">
              {hits.map((hit, hitIndex) => (
                <li key={`${hit.textPos}-${hit.pos}`}>
                  <button
                    type="button"
                    aria-current={hitIndex === index ? "true" : undefined}
                    aria-label={`跳转到第 ${hitIndex + 1} 处`}
                    className={cn(hitIndex === index && "active")}
                    onMouseDown={keepFindFocus}
                    onClick={() => setActiveIndex(hitIndex)}
                  >
                    <span className="note-search-type">{typeLabel(hit.type)}</span>
                    <span className="note-search-snippet">
                      {hit.snippet.before}
                      <mark>{hit.snippet.match}</mark>
                      {hit.snippet.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
