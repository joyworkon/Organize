"use client";

import { useState } from "react";
import { PenLine, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { collectReadingItem, collectResultToast } from "@/lib/reading/collect";
import { extractFirstUrl } from "@/lib/inbox/batch-import";

/**
 * 工作台快速记录框（D03 §5.1）：
 * - 输入含链接 → 走既有 collectReadingItem 收集路径（抓取/降级/去重/事件不变）
 * - 纯文本 → 走既有 /api/memos 路径保存为速记，并明确提示类型
 * - 「选择类型」打开既有 QuickAdd 选择器（organize:quick-add 事件，不新增创建通道）
 */
export function DashboardCapture({ onAdded }: { onAdded: () => void }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const value = text.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      const url = extractFirstUrl(value);
      if (url) {
        const result = await collectReadingItem(value);
        toast(collectResultToast(result));
        if (result.status !== "error") {
          setText("");
          if (result.status !== "duplicate") onAdded();
        }
        return;
      }
      // 未知输入默认速记，并明确告知类型
      const res = await fetch("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: body.error || "保存速记失败", variant: "destructive" });
        return;
      }
      setText("");
      toast({ title: "已保存为速记" });
      onAdded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-1">
        <PenLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !submitting) void handleSubmit();
          }}
          placeholder="记录想法或粘贴链接…"
          aria-label="记录想法或粘贴链接"
          className="pl-9"
        />
      </div>
      <Button type="button" onClick={() => window.dispatchEvent(new CustomEvent("organize:quick-add"))} variant="outline">
        选择类型
      </Button>
      <Button type="button" onClick={() => void handleSubmit()} disabled={submitting || !text.trim()}>
        {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
        创建
      </Button>
    </div>
  );
}
