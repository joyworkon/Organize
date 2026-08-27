"use client";

import { useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronRight,
  ListTree,
  MoreHorizontal,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildTocTree,
  collapsibleKeys,
  extractTocItems,
  flattenTocTree,
  tocKey,
  type TocItem,
} from "@/lib/notes/toc";

interface NoteTocPanelProps {
  editor: Editor | null;
  content: Record<string, unknown> | null;
  onClose: () => void;
}

/** 展开顶层块内所有折叠容器（details 的折叠态由 DOM open 属性控制）。 */
function expandCollapsedInBlock(blockEl: HTMLElement) {
  blockEl.querySelectorAll("details:not([open])").forEach((el) => {
    el.setAttribute("open", "");
  });
}

/**
 * 定位某个目录条目对应的 DOM 标题节点并滚动过去。
 * 定位策略：取顶层块索引对应的 DOM 子节点，在其中按文本匹配 heading。
 */
function scrollToTocItem(editor: Editor, item: TocItem) {
  const root = editor.view.dom as HTMLElement;
  const block = root.children[item.blockIndex] as HTMLElement | undefined;
  if (!block) return;
  if (item.inCollapsed) expandCollapsedInBlock(block);

  const selector = "h1, h2, h3";
  const candidates = Array.from(
    block.matches(selector) ? [block] : block.querySelectorAll(selector)
  );
  const target = candidates.find(
    (el) => (el.textContent || "").trim() === item.text
  ) as HTMLElement | undefined;
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function NoteTocPanel({ editor, content, onClose }: NoteTocPanelProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const tree = useMemo(() => buildTocTree(extractTocItems(content)), [content]);
  const flat = useMemo(() => flattenTocTree(tree), [tree]);

  // 折叠隐藏：折叠节点的后代不可见（遇到已折叠节点后跳过更深缩进的行）
  const displayRows = useMemo(() => {
    const rows: { item: TocItem; depth: number; hasChildren: boolean; key: string }[] = [];
    let skipBelowDepth: number | null = null;
    for (const row of flat) {
      if (skipBelowDepth !== null && row.depth > skipBelowDepth) continue;
      skipBelowDepth = null;
      const key = tocKey(row.item);
      rows.push({ ...row, key });
      if (row.hasChildren && collapsed.has(key)) skipBelowDepth = row.depth;
    }
    return rows;
  }, [flat, collapsed]);

  const allKeys = useMemo(() => collapsibleKeys(tree), [tree]);

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const collapseAll = () => setCollapsed(new Set(allKeys));
  const expandAll = () => setCollapsed(new Set());

  const scrollTop = () => {
    (editor?.view.dom as HTMLElement | undefined)
      ?.closest(".note-page")
      ?.querySelector(".note-title")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const scrollBottom = () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  };

  if (!editor) return null;

  return (
    <aside className="note-toc" aria-label="页面目录">
      <div className="note-toc-header">
        <span className="note-toc-title">
          <ListTree className="h-3.5 w-3.5" />
          目录
        </span>
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="目录选项"
                aria-label="目录选项"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={expandAll} disabled={allKeys.length === 0}>
                <ChevronsUpDown className="mr-2 h-4 w-4" />
                全部展开
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={collapseAll} disabled={allKeys.length === 0}>
                <ChevronsDownUp className="mr-2 h-4 w-4" />
                全部收起
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={scrollTop}>
                <ArrowUpToLine className="mr-2 h-4 w-4" />
                跳转到顶部
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={scrollBottom}>
                <ArrowDownToLine className="mr-2 h-4 w-4" />
                跳转到底部
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onClose}>
                <X className="mr-2 h-4 w-4" />
                关闭目录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
            title="关闭目录"
            aria-label="关闭目录"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="note-toc-body">
        {displayRows.length === 0 ? (
          <p className="note-toc-empty">暂无目录，在正文中使用标题（H1-H3）即可生成</p>
        ) : (
          displayRows.map((row) => (
            <div
              key={row.key}
              className="note-toc-row"
              style={{ paddingLeft: `${row.depth * 14 + 4}px` }}
            >
              <button
                type="button"
                className={cn("note-toc-collapse", !row.hasChildren && "invisible")}
                onClick={() => toggleCollapse(row.key)}
                aria-label={collapsed.has(row.key) ? "展开" : "收起"}
                tabIndex={row.hasChildren ? 0 : -1}
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform",
                    !collapsed.has(row.key) && "rotate-90"
                  )}
                />
              </button>
              <button
                type="button"
                className="note-toc-link"
                onClick={() => scrollToTocItem(editor, row.item)}
                title={row.item.text}
              >
                {row.item.text}
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
