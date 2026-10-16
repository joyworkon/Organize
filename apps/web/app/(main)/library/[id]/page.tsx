"use client";

import { isDigestUrl, isInternalUrn, readingSourceLabel } from "@/lib/reading/source";
import { bionicProcessText } from "@/lib/reading/bionic";
import { DigestEditor } from "@/components/reading/digest-editor";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { appEvents } from "@/lib/plugin/events";
import { setCurrentReadingItem } from "@/lib/plugin/current-context";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { buildReadingNoteContent, readingNoteTitle } from "@/lib/reading/reading-note";
import { StatusBadge } from "@/components/reading/status-badge";
import { TocMinimap } from "@/components/toc/toc-minimap";
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
import type { ReadingItem, ReadingStatus, Highlight, HighlightColor, Tag } from "@organize/shared";
import { ArrowLeft, ExternalLink, Loader2, Clock, Zap, BookOpen, Inbox, Highlighter, FileText, PenLine, Check, Maximize2, Minimize2, X, Share2, StretchHorizontal, Tag as TagIcon } from "@/components/icons";
import { estimateReadingTime, formatReadingTime } from "@/lib/reading-time";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { htmlToTextParagraphs } from "@/lib/tiptap-utils";
import type { JSONContent } from "@tiptap/core";
import Link from "next/link";
import { CollectionBackLink } from "@/components/layout/mobile-navigation";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "@/components/icons";
import { FavoriteButton } from "@/components/favorite-button";
import { TagSelector } from "@/components/tags/tag-selector";
import { TagBadge } from "@/components/tags/tag-badge";
import { useAllTags, useResourceTags } from "@/components/tags/use-tags";
import { ResourceShareDialog } from "@/components/share/resource-share-dialog";
import { isCollabRole, type CollabRole } from "@/lib/collab/roles";
import { prepareReadingContent } from "@/lib/reading-images";
import type { HighlightReferenceState } from "@/lib/reading/highlight-references";
import { findAndWrapHighlightText, focusHighlight } from "@/lib/reading/highlight-locate";
import { nextReadingProgress, readyHighlightDeepLink } from "@/lib/reading/progress";

interface RecommendedItem {
  id: string;
  title: string | null;
  url: string;
  site_name?: string | null;
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

  // 页面属性：标签（item_tags，经 /api/reading-items/[id]/tags 增删，hook 内乐观更新）
  const { tags: allTagOptions, refresh: refreshAllTags } = useAllTags();
  const { tags: itemTags, addTag: addItemTag, removeTag: removeItemTag } = useResourceTags("reading_item", itemId);
  // 展示用补全颜色：GET /api/reading-items/[id]/tags 只回 id/name，颜色从全量标签对齐
  const displayItemTags = useMemo(
    () =>
      itemTags.map((t) => ({
        ...t,
        color: t.color ?? allTagOptions.find((o) => o.id === t.id)?.color,
      })),
    [itemTags, allTagOptions]
  );
  const contentRef = useRef<HTMLDivElement | null>(null);
  // 整理稿（阶段 4）：独立可编辑文章的编辑态开关
  const [editingDigest, setEditingDigest] = useState(false);
  const focusContentRef = useRef<HTMLDivElement>(null);
  const focusScrollContainerRef = useRef<HTMLDivElement>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressRef = useRef(0);
  const originalContentRef = useRef<string | null>(null);
  const originalFocusContentRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  // E02-2 深链 ?hl={highlightId}：loadItem（跳过进度恢复）与定位 effect 共用
  const deepLinkHighlightIdRef = useRef<string | null>(null);
  const [isConvertingToNote, setIsConvertingToNote] = useState(false);
  // 「读 → 记 → 复盘」闭环：本文关联的读书笔记（有则直接打开，无则一键创建）
  const [readingNoteId, setReadingNoteId] = useState<string | null>(null);
  const [isCreatingReadingNote, setIsCreatingReadingNote] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  const [item, setItem] = useState<ReadingItem | null>(null);
  const isDigest = Boolean(item?.url && isDigestUrl(item.url));
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
  // 协作角色（069 移交属主）：属主无需 RPC（行的 user_id 即事实）；
  // 协作者调 063 的唯一判定入口 resource_role，拿不到有效结论时按 viewer 处理
  const [readingRole, setReadingRole] = useState<CollabRole | null>(null);
  const [fullWidth, setFullWidth] = useState(false);

