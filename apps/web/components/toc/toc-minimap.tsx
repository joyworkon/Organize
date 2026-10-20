"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { List } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 全站统一的目录导航（阅读页、笔记编辑器共用）。
 *
 * 宽屏：正文左侧的「缩略刻度」——每个标题一条短横线，按级别缩进；当前所在章节的横线为前景色。
 * 悬停 / 键盘聚焦某条横线：横线伸长变黑，右侧浮出卡片（标题 + 该节正文摘要），点横线或卡片平滑跳转。
 * 窄屏：可选的底部抽屉列表（mobileSheet）。少于 2 个标题时不渲染。
 *
 * 直接读正文 DOM（root 内的 h1-h3 与折叠标题 summary[data-level]），
 * 用 MutationObserver 跟随内容变化，不依赖各页面各自的标题解析。
 */

export interface TocMinimapEntry {
  key: string;
  text: string;
  level: number;
  snippet: string;
  el: HTMLElement;
}

const HEADING_SELECTOR = "h1, h2, h3, summary[data-level]";
const SNIPPET_MAX = 140;
/** 滚动监听判定「当前章节」的视口顶部偏移（顶栏高度 + 余量） */
const SPY_OFFSET = 120;

function headingLevel(el: HTMLElement): number {
  if (el.tagName === "SUMMARY") return Math.min(3, Math.max(1, Number(el.dataset.level) || 1));
  return Number(el.tagName.slice(1)) || 1;
}

