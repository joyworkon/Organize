"use client";

import { useState } from "react";
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
import { collectReadingItem, collectResultToast } from "@/lib/reading/collect";
import { toast } from "@/hooks/use-toast";
import { ClipboardPaste, Layers, Link2, Loader2 } from "lucide-react";

interface QuickAddBarProps {
  /** 入库成功后回调（列表刷新） */
  onAdded: () => void;
}

/**
 * 稍后读·快速添加条：一步直接入库。
 * 收集语义（抓取、降级、去重、事件）统一走 lib/reading/collect.ts，本组件只负责输入与反馈。
 */
export function QuickAddBar({ onAdded }: QuickAddBarProps) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    try {
      const result = await collectReadingItem(url);
      toast(collectResultToast(result));
      if (result.status === "error") return;
      setUrl("");
      // duplicate 不改变列表，无需刷新
      if (result.status !== "duplicate") onAdded();
    } finally {
      setAdding(false);
    }
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
            onComplete={(success, failed, skipped) => {
              // 不自动关 Dialog：失败项列表和「重试失败项」按钮需要留在用户眼前
              if (success > 0 || skipped > 0) {
                const parts = [`成功 ${success} 条`];
                if (skipped > 0) parts.push(`跳过 ${skipped} 条（已存在）`);
                if (failed > 0) parts.push(`失败 ${failed} 条`);
                toast({ title: `批量导入完成：${parts.join("，")}` });
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