  const readingMinutes = item?.content ? estimateReadingTime(item.content) : null;
  const renderedContent = useMemo(
    () => prepareReadingContent(item?.content || ""),
    [item?.content]
  );
  // React 19 按 dangerouslySetInnerHTML 对象引用比较：每次渲染新建对象会在任意重渲染
  // （如滚动进度 setItem）时重写正文 innerHTML，冲掉已注入的高亮 <mark>。引用必须稳定。
  const contentHtml = useMemo(() => ({ __html: renderedContent || "" }), [renderedContent]);
  const focusContentHtml = useMemo(
    () => ({ __html: renderedContent || "<p>无法提取正文内容</p>" }),
    [renderedContent]
  );
  // 目录刻度直接读正文 DOM：正文节点挂载/替换后交给它
  const [tocRoot, setTocRoot] = useState<HTMLDivElement | null>(null);

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

  // 同步当前条目到插件上下文（ctx.getCurrentItem），卸载时清空
  useEffect(() => {
    setCurrentReadingItem(item);
    return () => setCurrentReadingItem(null);
  }, [item]);

  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    // 切换到另一篇（如「下一篇推荐」）时先清空旧条目，避免旧正文/进度串到新条目
    setLoading(true);
    setLoadError(false);
    setItem(null);
    setHighlights([]);
    setHighlightReferences({});
    progressRef.current = 0;
    async function loadItem() {
      const { data, error } = await supabase
        .from("reading_items")
        .select("*, tags:tags!item_tags(id, name)")
        .eq("id", itemId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setLoadError(true);
        setLoading(false);
        return;
      }

      if (data) {
        setItem(data as ReadingItem);
        setFullWidth(data.full_width ?? false);
        progressRef.current = data.reading_progress || 0;
        if (data.reading_status === "unread") {
          const { error: statusError } = await supabase
            .from("reading_items")
            .update({ reading_status: "reading" })
            .eq("id", itemId);
          if (active && !statusError) setItem((prev) => prev ? { ...prev, reading_status: "reading" } : null);
        }

        if (data.reading_progress && data.reading_progress > 0.01
          && !new URLSearchParams(window.location.search).get("hl")) {
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
      if (active) setLoading(false);
    }
    void loadItem();
    return () => {
      active = false;
    };
  }, [itemId, supabase, loadAttempt]);