function sectionSnippet(root: HTMLElement, heading: HTMLElement, next: HTMLElement | undefined): string {
  try {
    const range = document.createRange();
    range.setStartAfter(heading);
    if (next) range.setEndBefore(next);
    else range.setEnd(root, root.childNodes.length);
    const text = range.toString().replace(/\s+/g, " ").trim();
    return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX)}…` : text;
  } catch {
    return "";
  }
}

/**
 * 章节摘要：取到下一个同级或更高级标题为止；若这一段没有正文（标题下紧跟子标题，
 * 或导入文章的标题层级被拍平），继续往后取，直到拿到文字。
 */
function snippetFor(root: HTMLElement, els: HTMLElement[], index: number): string {
  const el = els[index];
  const sameOrHigher = els.slice(index + 1).find((next) => headingLevel(next) <= headingLevel(el));
  const direct = sectionSnippet(root, el, sameOrHigher);
  if (direct) return direct;
  for (let i = index + 1; i < Math.min(els.length, index + 4); i += 1) {
    const text = sectionSnippet(root, els[i], els[i + 1]);
    if (text) return text;
  }
  return "";
}

export function readTocEntries(root: HTMLElement): TocMinimapEntry[] {
  const els = Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)).filter(
    (el) => (el.textContent || "").trim().length > 0
  );
  return els.map((el, index) => ({
    key: `${index}:${(el.textContent || "").trim()}`,
    text: (el.textContent || "").trim(),
    level: headingLevel(el),
    snippet: snippetFor(root, els, index),
    el,
  }));
}

/** 跳转：先展开所在的折叠块，再平滑滚动到标题 */
export function scrollToTocEntry(entry: Pick<TocMinimapEntry, "el">) {
  let parent = entry.el.parentElement;
  while (parent) {
    if (parent.tagName === "DETAILS" && !parent.hasAttribute("open")) parent.setAttribute("open", "");
    parent = parent.parentElement;
  }
  entry.el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollParentOf(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function activeIndexFor(entries: TocMinimapEntry[]): number {
  if (entries.length === 0) return 0;
  // 已滚到底：最后几节的标题到不了视口顶部，直接视为最后一节
  const scroller = scrollParentOf(entries[entries.length - 1].el);
  if (scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
    return entries.length - 1;
  }
  let active = 0;
  entries.forEach((entry, index) => {
    if (entry.el.getBoundingClientRect().top <= SPY_OFFSET) active = index;
  });
  return active;
}

interface TocMinimapProps {
  /** 正文根节点（阅读页 .reader-content 容器 / 编辑器 view.dom） */
  root: HTMLElement | null;
  /** 窄屏是否提供底部抽屉目录。阅读页与笔记页传入 true。 */
  mobileSheet?: boolean;
  className?: string;
}

export function TocMinimap({ root, mobileSheet = false, className }: TocMinimapProps) {
  const [entries, setEntries] = useState<TocMinimapEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [wide, setWide] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const dashRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hideTimer = useRef<number | null>(null);

  // 读取标题，内容变化时（编辑、异步加载）按帧合并重读
  useEffect(() => {
    if (!root) {
      setEntries([]);
      return;
    }
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = readTocEntries(root);
        setEntries(next);
        setActiveIndex(next.length ? activeIndexFor(next) : 0);
      });
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [root]);

  // 宽屏判定 + 横向位置跟随正文左缘
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      setWide(media.matches);
      if (root) setLeft(Math.max(8, root.getBoundingClientRect().left - 48));
    };
    update();
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    const ro = root ? new ResizeObserver(update) : null;
    if (root && ro) ro.observe(root);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [root]);

  // 滚动监听：捕获阶段监听任意滚动容器（窗口或页面内部的滚动区）
  useEffect(() => {
    if (entries.length < 2) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setActiveIndex(activeIndexFor(entries));
        if (root) setLeft(Math.max(8, root.getBoundingClientRect().left - 48));
      });
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [entries, root]);

  const clearHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const showCard = useCallback((index: number) => {
    clearHide();
    const dash = dashRefs.current[index];
    if (!dash) return;
    const rect = dash.getBoundingClientRect();
    setHoverIndex(index);
    setAnchor({ top: rect.top + rect.height / 2, left: rect.right });
  }, []);

  // 鼠标从横线移到卡片的途中不闪断：离开后给一小段宽限，进入卡片即取消
  const hideCard = useCallback(() => {
    clearHide();
    hideTimer.current = window.setTimeout(() => {
      setHoverIndex(null);
      setAnchor(null);
    }, 80);
  }, []);

  useEffect(() => () => clearHide(), []);

  const jump = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return;
      scrollToTocEntry(entry);
      setActiveIndex(index);
      setSheetOpen(false);
    },
    [entries]
  );

  const minLevel = useMemo(() => Math.min(...entries.map((e) => e.level), 3), [entries]);

  if (entries.length < 2) return null;

  const hovered = hoverIndex !== null ? entries[hoverIndex] : null;

  return (
    <>
      {wide && left !== null && (
        <nav
          aria-label="目录"
          className={cn("toc-minimap fixed top-1/2 z-30 -translate-y-1/2", className)}
          style={{ left }}
          data-testid="toc-minimap"
        >
          <ul className="toc-minimap-list flex max-h-[70vh] flex-col gap-3 overflow-y-auto overflow-x-visible py-1 pr-2">
            {entries.map((entry, index) => {
              const active = index === activeIndex;
              const hot = index === hoverIndex;
              return (
                <li key={entry.key} className="flex">
                  <button
                    ref={(el) => {
                      dashRefs.current[index] = el;
                    }}
                    type="button"
                    aria-label={`跳转到：${entry.text}`}
                    aria-current={active ? "location" : undefined}
                    data-active={active || undefined}
                    onMouseEnter={() => showCard(index)}
                    onMouseLeave={hideCard}
                    onFocus={() => showCard(index)}
                    onBlur={hideCard}
                    onClick={() => jump(index)}
                    className="toc-minimap-hit group flex h-3 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    style={{ paddingLeft: (entry.level - minLevel) * 8 }}
                  >
                    <span
                      className={cn(
                        "toc-minimap-dash block h-0.5 rounded-full transition-[width,background-color] duration-200 ease-out",
                        hot ? "w-9 bg-foreground" : "w-[18px]",
                        !hot && (active ? "bg-foreground" : "bg-muted-foreground/30")
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {wide && hovered && anchor &&
        createPortal(
          <div
            role="tooltip"
            data-testid="toc-minimap-card"
            onMouseEnter={clearHide}
            onMouseLeave={hideCard}
            onClick={() => hoverIndex !== null && jump(hoverIndex)}
            className="toc-minimap-card fixed z-50 w-72 max-w-[min(18rem,calc(100vw-6rem))] -translate-y-1/2 cursor-pointer rounded-lg border bg-popover p-3.5 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-150"
            style={{ top: anchor.top, left: anchor.left + 8 }}
          >
            <p className="line-clamp-2 text-sm font-semibold leading-snug">{hovered.text}</p>
            {hovered.snippet && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{hovered.snippet}</p>
            )}
          </div>,
          document.body
        )}

      {mobileSheet && !wide && (
        <>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="fixed bottom-20 right-4 z-20 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
          >
            <List className="h-4 w-4" />
            目录
          </button>
          <div
            className={cn(
              "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
              sheetOpen ? "opacity-100" : "pointer-events-none opacity-0"
            )}
            onClick={() => setSheetOpen(false)}
          />
          <div
            className={cn(
              "fixed bottom-0 left-0 right-0 z-50 max-h-[60vh] overflow-y-auto rounded-t-xl border-t bg-background transition-transform duration-300 ease-out",
              sheetOpen ? "translate-y-0" : "translate-y-full"
            )}
            aria-hidden={!sheetOpen}
          >
            <div className="sticky top-0 flex items-center justify-between border-b bg-background px-4 py-3">
              <h4 className="text-sm font-semibold">目录</h4>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSheetOpen(false)}>
                关闭
              </Button>
            </div>
            <ul className="space-y-1 p-4">
              {entries.map((entry, index) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    onClick={() => jump(index)}
                    className={cn(
                      "block w-full rounded px-2 py-2 text-left text-sm transition-colors hover:text-foreground",
                      index === activeIndex ? "bg-primary/5 font-medium text-primary" : "text-muted-foreground"
                    )}
                    style={{ paddingLeft: 8 + (entry.level - minLevel) * 12 }}
                  >
                    {entry.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
