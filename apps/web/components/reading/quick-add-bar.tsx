"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BatchImportPanel } from "@/components/inbox/batch-import-panel";
import { extractFirstUrl } from "@/lib/inbox/batch-import";
import { toast } from "@/hooks/use-toast";
import { ClipboardPaste, Layers, Link2, Loader2 } from "lucide-react";

interface QuickAddBarProps {
  /** 入库成功后回调（列表刷新） */
  onAdded: () => void;
}

/**
 * 稍后读·快速添加条：一步直接入库。
 * 抓取成功 → 用正文入库；抓取失败 → 以 URL 为标题兜底入库（与命令面板快速添加同一安全网），
 * 不让用户为坏内容多走一步删除流程之外的回头路。
 */
export function QuickAddBar({ onAdded }: QuickAddBarProps) {
  const supabase = useMemo(() => createClient(), []);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  const handleAdd = async () => {
    const normalizedUrl = extractFirstUrl(url);
    if (!normalizedUrl) {
      toast({ title: "没有找到有效的链接", variant: "destructive" });
      return;
    }
    setAdding(true);
    let scrapeFailed = false;
    let scraped: {
      url: string;
      title: string;
      content?: string;
      excerpt?: string;
      cover_image?: string;
    } | null = null;
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const data = await res.json();
      if (!res.ok) scrapeFailed = true;
      else scraped = data;
    } catch {
      scrapeFailed = true;
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "请先登录", variant: "destructive" });
        return;
      }
      const { error } = await supabase.from("reading_items").insert({
        user_id: user.id,
        url: scraped?.url ?? normalizedUrl,
        title: scraped?.title ?? normalizedUrl,
        content: scraped?.content ?? null,
        excerpt: scraped?.excerpt ?? null,
        cover_image: scraped?.cover_image ?? null,
        reading_status: "unread",
        reading_progress: 0,
      });
      if (error) throw error;
    } catch (err) {
      toast({
        title: "添加失败，请重试",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      return;
    } finally {
      setAdding(false);
    }

    toast({ title: scrapeFailed ? "已保存（正文抓取失败，仅存链接）" : "已保存到稍后读" });
    setUrl("");
    onAdded();
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const extracted = extractFirstUrl(text);
      if (extracted) setUrl(extracted);
      else toast({ title: "剪贴板中没有找到有效的链接" });
    } catch {
      toast({ title: "无法访问剪贴板，请手动粘贴链接" });
    }
  };

  return (
    <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="粘贴链接，回车直接保存…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !adding) void handleAdd();
            }}
            className="pl-9"
            aria-label="快速添加链接"
          />
        </div>
        <Button
          variant="outline"
          onClick={handlePasteFromClipboard}
          title="从剪贴板粘贴链接"
          disabled={adding}
          aria-label="从剪贴板粘贴"
        >
          <ClipboardPaste className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          onClick={() => setBatchOpen(true)}
          title="批量导入"
          disabled={adding}
          className="gap-1.5"
        >
          <Layers className="h-4 w-4" />
          <span className="hidden sm:inline">批量导入</span>
        </Button>
        <Button onClick={() => void handleAdd()} disabled={adding || !url.trim()}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
        </Button>
      </div>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>批量导入</DialogTitle>
            <DialogDescription>一次粘贴多个链接，自动并发抓取并保存到稍后读。</DialogDescription>
          </DialogHeader>
          <BatchImportPanel
            onComplete={(success, failed) => {
              // 不自动关 Dialog：失败项列表和「重试失败项」按钮需要留在用户眼前
              if (success > 0) {
                toast({ title: `批量导入完成：成功 ${success} 条${failed > 0 ? `，失败 ${failed} 条` : ""}` });
                onAdded();
              } else if (failed > 0) {
                toast({ title: `批量导入失败 ${failed} 条`, variant: "destructive" });
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
