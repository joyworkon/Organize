"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/reading/status-badge";
import { Toc, extractHeadings } from "@/components/reading/toc";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { ReadingItem, ReadingStatus } from "@organize/shared";
import { ArrowLeft, ExternalLink, Loader2, Clock, Zap } from "lucide-react";
import { estimateReadingTime, formatReadingTime } from "@/lib/reading-time";
import Link from "next/link";

export default function ReadingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = params.id as string;
  const supabase = createClient();
  const contentRef = useRef<HTMLDivElement>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressRef = useRef(0);
  const originalContentRef = useRef<string | null>(null);

  const [item, setItem] = useState<ReadingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [bionicMode, setBionicMode] = useState(false);

  const readingMinutes = item?.content ? estimateReadingTime(item.content) : null;
  const headings = useMemo(() => {
    if (!item?.content) return [];
    return extractHeadings(item.content);
  }, [item?.content]);

  useEffect(() => {
    async function loadItem() {
      const { data, error } = await supabase
        .from("reading_items")
        .select("*")
        .eq("id", itemId)
        .single();

      if (!error && data) {
        setItem(data as ReadingItem);
        progressRef.current = data.reading_progress || 0;
        // 打开时自动标记为 reading
        if (data.reading_status === "unread") {
          await supabase
            .from("reading_items")
            .update({ reading_status: "reading" })
            .eq("id", itemId);
          setItem((prev) => prev ? { ...prev, reading_status: "reading" } : null);
        }

        // 恢复阅读进度：等 DOM 渲染完再滚动
        if (data.reading_progress && data.reading_progress > 0.01) {
          // 让浏览器先布局（rAF）+ 延时等图片占位
          const restoreScroll = () => {
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            if (docHeight > 0) {
              const targetY = docHeight * data.reading_progress;
              window.scrollTo({ top: targetY, behavior: "auto" });
            }
          };
          requestAnimationFrame(() => requestAnimationFrame(restoreScroll));
          // 图片加载完会改变文档高度，再滚一次补偿
          const earlyTimer = setTimeout(restoreScroll, 600);
          // 仅恢复一次：用标记避免和滚动监听冲突
          const cleanup = () => {
            clearTimeout(earlyTimer);
            window.removeEventListener("load", onLoad);
          };
          const onLoad = () => {
            restoreScroll();
            cleanup();
          };
          window.addEventListener("load", onLoad);
          // 安全兜底：5 秒后无论如何清理
          setTimeout(cleanup, 5000);
        }
      }
      setLoading(false);
    }
    loadItem();
  }, [itemId, supabase]);

  // 基于滚动位置自动更新阅读进度
  const handleScroll = useCallback(() => {
    if (progressTimerRef.current) return;

    progressTimerRef.current = setTimeout(() => {
      progressTimerRef.current = null;

      const scrollY = window.scrollY;
      const visibleHeight = window.innerHeight;
      const fullHeight = document.documentElement.scrollHeight;
      // 底部 fixed 操作栏占用的视口高度（约 64px），算进"有效可视区"
      const bottomBarHeight = 80;
      // 可滚动的最大距离
      const maxScroll = fullHeight - visibleHeight;
      if (maxScroll <= 0) {
        // 内容不足以滚动，直接视为已读
        if (progressRef.current < 1) {
          progressRef.current = 1;
          setItem((prev) =>
            prev ? { ...prev, reading_progress: 1, reading_status: "read" } : null
          );
          supabase
            .from("reading_items")
            .update({ reading_progress: 1, reading_status: "read" })
            .eq("id", itemId);
        }
        return;
      }

      // 进度比例（clamp 到 0-1）
      let progress = Math.min(Math.max(scrollY / maxScroll, 0), 1);

      // 关键修复：当距离底部很近时（≤ 底部栏高度 + 60px 缓冲），直接判定为已读完
      // 这样底部 fixed 操作栏的留白不会阻止触发"已读"
      const distanceToBottom = fullHeight - (scrollY + visibleHeight);
      const reachedBottom = distanceToBottom <= bottomBarHeight + 60;
      if (reachedBottom) {
        progress = 1;
      }

      // 只有进度增加时才更新，避免重复写入
      if (progress <= progressRef.current) return;
      progressRef.current = progress;

      // 已读完：到底 或者 进度 ≥ 85%（降低阈值，配合到底判断双保险）
      const newStatus: ReadingStatus =
        reachedBottom || progress >= 0.85 ? "read" : "reading";

      // 先更新本地状态
      setItem((prev) =>
        prev ? { ...prev, reading_progress: progress, reading_status: newStatus } : null
      );

      // 在 setState 外部执行数据库写入（避免 reducer 副作用）
      supabase
        .from("reading_items")
        .update({ reading_progress: progress, reading_status: newStatus })
        .eq("id", itemId);
    }, 500);
  }, [itemId, supabase]);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const bionicWord = useCallback((word: string): string => {
    if (!word) return word;
    const mid = Math.ceil(word.length / 2);
    return `<b>${word.slice(0, mid)}</b>${word.slice(mid)}`;
  }, []);

  const bionicProcessText = useCallback((text: string): string => {
    return text.replace(/([\u4e00-\u9fa5]+|[a-zA-Z]+)/g, (match) => bionicWord(match));
  }, [bionicWord]);

  const applyBionicReading = useCallback(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    if (originalContentRef.current === null) {
      originalContentRef.current = contentEl.innerHTML;
    }

    const walker = document.createTreeWalker(
      contentEl,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tagName = parent.tagName.toLowerCase();
          if (tagName === "script" || tagName === "style" || tagName === "b") {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.textContent || node.textContent.trim() === "") {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes: Text[] = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      textNodes.push(currentNode as Text);
      currentNode = walker.nextNode();
    }

    textNodes.forEach((textNode) => {
      const originalText = textNode.textContent || "";
      const processedHtml = bionicProcessText(originalText);

      const tempSpan = document.createElement("span");
      tempSpan.innerHTML = processedHtml;

      const parent = textNode.parentNode;
      if (parent) {
        while (tempSpan.firstChild) {
          parent.insertBefore(tempSpan.firstChild, textNode);
        }
        parent.removeChild(textNode);
      }
    });
  }, [bionicProcessText]);

  const restoreOriginalContent = useCallback(() => {
    const contentEl = contentRef.current;
    if (contentEl && originalContentRef.current !== null) {
      contentEl.innerHTML = originalContentRef.current;
      originalContentRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (loading || !item) return;

    const timer = setTimeout(() => {
      if (bionicMode) {
        applyBionicReading();
      } else {
        restoreOriginalContent();
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [bionicMode, loading, item, applyBionicReading, restoreOriginalContent]);

  useEffect(() => {
    setBionicMode(false);
    originalContentRef.current = null;
  }, [itemId]);

  const updateStatus = async (status: ReadingStatus) => {
    await supabase
      .from("reading_items")
      .update({ reading_status: status })
      .eq("id", itemId);
    setItem((prev) => prev ? { ...prev, reading_status: status } : null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        内容不存在或已被删除
        <br />
        <Link href="/library" className="text-primary underline text-sm mt-2 inline-block">
          返回阅读库
        </Link>
      </div>
    );
  }

  return (
    <div className="relative xl:max-w-[calc(65rem+16rem)] xl:mx-auto">
      <Toc headings={headings} containerRef={contentRef} />
      <div className="max-w-3xl mx-auto xl:mx-0 xl:mr-auto xl:ml-0 xl:pr-72">
        {/* 顶栏 */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b py-3 mb-6 -mx-4 px-4 xl:mx-0 xl:rounded-t-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/library">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <Breadcrumb className="min-w-0">
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden sm:inline-flex">
                    <BreadcrumbLink href="/">首页</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden sm:block" />
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/library">阅读库</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbPage
                      className="max-w-[20ch] sm:max-w-[30ch]"
                      title={item.title ?? undefined}
                    >
                      {item.title || "无标题"}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className={`gap-1.5 ${bionicMode ? "text-primary bg-primary/10" : ""}`}
                onClick={() => setBionicMode(!bionicMode)}
              >
                <Zap className="h-3.5 w-3.5" />
                速读
              </Button>
              <StatusBadge status={item.reading_status} />
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-2">
                  <ExternalLink className="h-3.5 w-3.5" />
                  原文
                </Button>
              </a>
            </div>
          </div>
          {/* 进度条 */}
          <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${Math.round(item.reading_progress * 100)}%` }}
            />
          </div>
        </div>

        {/* 文章标题 */}
        <header className="mb-8 px-4 xl:px-0">
          <h1 className="text-2xl md:text-3xl font-bold leading-tight">
            {item.title}
          </h1>
          <div className="flex items-center gap-3 mt-3 text-sm text-muted-foreground flex-wrap">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              {new URL(item.url).hostname}
            </a>
            <span>·</span>
            <span>{new Date(item.created_at).toLocaleDateString("zh-CN")}</span>
            {readingMinutes && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span>{formatReadingTime(readingMinutes)}</span>
                </span>
              </>
            )}
          </div>
        </header>

        {/* 文章内容 */}
        <div
          ref={contentRef}
          className="prose prose-sm sm:prose max-w-none pb-20 px-4 xl:px-0
            prose-headings:font-bold prose-a:text-primary
            prose-img:rounded-lg prose-img:shadow-sm"
          dangerouslySetInnerHTML={{ __html: item.content || "<p>无法提取正文内容</p>" }}
        />

        {/* 底部操作 */}
        <div className="organize-sidebar-fixed-left fixed bottom-0 left-0 right-0 border-t bg-background/95 p-3 backdrop-blur transition-[left] duration-200">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              阅读进度: {Math.round(item.reading_progress * 100)}%
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateStatus("unread")}
              >
                标记未读
              </Button>
              <Button
                size="sm"
                onClick={() => updateStatus("read")}
              >
                标记已读
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
