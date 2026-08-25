"use client";

/**
 * 笔记内块搜索（E7）：按块粒度搜索当前笔记并跳转定位。
 *
 * - 搜索范围：全部 textblock（段落/标题/代码块/表格单元格/折叠摘要/callout 内段落等），
 *   容器块（callout/表格/列布局）不重复计入——其内部文本块已单独命中。
 * - 大小写不敏感；每个块只列一次（取首个命中位置做片段）。
 * - 跳转：nodeDOM(pos) 滚动到视口中心并短暂高亮（organize-search-hit）。
 */

import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchHit {
  /** 块在文档中的位置（用于 nodeDOM 定位） */
  pos: number;
  /** 块类型名（heading/paragraph/codeBlock…） */
  type: string;
  /** 块 id（存在时；用于 data-id 查找回退） */
  id: string | null;
  /** 命中片段：前文 + 命中词 + 后文 */
  snippet: { before: string; match: string; after: string };
}

/** 每块只取首个命中，片段上下文各取约 24 个字符 */
export function buildSnippet(
  text: string,
  matchIndex: number,
  queryLength: number,
  radius = 24
): { before: string; match: string; after: string } {
  const before = text.slice(Math.max(0, matchIndex - radius), matchIndex);
  const match = text.slice(matchIndex, matchIndex + queryLength);
  const after = text.slice(matchIndex + queryLength, matchIndex + queryLength + radius);
  return { before, match, after };
}

/** 命中归属到这些父节点：跳转与高亮作用于整行/单元格，而不是其中的段落 */
const ATTRIBUTED_PARENTS = new Set(["listItem", "taskItem", "tableCell", "tableHeader"]);

/** 在文档中按 textblock 粒度搜索；query 为空返回空数组 */
export function searchTextBlocks(
  doc: ProseMirrorNode,
  query: string,
  limit = 100
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  doc.descendants((node, pos) => {
    if (hits.length >= limit) return false;
    // 只匹配 textblock：容器块的文本由其内部 textblock 单独命中，避免重复
    if (!node.isTextblock) return true;
    const text = node.textContent;
    if (!text) return true;
    const index = text.toLowerCase().indexOf(q);
    if (index === -1) return true;

    let type = node.type.name;
    let id = typeof node.attrs?.id === "string" ? node.attrs.id : null;
    let hitPos = pos;
    // 列表项/任务项/单元格内的段落：归属到父节点，跳转高亮整个视觉单元
    try {
      const $pos = doc.resolve(pos);
      const parent = $pos.node($pos.depth);
      if (ATTRIBUTED_PARENTS.has(parent.type.name)) {
        type = parent.type.name;
        hitPos = $pos.before($pos.depth);
        id = typeof parent.attrs?.id === "string" ? parent.attrs.id : null;
      }
    } catch {
      // resolve 失败时退回段落自身定位
    }
    hits.push({
      pos: hitPos,
      type,
      id,
      snippet: buildSnippet(text, index, q.length),
    });
    return true;
  });
  return hits;
}

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

export function SearchInNoteDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hits = useMemo(() => searchTextBlocks(editor.state.doc, query), [editor, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // 卸载时清理高亮定时器与残留样式
  useEffect(() => {
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      document
        .querySelectorAll(".organize-search-hit")
        .forEach((el) => el.classList.remove("organize-search-hit"));
    };
  }, []);

  const jumpTo = useCallback(
    (hit: SearchHit) => {
      const element = editor.view.nodeDOM(hit.pos);
      if (!(element instanceof HTMLElement)) return;
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      // 短暂高亮；先清掉上一次的，避免多块同时高亮
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      document
        .querySelectorAll(".organize-search-hit")
        .forEach((el) => el.classList.remove("organize-search-hit"));
      element.classList.add("organize-search-hit");
      highlightTimer.current = setTimeout(() => {
        element.classList.remove("organize-search-hit");
      }, 2400);
    },
    [editor]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (hits.length ? (prev + 1) % hits.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (hits.length ? (prev - 1 + hits.length) % hits.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[activeIndex];
      if (hit) {
        jumpTo(hit);
        setActiveIndex((prev) => (hits.length ? (prev + 1) % hits.length : 0));
      }
    }
  };

  return (
    <div
      className="editor-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="editor-dialog" role="dialog" aria-modal="true" aria-label="页面内搜索">
        <div className="editor-dialog-title">
          <div>
            <Search className="h-4 w-4" />
            页面内搜索
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="editor-dialog-search">
          <Search className="h-4 w-4" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索本页内容…"
            aria-label="搜索本页内容"
          />
        </div>
        <div className="note-search-results">
          {query.trim() === "" ? (
            <p className="note-search-empty">输入关键词，按块定位并跳转（↑↓ 选择，Enter 跳转）</p>
          ) : hits.length === 0 ? (
            <p className="note-search-empty">没有匹配的内容</p>
          ) : (
            <>
              <p className="note-search-count">{hits.length} 个结果</p>
              <ul role="listbox" aria-label="搜索结果">
                {hits.map((hit, index) => (
                  <li key={`${hit.pos}-${hit.id ?? ""}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={cn(index === activeIndex && "active")}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        setActiveIndex(index);
                        jumpTo(hit);
                      }}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
