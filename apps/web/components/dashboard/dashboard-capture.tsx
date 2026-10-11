"use client";

import { useMemo, useState } from "react";
import { PenLine, Loader2 } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { collectReadingItem, collectResultToast } from "@/lib/reading/collect";
import { createQuickTask } from "@/lib/tasks/quick-create";
import { CAPTURE_KIND_LABEL, detectCapture } from "@/lib/capture/detect";
import { isImeComposing } from "@/lib/input/submit-guard";

/**
 * 工作台快速记录框（统一快速记录，见 lib/capture/detect）：
 * - 输入时实时显示「回车保存为：稍后读 / 待办 / 速记」，所见即所得
 * - 链接 → collectReadingItem；「待办：」前缀 → createQuickTask；其余 → /api/memos
 * - 「其它类型…」把当前输入带进「＋」快速新建面板，在那里改选类型（同一套创建通道）
 */
export function DashboardCapture({ onAdded }: { onAdded: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const detected = detectCapture(text);

  const handleSubmit = async () => {
    const { kind, text: value } = detectCapture(text);
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      if (kind === "url") {
        const result = await collectReadingItem(value);
        toast(collectResultToast(result));
        if (result.status !== "error") {
          setText("");
          if (result.status !== "duplicate") onAdded();
        }
        return;
      }
      if (kind === "task") {
        const result = await createQuickTask(supabase, { title: value });
        if (result.status === "failed" || result.status === "unauthenticated") {
          toast({ title: result.status === "failed" ? result.message : "请先登录", variant: "destructive" });
          return;
        }
        setText("");
        toast({ title: result.status === "queued" ? "已离线创建，联网后自动同步" : "已添加待办" });
        window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
        onAdded();
        return;
      }
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
    <div className="dashboard-capture flex flex-col gap-1.5">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <PenLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isImeComposing(e) && !submitting) void handleSubmit();
            }}
            placeholder="记录想法、粘贴链接，或以「待办：」开头添加待办…"
            aria-label="快速记录"
            aria-describedby="dashboard-capture-hint"
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("organize:quick-add", { detail: { text } }))
          }
        >
          其它类型…
        </Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={submitting || !detected.text}>
          {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          保存{detected.text ? `为${CAPTURE_KIND_LABEL[detected.kind]}` : ""}
        </Button>
      </div>
      <p id="dashboard-capture-hint" className="min-h-4 pl-1 text-xs text-muted-foreground" aria-live="polite">
        {detected.text ? `回车保存为「${CAPTURE_KIND_LABEL[detected.kind]}」` : ""}
      </p>
    </div>
  );
}
