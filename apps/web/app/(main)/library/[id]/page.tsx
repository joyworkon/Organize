"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/reading/status-badge";
import { Toc, extractHeadings } from "@/components/reading/toc";
import { HighlightMenu } from "@/components/reading/highlight-menu";
import { HighlightsPanel } from "@/components/reading/highlights-panel";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { ReadingItem, ReadingStatus, Highlight, HighlightColor } from "@organize/shared";
import { ArrowLeft, ExternalLink, Loader2, Clock, Zap, BookOpen, Inbox, Highlighter, FileText, Maximize2, Minimize2, X } from "lucide-react";
import { estimateReadingTime, formatReadingTime } from "@/lib/reading-time";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { htmlToTextParagraphs } from "@/lib/tiptap-utils";
import type { JSONContent } from "@tiptap/core";
import Link from "next/link";
import { FavoriteButton } from "@/components/favorite-button";

interface RecommendedItem {
  id: string;
  title: string | null;
  url: string;
  site_name: string | null;
  content: string | null;
  reading_status: ReadingStatus;
  created_at: string;
  reading_progress: number;
  is_pinned?: boolean;
  tags?: { id: string; name: string }[];
}

function calculateRecommendScore(item: RecommendedItem, currentItem: RecommendedItem, now: number): number {
  let score = 0;
  let isSameDomain = false;
  try {
    isSameDomain = new URL(item.url).hostname === new URL(currentItem.url).hostname;
  } catch {}
  const currentTagNames = new Set((currentItem.tags || []).map((t) => t.name));
  const hasSameTag = (item.tags || []).some((t) => currentTagNames.has(t.name));

  if (isSameDomain && item.reading_status === "unread") score += 100;
  if (hasSameTag && item.reading_status === "reading") score += 80;
  if (item.reading_status === "unread") score += 40;
  if (item.is_pinned) score += 200;
  if (item.reading_status === "reading") score += 30;
  const ageMs = now - new Date(item.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 7) score += 10;
  const progress = item.reading_progress || 0;
  if (progress > 0 && progress < 0.3) score += 15;
  if (item.reading_status === "read") score -= 100;
  return score;
}

function getNextRecommendation(
  items: RecommendedItem[],
  currentId: string
): RecommendedItem | null {
  const others = items.filter((i) => i.id !== currentId);
  if (others.length === 0) return null;
  const current = items.find((i) => i.id === currentId);
  if (!current) return others[0];
  const now = Date.now();
  const sorted = [...others].sort(
    (a, b) =>
      calculateRecommendScore(b, current, now) - calculateRecommendScore(a, current, now)
  );
  return sorted[0];
}

