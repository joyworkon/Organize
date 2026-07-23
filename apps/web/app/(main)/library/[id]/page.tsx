"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/reading/status-badge";
import type { ReadingItem, ReadingStatus } from "@organize/shared";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";

export default function ReadingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = params.id as string;
  const supabase = createClient();
  const contentRef = useRef<HTMLDivElement>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressRef = useRef(0);

  const [item, setItem] = useState<ReadingItem | null>(null);
  const [loading, setLoading] = useState(true);

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
    <div className="max-w-3xl mx-auto">
      {/* 顶栏 */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b py-3 mb-6 -mx-4 px-4">
        <div className="flex items-center justify-between">
          <Link href="/library">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              返回
            </Button>
          </Link>
          <div className="flex items-center gap-3">
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
      <header className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold leading-tight">
          {item.title}
        </h1>
        <div className="flex items-center gap-3 mt-3 text-sm text-muted-foreground">
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
        </div>
      </header>

      {/* 文章内容 */}
      <div
        ref={contentRef}
        className="prose prose-sm sm:prose max-w-none pb-20
          prose-headings:font-bold prose-a:text-primary
          prose-img:rounded-lg prose-img:shadow-sm"
        dangerouslySetInnerHTML={{ __html: item.content || "<p>无法提取正文内容</p>" }}
      />

      {/* 底部操作 */}
      <div className="fixed bottom-0 left-0 right-0 md:left-60 border-t bg-background/95 backdrop-blur p-3">
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
  );
}