  // 角色判定在条目加载后进行（协作者经 064 RLS 也能读到行，属主判定看 user_id）
  useEffect(() => {
    if (!item) return;
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      if (item.user_id === user.id) {
        if (active) setReadingRole("owner");
        return;
      }
      const { data: role } = await supabase.rpc("resource_role", {
        p_resource_type: "reading_item",
        p_resource_id: itemId,
      });
      if (active) setReadingRole(isCollabRole(role) ? role : "viewer");
    })();
    return () => {
      active = false;
    };
  }, [item, itemId, supabase]);

  useEffect(() => {
    let active = true;
    async function loadHighlights() {
      const { data, error } = await supabase
        .from("highlights")
        .select("*")
        .eq("reading_item_id", itemId)
        .order("created_at", { ascending: false });
      if (active && !error && data) {
        setHighlights(data as Highlight[]);
        await loadHighlightReferences();
      }
    }
    if (itemId) {
      void loadHighlights();
    }
    return () => {
      active = false;
    };
  }, [itemId, loadHighlightReferences, supabase]);

  // E02-2：任务侧「关联阅读」深链 ?hl={highlightId}——内容渲染后按高亮正文定位并
  // 滚动闪烁；高亮已删或正文匹配不到时静默降级为条目顶部（不滚动）。一次性消费。
  useEffect(() => {
    if (!item) return;
    if (deepLinkHighlightIdRef.current === null) {
      deepLinkHighlightIdRef.current = new URLSearchParams(window.location.search).get("hl");
    }
    const container = contentRef.current;
    // 正文未挂载（仍在 loading）或高亮未到时不消费，等下一次依赖变化再试
    const highlightId = readyHighlightDeepLink(deepLinkHighlightIdRef.current, {
      loading,
      hasContainer: Boolean(container),
      highlightCount: highlights.length,
    });
    if (!highlightId || !container) return;
    deepLinkHighlightIdRef.current = "";
    const highlight = highlights.find((h) => h.id === highlightId);
    if (!highlight) return;
    const target = findAndWrapHighlightText(container, highlight.content, highlight.color);
    if (target) {
      focusHighlight(target.el);
    }
  }, [item, highlights, loading]);

  useEffect(() => {
    async function loadOtherItems() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("reading_items")
        .select("id, title, url, content, reading_status, created_at, reading_progress, is_pinned, tags:tags!item_tags(id, name)")
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

      const previousStatus = item?.reading_status || "unread";
      const next = nextReadingProgress(progressPercent, progressRef.current, previousStatus);
      if (!next) return;
      const savedBefore = progressRef.current;
      progressRef.current = next.progress;

      setItem((prev) =>
        prev ? { ...prev, reading_progress: next.progress, reading_status: next.status } : null
      );

      // 事件发射是副作用，放在 setState 更新器外面（项目约定）
      if (previousStatus !== next.status) {
        appEvents.emit("reading:status-changed", { itemId, from: previousStatus, to: next.status });
      }

      // supabase-js 查询是惰性的：必须 await/then 才会真正发出请求（此前漏掉导致进度从未落库）
      void supabase
        .from("reading_items")
        .update({ reading_progress: next.progress, reading_status: next.status })
        .eq("id", itemId)
        .then(({ error }) => {
          // 失败时回退已保存进度，下一次滚动会重试；不打断阅读
          if (error && progressRef.current === next.progress) progressRef.current = savedBefore;
        });
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

  const applyBionicToElement = useCallback((el: HTMLElement) => {
    if (el.querySelector("[data-bionic-node='true']")) return;
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tagName = parent.tagName.toLowerCase();
          if (
            tagName === "script" ||
            tagName === "style" ||
            tagName === "b" ||
            parent.closest("[data-bionic-node='true']")
          ) {
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
      tempSpan.setAttribute("data-bionic-node", "true");
      tempSpan.innerHTML = processedHtml;

      textNode.parentNode?.replaceChild(tempSpan, textNode);
    });
  }, []);

  const unwrapBionicElement = useCallback((el: HTMLElement): boolean => {
    const nodes = el.querySelectorAll("[data-bionic-node='true']");
    if (nodes.length === 0) return false;
    nodes.forEach((node) => {
      node.replaceWith(document.createTextNode(node.textContent || ""));
    });
    el.normalize();
    return true;
  }, []);

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
    if (contentEl) {
      if (!unwrapBionicElement(contentEl) && originalContentRef.current !== null) {
        contentEl.innerHTML = originalContentRef.current;
      }
      originalContentRef.current = null;
    }

    const focusEl = focusContentRef.current;
    if (focusEl) {
      if (!unwrapBionicElement(focusEl) && originalFocusContentRef.current !== null) {
        focusEl.innerHTML = originalFocusContentRef.current;
      }
      originalFocusContentRef.current = null;
    }
  }, [unwrapBionicElement]);

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
    const { error } = await supabase
      .from("reading_items")
      .update({ reading_status: status })
      .eq("id", itemId);
    if (error) {
      toast({ title: "状态更新失败，请重试", variant: "destructive" });
      return;
    }
    const previous = item?.reading_status;
    setItem((prev) => prev ? { ...prev, reading_status: status } : null);
    if (previous && previous !== status) {
      appEvents.emit("reading:status-changed", { itemId, from: previous, to: status });
    }
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
                text: isInternalUrn(item.url) ? "查看导入物料" : item.url,
                marks: [{ type: "link", attrs: { href: isInternalUrn(item.url) ? `/library/${item.id}` : item.url, target: "_blank" } }]
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

  useEffect(() => {
    let active = true;
    void supabase
      .from("notes")
      .select("id")
      .eq("reading_item_id", itemId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setReadingNoteId(data?.id ?? null);
      });
    return () => {
      active = false;
    };
  }, [itemId, supabase]);

  const handleReadingNote = useCallback(async () => {
    if (!item || isCreatingReadingNote) return;
    if (readingNoteId) {
      router.push(`/notes/${readingNoteId}`);
      return;
    }
    setIsCreatingReadingNote(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        toast({ title: "请先登录", variant: "destructive" });
        return;
      }
      const content = buildReadingNoteContent(
        { id: item.id, title: item.title, url: item.url, isInternal: isInternalUrn(item.url) },
        [...highlights].reverse().map((h) => ({ content: h.content, note: h.note }))
      );
      const { data, error } = await supabase
        .from("notes")
        .insert({ title: readingNoteTitle(item), content, user_id: session.user.id, reading_item_id: itemId })
        .select("id")
        .single();
      if (error || !data) {
        toast({ title: "创建读书笔记失败，请重试", variant: "destructive" });
        return;
      }
      setReadingNoteId(data.id);
      router.push(`/notes/${data.id}`);
    } finally {
      setIsCreatingReadingNote(false);
    }
  }, [highlights, isCreatingReadingNote, item, itemId, readingNoteId, router, supabase]);

  // 抓取失败（只存了链接）的条目：在阅读页直接重新抓取，而不是只显示「无法提取正文内容」
  const handleRefetch = useCallback(async () => {
    if (!item || isRefetching) return;
    setIsRefetching(true);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, force: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.content) {
        toast({
          title: "仍然无法抓取正文",
          description: data?.error || "该网站可能需要登录或禁止抓取，可以点「原文」在浏览器中阅读",
          variant: "destructive",
        });
        return;
      }
      const patch: Record<string, unknown> = { content: data.content, excerpt: data.excerpt ?? null };
      if (data.cover_image) patch.cover_image = data.cover_image;
      // 标题仍是 URL（抓取失败时的占位）才用抓到的标题覆盖，用户改过的标题不动
      if (data.title && (!item.title || item.title === item.url)) patch.title = data.title;
      const { error } = await supabase.from("reading_items").update(patch).eq("id", itemId);
      if (error) {
        toast({ title: "保存抓取结果失败，请重试", variant: "destructive" });
        return;
      }
      setItem((prev) => (prev ? ({ ...prev, ...patch } as ReadingItem) : prev));
      toast({ title: "已重新抓取正文" });
    } finally {
      setIsRefetching(false);
    }
  }, [isRefetching, item, itemId, supabase]);

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

  if (loadError) {
    return (
      <EmptyState
        icon={FileText}
        title="加载失败"
        description="网络或服务异常，内容暂时无法打开"
        action={<Button variant="outline" size="sm" onClick={() => setLoadAttempt((n) => n + 1)}>重试</Button>}
      />
    );
  }

  if (!item) {
    return (
      <EmptyState
        icon={FileText}
        title="内容不存在"
        description="内容可能已被删除或链接无效"
        action={
          <Link href="/library">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回资料库
            </Button>
          </Link>
        }
      />
    );
  }

  // 标签增删：TagSelector 回传全量列表，与当前 diff 出新增/移除；新建标签走 name 创建
  const handleItemTagsChange = async (next: Pick<Tag, "id" | "name" | "color">[]) => {
    const currentIds = new Set(itemTags.map((t) => t.id));
    const nextIds = new Set(next.map((t) => t.id));
    let changed = false;
    for (const t of next) {
      if (currentIds.has(t.id)) continue;
      changed = true;
      if (t.id.startsWith("new:")) {
        const createdId = await addItemTag({ name: t.name });
        if (createdId) void refreshAllTags();
      } else {
        await addItemTag({ id: t.id, name: t.name });
      }
    }
    for (const t of itemTags) {
      if (nextIds.has(t.id)) continue;
      changed = true;
      await removeItemTag(t.id);
    }
    if (changed) window.dispatchEvent(new CustomEvent("organize:tags-changed"));
  };

  const handleRemoveItemTag = async (tagId: string) => {
    await removeItemTag(tagId);
    window.dispatchEvent(new CustomEvent("organize:tags-changed"));
  };

  return (
    <div
      className={cn(
        "organize-lane-full relative transition-[padding] duration-300",
        // 高亮面板是 xl 下 fixed 的右侧栏（w-80），打开时整体右移内容列避免遮挡
        showHighlightsPanel && "xl:pr-80"
      )}
    >
      <TocMinimap root={tocRoot} mobileSheet />
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
      <div className="reading-topbar organize-chrome-bar sticky top-14 md:top-0 z-30 -mx-4 -mt-4 mb-8 backdrop-blur md:-mx-6 md:-mt-6">
        <div className="flex h-14 items-center justify-between gap-2 px-2 md:h-10 md:px-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <CollectionBackLink section="library" aria-label="返回阅读列表" className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-accent md:h-8 md:w-8">
              <ArrowLeft className="h-5 w-5" />
            </CollectionBackLink>
            <span className="truncate text-sm font-medium md:hidden">{item.title || "稍后读"}</span>
            <Breadcrumb className="hidden min-w-0 md:block">
              <BreadcrumbList>
                <BreadcrumbItem className="hidden sm:inline-flex">
                  <BreadcrumbLink href="/">首页</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:block" />
                <BreadcrumbItem>
                  <BreadcrumbLink href="/library">稍后读</BreadcrumbLink>
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
            <StatusBadge status={item.reading_status} className="hidden shrink-0 lg:inline-flex" />
          </div>
          {/* 桌面动作簇（第八步收密度）：常用四件套 + 唯一 outline 主动作「原文」，
              速读 / 全宽 / 转为笔记 / 分享 收进「更多」菜单；开启态用浮起胶囊 */}
          <div className="reading-topbar-actions hidden items-center gap-1 sm:gap-1.5 md:flex">
            <Button
              variant="ghost"
              size="sm"
              className={`gap-1 sm:gap-1.5 ${showHighlightsPanel ? "bg-card text-primary shadow-xs hover:bg-card dark:bg-accent dark:hover:bg-accent" : ""}`}
              onClick={() => setShowHighlightsPanel(!showHighlightsPanel)}
              title="高亮"
            >
              <Highlighter className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">高亮</span>
              {highlights.length > 0 && (
                <span className="ml-0.5 rounded-full bg-primary/10 px-1 text-xs text-primary sm:ml-1 sm:px-1.5">
                  {highlights.length}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`gap-1 sm:gap-1.5 ${focusMode ? "bg-card text-primary shadow-xs hover:bg-card dark:bg-accent dark:hover:bg-accent" : ""}`}
              onClick={() => setFocusMode(!focusMode)}
              title="专注"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">专注</span>
            </Button>
            <FavoriteButton targetType="reading" targetId={itemId} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 sm:gap-1.5" aria-label="更多阅读工具" title="更多">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="hidden sm:inline">更多</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setBionicMode(!bionicMode)}>
                  <Zap className="mr-2 h-4 w-4" />
                  {bionicMode ? "关闭速读" : "速读"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleFullWidth}>
                  <StretchHorizontal className="mr-2 h-4 w-4" />
                  {fullWidth ? "恢复默认宽度" : "全宽阅读"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={isConvertingToNote} onSelect={() => void handleConvertToNote()}>
                  {isConvertingToNote ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  全文转为笔记
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShareDialogOpen(true)}>
                  <Share2 className="mr-2 h-4 w-4" />
                  分享文章
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!isInternalUrn(item.url) && <a href={item.url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                原文
              </Button>
            </a>}
          </div>
          <div className="mobile-reading-actions hidden">
            <FavoriteButton targetType="reading" targetId={itemId} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="阅读工具"><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="mobile-reading-menu w-60">
                <DropdownMenuItem onSelect={() => setShowHighlightsPanel(true)}><Highlighter className="mr-2 h-4 w-4" />高亮与摘记{highlights.length ? ` · ${highlights.length}` : ""}</DropdownMenuItem>
                <DropdownMenuItem disabled={isConvertingToNote} onSelect={() => void handleConvertToNote()}><FileText className="mr-2 h-4 w-4" />全文转为笔记</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShareDialogOpen(true)}><Share2 className="mr-2 h-4 w-4" />分享文章</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setBionicMode(!bionicMode)}><Zap className="mr-2 h-4 w-4" />{bionicMode ? "关闭速读" : "开启速读"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setFocusMode(!focusMode)}><Maximize2 className="mr-2 h-4 w-4" />{focusMode ? "退出专注阅读" : "专注阅读"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleFullWidth}><StretchHorizontal className="mr-2 h-4 w-4" />{fullWidth ? "恢复默认宽度" : "全宽阅读"}</DropdownMenuItem>
                <DropdownMenuSeparator />
                {!isInternalUrn(item.url) && <DropdownMenuItem asChild><a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />打开原文</a></DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
          <h1 className="text-[32px] font-semibold leading-[42px]">
            {item.title}
          </h1>
          <div className="flex items-center gap-3 mt-3 text-sm text-muted-foreground flex-wrap">
            <a
              href={isInternalUrn(item.url) ? undefined : item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              {readingSourceLabel(item.url)}
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

          {/* 标签：与笔记页同一套交互，徽标可点 X 移除，「标签」打开选择器（支持输入新名直接创建） */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            {displayItemTags.map((t) => (
              <TagBadge key={t.id} tag={t} size="sm" onRemove={() => void handleRemoveItemTag(t.id)} />
            ))}
            <TagSelector
              selected={itemTags}
              options={allTagOptions}
              onChange={(next) => void handleItemTagsChange(next)}
            >
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <TagIcon className="h-3 w-3" />
                标签
              </button>
            </TagSelector>
          </div>
        </header>

        {/* 文章内容（整理稿可编辑：编辑态下暂不渲染高亮菜单） */}
        {isDigest && editingDigest ? (
          <DigestEditor
            itemId={item.id}
            initialTitle={item.title || ""}
            initialHtml={item.content || ""}
            onSaved={(title, contentHtml) => {
              setItem((prev) =>
                prev ? { ...prev, title, content: contentHtml } : prev,
              );
              setEditingDigest(false);
            }}
            onCancel={() => setEditingDigest(false)}
          />
        ) : (
          <>
            {isDigest && (
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setEditingDigest(true)}
                >
                  编辑整理稿（独立文章，不改动来源）
                </button>
              </div>
            )}
            {!item.content && !isInternalUrn(item.url) && (
              <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm">
                <span className="text-muted-foreground">没能抓取到这篇文章的正文（网站可能需要登录或限制抓取）。</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={isRefetching} onClick={() => void handleRefetch()}>
                    {isRefetching && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    重新抓取
                  </Button>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="ghost"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />打开原文</Button>
                  </a>
                </span>
              </div>
            )}
            <HighlightMenu onCreateHighlight={handleCreateHighlight}>
              <div
                ref={(el) => {
                  contentRef.current = el;
                  setTocRoot(el);
                }}
                className="reader-content"
                dangerouslySetInnerHTML={contentHtml}
              />
            </HighlightMenu>
          </>
        )}

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
                          return readingSourceLabel(recommendedItem.url);
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
            <Link href="/library">
              <div className="border rounded-md p-4 hover:bg-accent transition-colors cursor-pointer text-center">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Inbox className="h-4 w-4" />
                  <span>🎉 暂无更多文章，回稍后读看看</span>
                </div>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* 底部操作 */}
      {/* 高亮面板打开时（xl 为固定右栏）让出右侧，避免「标记已读 / 写读书笔记」被面板遮住 */}
      <div
        className={cn(
          "organize-sidebar-fixed-left fixed bottom-0 left-0 right-0 border-t bg-background/95 p-3 backdrop-blur transition-[left,right] duration-200",
          showHighlightsPanel && "xl:right-80"
        )}
      >
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
            {/* 阅读状态是单一开关：已读时只提供「撤销」，未读/在读时只提供「标记已读」 */}
            {item.reading_status === "read" ? (
              <Button variant="ghost" size="sm" onClick={() => updateStatus("unread")} title="标记为未读">
                <Check className="mr-1.5 h-3.5 w-3.5" />
                已读 · 撤销
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => updateStatus("read")}>
                标记已读
              </Button>
            )}
            <Button size="sm" disabled={isCreatingReadingNote} onClick={() => void handleReadingNote()}>
              {isCreatingReadingNote ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <PenLine className="mr-1.5 h-3.5 w-3.5" />
              )}
              {readingNoteId ? "打开读书笔记" : "写读书笔记"}
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
              <h1 className="text-[32px] font-semibold leading-[42px]">
                {item.title}
              </h1>
              <div className="flex items-center gap-3 mt-3 text-sm text-muted-foreground flex-wrap">
                <a
                  href={isInternalUrn(item.url) ? undefined : item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors"
                >
                  {readingSourceLabel(item.url)}
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
                dangerouslySetInnerHTML={focusContentHtml}
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

      <ResourceShareDialog
        resourceType="reading_item"
        resourceId={itemId}
        myRole={readingRole ?? "owner"}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
      />
    </div>
  );
}