export default function ReadingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = params.id as string;
  const supabase = createClient();
  const contentRef = useRef<HTMLDivElement>(null);
  const focusContentRef = useRef<HTMLDivElement>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressRef = useRef(0);
  const originalContentRef = useRef<string | null>(null);
  const originalFocusContentRef = useRef<string | null>(null);
  const [isConvertingToNote, setIsConvertingToNote] = useState(false);

  const [item, setItem] = useState<ReadingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [bionicMode, setBionicMode] = useState(false);
  const [otherItems, setOtherItems] = useState<RecommendedItem[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [showHighlightsPanel, setShowHighlightsPanel] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  const readingMinutes = item?.content ? estimateReadingTime(item.content) : null;
  const headings = useMemo(() => {
    if (!item?.content) return [];
    return extractHeadings(item.content);
  }, [item?.content]);

  const recommendedItem = useMemo(() => {
    return getNextRecommendation(otherItems, itemId);
  }, [otherItems, itemId]);

  useEffect(() => {
    async function loadItem() {
      const { data, error } = await supabase
        .from("reading_items")
        .select("*, tags:tags!item_tags(id, name)")
        .eq("id", itemId)
        .single();

      if (!error && data) {
        setItem(data as ReadingItem);
        progressRef.current = data.reading_progress || 0;
        if (data.reading_status === "unread") {
          await supabase
            .from("reading_items")
            .update({ reading_status: "reading" })
            .eq("id", itemId);
          setItem((prev) => prev ? { ...prev, reading_status: "reading" } : null);
        }

        if (data.reading_progress && data.reading_progress > 0.01) {
          const restoreScroll = () => {
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            if (docHeight > 0) {
              const targetY = docHeight * data.reading_progress;
              window.scrollTo({ top: targetY, behavior: "auto" });
            }
          };
          requestAnimationFrame(() => requestAnimationFrame(restoreScroll));
          const earlyTimer = setTimeout(restoreScroll, 600);
          const cleanup = () => {
            clearTimeout(earlyTimer);
            window.removeEventListener("load", onLoad);
          };
          const onLoad = () => {
            restoreScroll();
            cleanup();
          };
          window.addEventListener("load", onLoad);
          setTimeout(cleanup, 5000);
        }
      }
      setLoading(false);
    }
    loadItem();
  }, [itemId, supabase]);

  useEffect(() => {
    async function loadHighlights() {
      const { data, error } = await supabase
        .from("highlights")
        .select("*")
        .eq("reading_item_id", itemId)
        .order("created_at", { ascending: false });
      if (!error && data) {
        setHighlights(data as Highlight[]);
      }
    }
    if (itemId) {
      loadHighlights();
    }
  }, [itemId, supabase]);

  useEffect(() => {
    async function loadOtherItems() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("reading_items")
        .select("id, title, url, site_name, content, reading_status, created_at, reading_progress, is_pinned, tags:tags!item_tags(id, name)")
        .eq("user_id", user.id)
        .neq("id", itemId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) {
        setOtherItems(data as RecommendedItem[]);
      }
    }
    loadOtherItems();
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

  useEffect(() => {
    if (focusMode) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [focusMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusMode) {
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode]);

  const bionicWord = useCallback((word: string): string => {
    if (!word) return word;
    const mid = Math.ceil(word.length / 2);
    return `<b>${word.slice(0, mid)}</b>${word.slice(mid)}`;
  }, []);

  const bionicProcessText = useCallback((text: string): string => {
    return text.replace(/([\u4e00-\u9fa5]+|[a-zA-Z]+)/g, (match) => bionicWord(match));
  }, [bionicWord]);

  const applyBionicToElement = useCallback((el: HTMLElement) => {
    const walker = document.createTreeWalker(
      el,
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

  const applyBionicReading = useCallback(() => {
    const contentEl = contentRef.current;
    if (contentEl) {
      if (originalContentRef.current === null) {
        originalContentRef.current = contentEl.innerHTML;
      }
      applyBionicToElement(contentEl);
    }

    const focusEl = focusContentRef.current;
    if (focusEl) {
      if (originalFocusContentRef.current === null) {
        originalFocusContentRef.current = focusEl.innerHTML;
      }
      applyBionicToElement(focusEl);
    }
  }, [applyBionicToElement]);

  const restoreOriginalContent = useCallback(() => {
    const contentEl = contentRef.current;
    if (contentEl && originalContentRef.current !== null) {
      contentEl.innerHTML = originalContentRef.current;
      originalContentRef.current = null;
    }

    const focusEl = focusContentRef.current;
    if (focusEl && originalFocusContentRef.current !== null) {
      focusEl.innerHTML = originalFocusContentRef.current;
      originalFocusContentRef.current = null;
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
  }, [bionicMode, loading, item, applyBionicReading, restoreOriginalContent, focusMode]);

  useEffect(() => {
    setBionicMode(false);
    originalContentRef.current = null;
    originalFocusContentRef.current = null;
  }, [itemId]);

  const updateStatus = async (status: ReadingStatus) => {
    await supabase
      .from("reading_items")
      .update({ reading_status: status })
      .eq("id", itemId);
    setItem((prev) => prev ? { ...prev, reading_status: status } : null);
  };

  const handleConvertToNote = useCallback(async () => {
    if (!item || isConvertingToNote) return;
    setIsConvertingToNote(true);
    try {
      toast({ title: "正在创建笔记..." });

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "请先登录", variant: "destructive" });
        return;
      }

      const title = item.title || "无标题笔记";
      const paragraphs = htmlToTextParagraphs(item.content || "");
      const limitedParagraphs = paragraphs.slice(0, 50);

      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: title }]
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "原文链接：" },
              {
                type: "text",
                text: item.url,
                marks: [{ type: "link", attrs: { href: item.url, target: "_blank" } }]
              }
            ]
          },
          { type: "paragraph" },
          ...limitedParagraphs.map(p => ({
            type: "paragraph" as const,
            content: p.trim() ? [{ type: "text" as const, text: p.trim() }] : undefined
          })).filter(n => n.content)
        ]
      };

      const { data, error } = await supabase
        .from("notes")
        .insert({
          title,
          content,
          user_id: user.id,
          reading_item_id: itemId
        })
        .select()
        .single();

      if (error || !data) {
        toast({ title: "创建笔记失败", variant: "destructive" });
        return;
      }

      toast({ title: "笔记创建成功" });
      router.push(`/notes/${data.id}`);
    } catch {
      toast({ title: "创建笔记失败", variant: "destructive" });
    } finally {
      setIsConvertingToNote(false);
    }
  }, [item, itemId, supabase, router, isConvertingToNote]);

  const handleCreateHighlight = useCallback(async (content: string, color: HighlightColor) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "请先登录", variant: "destructive" });
        return;
      }
      const { data, error } = await supabase
        .from("highlights")
        .insert({
          user_id: user.id,
          reading_item_id: itemId,
          content,
          color,
        })
        .select()
        .single();
      if (error) {
        toast({ title: "高亮保存失败", variant: "destructive" });
        return;
      }
      if (data) {
        setHighlights((prev) => [data as Highlight, ...prev]);
        toast({ title: "高亮已添加" });
      }
    } catch {
      toast({ title: "高亮保存失败", variant: "destructive" });
    }
  }, [itemId, supabase]);

  const handleDeleteHighlight = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from("highlights")
        .delete()
        .eq("id", id);
      if (error) {
        toast({ title: "删除失败", variant: "destructive" });
        return;
      }
      setHighlights((prev) => prev.filter((h) => h.id !== id));
      const marks = document.querySelectorAll(`mark.hl-yellow, mark.hl-green, mark.hl-blue, mark.hl-pink, mark.hl-purple`);
      for (const mark of Array.from(marks)) {
        const highlight = highlights.find((h) => h.id === id);
        if (highlight && mark.textContent?.trim() === highlight.content.trim()) {
          const parent = mark.parentNode;
          while (mark.firstChild) {
            parent?.insertBefore(mark.firstChild, mark);
          }
          parent?.removeChild(mark);
          break;
        }
      }
      toast({ title: "高亮已删除" });
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    }
  }, [highlights, supabase]);

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
      <HighlightsPanel
        isOpen={showHighlightsPanel}
        onClose={() => setShowHighlightsPanel(false)}
        highlights={highlights}
        onDelete={handleDeleteHighlight}
      />
      <div className={cn(
        "max-w-3xl mx-auto xl:mx-0 xl:mr-auto xl:ml-0",
        showHighlightsPanel ? "xl:pr-72" : "xl:pr-72"
      )}>
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
              <Button
                variant="ghost"
                size="sm"
                className={`gap-1.5 ${focusMode ? "text-primary bg-primary/10" : ""}`}
                onClick={() => setFocusMode(!focusMode)}
              >
                <Maximize2 className="h-3.5 w-3.5" />
                专注
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={handleConvertToNote}
                disabled={isConvertingToNote}
              >
                {isConvertingToNote ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                笔记
              </Button>
              <FavoriteButton targetType="reading" targetId={itemId} />
              <Button
                variant="ghost"
                size="sm"
                className={`gap-1.5 ${showHighlightsPanel ? "text-primary bg-primary/10" : ""}`}
                onClick={() => setShowHighlightsPanel(!showHighlightsPanel)}
              >
                <Highlighter className="h-3.5 w-3.5" />
                高亮
                {highlights.length > 0 && (
                  <span className="ml-1 text-xs bg-primary/10 text-primary px-1.5 rounded-full">
                    {highlights.length}
                  </span>
                )}
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
        <HighlightMenu onCreateHighlight={handleCreateHighlight}>
          <div
            ref={contentRef}
            className="prose prose-sm sm:prose max-w-none px-4 xl:px-0
              prose-headings:font-bold prose-a:text-primary
              prose-img:rounded-lg prose-img:shadow-sm"
            dangerouslySetInnerHTML={{ __html: item.content || "<p>无法提取正文内容</p>" }}
          />
        </HighlightMenu>

        {/* 下一篇推荐 */}
        <div className="pb-24 px-4 xl:px-0 mt-12">
          {recommendedItem ? (
            <Link href={`/library/${recommendedItem.id}`}>
              <div className="border rounded-md p-4 hover:bg-accent transition-colors cursor-pointer">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <BookOpen className="h-4 w-4" />
                  <span>📖 继续阅读</span>
                </div>
                <h3 className="font-semibold text-lg mb-2">
                  {recommendedItem.title || "无标题"}
                </h3>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>
                    {recommendedItem.site_name ||
                      (() => {
                        try {
                          return new URL(recommendedItem.url).hostname;
                        } catch {
                          return "未知来源";
                        }
                      })()}
                  </span>
                  {recommendedItem.content && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatReadingTime(estimateReadingTime(recommendedItem.content))}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </Link>
          ) : (
            <Link href="/inbox">
              <div className="border rounded-md p-4 hover:bg-accent transition-colors cursor-pointer text-center">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Inbox className="h-4 w-4" />
                  <span>🎉 暂无更多文章，去收集箱看看</span>
                </div>
              </div>
            </Link>
          )}
        </div>

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

      {/* 专注模式全屏覆盖层 */}
      {focusMode && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto animate-in fade-in duration-200">
          <Button
            variant="ghost"
            size="icon"
            className="fixed top-4 right-4 z-10 h-10 w-10 rounded-full bg-background/80 backdrop-blur hover:bg-accent"
            onClick={() => setFocusMode(false)}
          >
            <X className="h-5 w-5" />
          </Button>
          <div className="max-w-2xl mx-auto px-6 py-16">
            <header className="mb-8">
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
            <HighlightMenu onCreateHighlight={handleCreateHighlight}>
              <div
                ref={focusContentRef}
                className="prose prose-lg max-w-none
                  prose-headings:font-bold prose-a:text-primary
                  prose-img:rounded-lg prose-img:shadow-sm
                  prose-p:leading-relaxed"
                dangerouslySetInnerHTML={{ __html: item.content || "<p>无法提取正文内容</p>" }}
              />
            </HighlightMenu>
            <div className="mt-16 pt-8 border-t text-center">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => setFocusMode(false)}
              >
                <Minimize2 className="h-4 w-4" />
                退出专注模式
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
