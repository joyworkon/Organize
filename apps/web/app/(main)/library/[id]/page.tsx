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
import { ArrowLeft, ExternalLink, Loader2, Clock, Zap, BookOpen, Inbox, Highlighter, FileText, Maximize2, Minimize2, X, Share2, StretchHorizontal } from "lucide-react";
import { estimateReadingTime, formatReadingTime } from "@/lib/reading-time";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { htmlToTextParagraphs } from "@/lib/tiptap-utils";
import type { JSONContent } from "@tiptap/core";
import Link from "next/link";
import { FavoriteButton } from "@/components/favorite-button";
import { ShareDialog } from "@/components/share/share-dialog";
import { prepareReadingContent } from "@/lib/reading-images";
import type { HighlightReferenceState } from "@/lib/reading/highlight-references";

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
  const supabase = useMemo(() => createClient(), []);
  const contentRef = useRef<HTMLDivElement>(null);
  const focusContentRef = useRef<HTMLDivElement>(null);
  const focusScrollContainerRef = useRef<HTMLDivElement>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressRef = useRef(0);
  const originalContentRef = useRef<string | null>(null);
  const originalFocusContentRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const [isConvertingToNote, setIsConvertingToNote] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  const [item, setItem] = useState<ReadingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [bionicMode, setBionicMode] = useState(false);
  const [otherItems, setOtherItems] = useState<RecommendedItem[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightReferences, setHighlightReferences] = useState<
    Record<string, HighlightReferenceState>
  >({});
  const [showHighlightsPanel, setShowHighlightsPanel] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [fullWidth, setFullWidth] = useState(false);

  const readingMinutes = item?.content ? estimateReadingTime(item.content) : null;
  const renderedContent = useMemo(
    () => prepareReadingContent(item?.content || ""),
    [item?.content]
  );
  const headings = useMemo(() => {
    if (!item?.content) return [];
    return extractHeadings(item.content);
  }, [item?.content]);

  const recommendedItem = useMemo(() => {
    return getNextRecommendation(otherItems, itemId);
  }, [otherItems, itemId]);

  const loadHighlightReferences = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_highlight_reference_states", {
      p_reading_item_id: itemId,
    });
    if (error || !data) return;
    setHighlightReferences(
      (data as HighlightReferenceState[]).reduce<Record<string, HighlightReferenceState>>(
        (result, row) => {
          result[row.highlight_id] = row;
          return result;
        },
        {}
      )
    );
  }, [itemId, supabase]);

  useEffect(() => {
    async function loadItem() {
      const { data, error } = await supabase
        .from("reading_items")
        .select("*, tags:tags!item_tags(id, name)")
        .eq("id", itemId)
        .single();

      if (!error && data) {
        setItem(data as ReadingItem);
        setFullWidth(data.full_width ?? false);
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
        await loadHighlightReferences();
      }
    }
    if (itemId) {
      loadHighlights();
    }
  }, [itemId, loadHighlightReferences, supabase]);

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

  const calculateNormalProgress = useCallback((): number => {
    const container = contentRef.current;
    if (!container) return 0;

    const containerRect = container.getBoundingClientRect();
    const containerTop = containerRect.top + window.scrollY;
    const containerHeight = container.offsetHeight;
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;

    const bottomBarHeight = 80;
    const effectiveViewportHeight = viewportHeight - bottomBarHeight;
    const maxScroll = containerHeight - effectiveViewportHeight;

    if (maxScroll <= 0) return 100;

    const scrolled = scrollY - containerTop;
    let progress = (scrolled / maxScroll) * 100;
    progress = Math.min(Math.max(progress, 0), 100);

    const distanceToBottom = containerHeight - (scrolled + effectiveViewportHeight);
    if (distanceToBottom <= 60) {
      progress = 100;
    }

    return progress;
  }, []);

  const calculateFocusProgress = useCallback((): number => {
    const container = focusScrollContainerRef.current;
    const content = focusContentRef.current;
    if (!container || !content) return 0;

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    const contentHeight = content.offsetHeight + 32 * 16;
    const maxScroll = contentHeight - viewportHeight;

    if (maxScroll <= 0) return 100;

    let progress = (scrollTop / maxScroll) * 100;
    progress = Math.min(Math.max(progress, 0), 100);

    if (scrollTop + viewportHeight >= container.scrollHeight - 60) {
      progress = 100;
    }

    return progress;
  }, []);

  const updateProgressToDB = useCallback((progressPercent: number) => {
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
    }

    progressTimerRef.current = setTimeout(() => {
      progressTimerRef.current = null;

      const progress = progressPercent / 100;

      if (progress <= progressRef.current) return;
      progressRef.current = progress;

      const reachedBottom = progressPercent >= 95;
      const startedReading = progressPercent > 5;
      let newStatus: ReadingStatus = item?.reading_status || "unread";

      if (reachedBottom) {
        newStatus = "read";
      } else if (startedReading && newStatus === "unread") {
        newStatus = "reading";
      }

      setItem((prev) =>
        prev ? { ...prev, reading_progress: progress, reading_status: newStatus } : null
      );

      supabase
        .from("reading_items")
        .update({ reading_progress: Math.round(progressPercent) / 100, reading_status: newStatus })
        .eq("id", itemId);
    }, 300);
  }, [itemId, supabase, item?.reading_status]);

  const handleNormalScroll = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const progress = calculateNormalProgress();
      setScrollProgress(progress);
      updateProgressToDB(progress);
    });
  }, [calculateNormalProgress, updateProgressToDB]);

  const handleFocusScroll = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const progress = calculateFocusProgress();
      setScrollProgress(progress);
      updateProgressToDB(progress);
    });
  }, [calculateFocusProgress, updateProgressToDB]);

  useEffect(() => {
    if (focusMode) {
      const focusContainer = focusScrollContainerRef.current;
      if (focusContainer) {
        focusContainer.addEventListener("scroll", handleFocusScroll, { passive: true });
        handleFocusScroll();
      }
      return () => {
        if (focusContainer) {
          focusContainer.removeEventListener("scroll", handleFocusScroll);
        }
      };
    } else {
      window.addEventListener("scroll", handleNormalScroll, { passive: true });
      handleNormalScroll();
      return () => window.removeEventListener("scroll", handleNormalScroll);
    }
  }, [focusMode, handleNormalScroll, handleFocusScroll]);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
      }
    };
  }, []);

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

  // 全宽 / 默认宽度切换：乐观更新，失败回滚（与笔记页 full_width 语义一致，按文章持久化）
  const toggleFullWidth = useCallback(async () => {
    const next = !fullWidth;
    setFullWidth(next);
    setItem((prev) => (prev ? { ...prev, full_width: next } : null));
    const { error } = await supabase
      .from("reading_items")
      .update({ full_width: next })
      .eq("id", itemId);
    if (error) {
      setFullWidth(!next);
      setItem((prev) => (prev ? { ...prev, full_width: !next } : null));
      toast({ title: "宽度设置保存失败", variant: "destructive" });
    }
  }, [fullWidth, itemId, supabase]);

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
          })).filter(n => n.content),
          ...(highlights.length > 0
            ? [
                {
                  type: "heading" as const,
                  attrs: { level: 2 },
                  content: [{ type: "text" as const, text: "阅读高亮" }],
                },
                ...[...highlights].reverse().flatMap((highlight) => [
                  {
                    type: "blockquote" as const,
                    content: [
                      {
                        type: "paragraph" as const,
                        content: [{ type: "text" as const, text: highlight.content }],
                      },
                    ],
                  },
                  ...(highlight.note
                    ? [
                        {
                          type: "paragraph" as const,
                          content: [
                            {
                              type: "text" as const,
                              text: `批注：${highlight.note}`,
                            },
                          ],
                        },
                      ]
                    : []),
                ]),
              ]
            : []),
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
  }, [highlights, item, itemId, supabase, router, isConvertingToNote]);

  const handleConvertHighlight = useCallback(async (
    highlightId: string,
    targetType: "note" | "task",
    openAfterCreate = false
  ) => {
    const { data, error } = await supabase.rpc("convert_highlight_reference", {
      p_highlight_id: highlightId,
      p_target_type: targetType,
    });
    if (error || !data?.target_id) {
      toast({
        title: `转为${targetType === "note" ? "笔记" : "任务"}失败`,
        description: error?.message,
        variant: "destructive",
      });
      return;
    }
    const targetId = String(data.target_id);
    setHighlights((current) =>
      current.map((highlight) =>
        highlight.id === highlightId
          ? {
              ...highlight,
              [targetType === "note" ? "note_id" : "task_id"]: targetId,
            }
          : highlight
      )
    );
    await loadHighlightReferences();
    toast({
      title: data.status === "existing"
        ? `${targetType === "note" ? "笔记" : "任务"}已存在`
        : `${targetType === "note" ? "笔记" : "任务"}创建成功`,
    });
    if (openAfterCreate) router.push(`/${targetType === "note" ? "notes" : "tasks"}/${targetId}`);
  }, [loadHighlightReferences, router, supabase]);

  const handleCreateHighlight = useCallback(async (
    content: string,
    color: HighlightColor,
    targetType?: "note" | "task"
  ) => {
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
        if (targetType) {
          await handleConvertHighlight(data.id, targetType, true);
        } else {
          toast({ title: "高亮已添加" });
        }
      }
    } catch {
      toast({ title: "高亮保存失败", variant: "destructive" });
    }
  }, [handleConvertHighlight, itemId, supabase]);

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
      setHighlightReferences((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
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
    <div
      className={cn(
        "relative transition-[padding] duration-300",
        // 高亮面板是 xl 下 fixed 的右侧栏（w-80），打开时整体右移内容列避免遮挡
        showHighlightsPanel && "xl:pr-80"
      )}
    >
      <Toc headings={headings} containerRef={contentRef} />
      <HighlightsPanel
        isOpen={showHighlightsPanel}
        onClose={() => setShowHighlightsPanel(false)}
        highlights={highlights}
        references={highlightReferences}
        onDelete={handleDeleteHighlight}
        onConvert={(id, targetType) => handleConvertHighlight(id, targetType)}
        onOpenReference={(targetType, id) =>
          router.push(`/${targetType === "note" ? "notes" : "tasks"}/${id}`)
        }
      />

      {/* 顶栏：全宽吸顶（负 margin 抵消主布局 p-4/md:p-6）。
          左侧返回+面包屑，右侧操作；进度条贴顶栏下沿 */}
      <div className="sticky top-14 md:top-0 z-30 -mx-4 md:-mx-6 mb-8 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between gap-2 px-2 py-2 md:px-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link href="/library">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
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
          <div className="flex items-center gap-1 sm:gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className={`gap-1 sm:gap-1.5 ${bionicMode ? "text-primary bg-primary/10" : ""}`}
              onClick={() => setBionicMode(!bionicMode)}
              title="速读"
            >
              <Zap className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">速读</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`gap-1 sm:gap-1.5 ${focusMode ? "text-primary bg-primary/10" : ""}`}
              onClick={() => setFocusMode(!focusMode)}
              title="专注"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">专注</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`gap-1 sm:gap-1.5 ${fullWidth ? "text-primary bg-primary/10" : ""}`}
              onClick={toggleFullWidth}
              title={fullWidth ? "默认宽度" : "全宽"}
            >
              <StretchHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">全宽</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 sm:gap-1.5"
              onClick={handleConvertToNote}
              disabled={isConvertingToNote}
              title="笔记"
            >
              {isConvertingToNote ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">笔记</span>
            </Button>
            <FavoriteButton targetType="reading" targetId={itemId} />
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 sm:gap-1.5"
              onClick={() => setShareDialogOpen(true)}
              title="分享"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">分享</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`gap-1 sm:gap-1.5 ${showHighlightsPanel ? "text-primary bg-primary/10" : ""}`}
              onClick={() => setShowHighlightsPanel(!showHighlightsPanel)}
              title="高亮"
            >
              <Highlighter className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">高亮</span>
              {highlights.length > 0 && (
                <span className="ml-0.5 sm:ml-1 text-xs bg-primary/10 text-primary px-1 sm:px-1.5 rounded-full">
                  {highlights.length}
                </span>
              )}
            </Button>
            <StatusBadge status={item.reading_status} />
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="hidden sm:inline">
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                原文
              </Button>
            </a>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="sm:hidden">
              <Button variant="ghost" size="sm" title="原文">
                <ExternalLink className="h-4 w-4" />
              </Button>
            </a>
          </div>
        </div>
        {/* 进度条：贴顶栏下沿，全宽一条（不再重复渲染页面顶部 fixed 进度条） */}
        <div className="h-0.5 bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-100 ease-out"
            style={{ width: `${scrollProgress}%` }}
          />
        </div>
      </div>

      {/* 内容列：标题 / 元信息 / 正文 / 推荐共用同一宽度与文字轴。
          默认 max-w-3xl 居中；全宽 max-w-none + md:px-10（与笔记页一致） */}
      <div
        className={cn(
          "mx-auto w-full transition-[max-width,padding] duration-200",
          fullWidth ? "max-w-none md:px-10" : "max-w-3xl"
        )}
      >
        {/* 文章标题 */}
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

        {/* 文章内容 */}
        <HighlightMenu onCreateHighlight={handleCreateHighlight}>
          <div
            ref={contentRef}
            className="reader-content"
            dangerouslySetInnerHTML={{ __html: renderedContent || "<p>无法提取正文内容</p>" }}
          />
        </HighlightMenu>

        {/* 下一篇推荐 */}
        <div className="pb-24 mt-12">
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
      </div>

      {/* 底部操作 */}
      <div className="organize-sidebar-fixed-left fixed bottom-0 left-0 right-0 border-t bg-background/95 p-3 backdrop-blur transition-[left] duration-200">
        <div
          className={cn(
            "mx-auto w-full flex items-center justify-between",
            fullWidth ? "max-w-none md:px-10" : "max-w-3xl"
          )}
        >
          <span className="text-xs text-muted-foreground">
            阅读进度: {Math.round(scrollProgress)}%
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

      {/* 专注模式全屏覆盖层（与正文共用 .reader-content 排版与宽度设置） */}
      {focusMode && (
        <div ref={focusScrollContainerRef} className="fixed inset-0 z-50 bg-background overflow-y-auto animate-in fade-in duration-200">
          <Button
            variant="ghost"
            size="icon"
            className="fixed top-4 right-4 z-10 h-10 w-10 rounded-full bg-background/80 backdrop-blur hover:bg-accent"
            onClick={() => setFocusMode(false)}
          >
            <X className="h-5 w-5" />
          </Button>
          <div
            className={cn(
              "mx-auto w-full px-4 sm:px-6 py-12 sm:py-16",
              fullWidth ? "max-w-none md:px-10" : "max-w-3xl"
            )}
          >
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
                className="reader-content"
                dangerouslySetInnerHTML={{ __html: renderedContent || "<p>无法提取正文内容</p>" }}
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

      <ShareDialog
        resourceType="reading_item"
        resourceId={itemId}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
      />
    </div>
  );
}
