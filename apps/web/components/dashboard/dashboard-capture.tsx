"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PenLine, Loader2 } from "@/components/icons";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { collectReadingItem, collectResultToast } from "@/lib/reading/collect";
import { createQuickTask } from "@/lib/tasks/quick-create";
import { CAPTURE_KIND_LABEL, detectCapture } from "@/lib/capture/detect";
import { isImeComposing } from "@/lib/input/submit-guard";
import { captureDraftStorageKey, draftAfterSubmit, isCaptureSubmissionCurrent } from "@/lib/dashboard/capture-draft";

/**
 * 工作台快速记录框（统一快速记录，见 lib/capture/detect）：
 * - 输入时实时显示「回车保存为：稍后读 / 待办 / 速记」，所见即所得
 * - 链接 → collectReadingItem；「待办：」前缀 → createQuickTask；其余 → /api/memos
 * - 「其它类型…」把当前输入带进「＋」快速新建面板，在那里改选类型（同一套创建通道）
 */
export function DashboardCapture({ onAdded }: { onAdded: (task?: import("@organize/shared").Task) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const hydrated = useRef(false);
  const editedBeforeHydration = useRef(false);
  const authUserId = useRef<string | null>(null);
  const accountGeneration = useRef(0);
  const pending = useRef(false);
  const detected = detectCapture(text);

  useEffect(() => {
    let active = true;
    const hydrateAccount = (id: string | null) => {
      if (!active) return;
      if (hydrated.current && authUserId.current === id) return;
      accountGeneration.current += 1;
      pending.current = false;
      setSubmitting(false);
      authUserId.current = id;
      setUserId(id);
      if (!hydrated.current && editedBeforeHydration.current) {
        hydrated.current = true;
        return;
      }
      try {
        setText(id ? window.localStorage.getItem(captureDraftStorageKey(id)) || "" : "");
        setStorageUnavailable(false);
      } catch {
        setText("");
        setStorageUnavailable(true);
      }
      hydrated.current = true;
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && !hydrated.current) {
        if (error) setStorageUnavailable(true);
        hydrateAccount(data.session?.user.id ?? null);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      hydrateAccount(session?.user.id ?? null);
    });
    return () => {
      active = false;
      accountGeneration.current += 1;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!hydrated.current || !userId) return;
    try {
      const key = captureDraftStorageKey(userId);
      if (text) window.localStorage.setItem(key, text);
      else window.localStorage.removeItem(key);
      setStorageUnavailable(false);
    } catch { setStorageUnavailable(true); }
  }, [text, userId]);

  const handleSubmit = async () => {
    const { kind, text: value } = detectCapture(text);
    if (!value || pending.current) return;
    const submittedUserId = authUserId.current;
    if (!submittedUserId) {
      toast({ title: "请先登录", variant: "destructive" });
      return;
    }
    const submittedGeneration = accountGeneration.current;
    const isCurrent = () => isCaptureSubmissionCurrent(submittedUserId, submittedGeneration, authUserId.current, accountGeneration.current);
    const submittedText = text;
    const clearSubmittedSnapshot = () => setText((current) => draftAfterSubmit(current, submittedText));
    pending.current = true;
    setSubmitting(true);
    try {
      if (kind === "url") {
        const result = await collectReadingItem(value, { expectedUserId: submittedUserId });
        if (!isCurrent()) return;
        toast(collectResultToast(result));
        if (result.status !== "error") {
          clearSubmittedSnapshot();
          if (result.status !== "duplicate") onAdded();
        }
        return;
      }
      if (kind === "task") {
        const result = await createQuickTask(supabase, { title: value, expectedUserId: submittedUserId });
        if (!isCurrent()) return;
        if (result.status === "failed" || result.status === "unauthenticated") {
          toast({ title: result.status === "failed" ? result.message : "请先登录", variant: "destructive" });
          return;
        }
        if (result.status === "queued" && !result.persisted) {
          toast({ title: "离线待办未能保存，请复制内容后重试", variant: "destructive" });
          return;
        }
        clearSubmittedSnapshot();
        toast({
          title: result.status === "queued" ? "已离线保存，联网后自动同步" : "待办已添加",
          ...(result.status === "created" ? { action: <Link href={`/tasks?scope=all&task=${result.task.id}`}>打开任务</Link> } : {}),
        });
        window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
        onAdded(result.task);
        return;
      }
      const res = await fetch("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      if (!isCurrent()) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (!isCurrent()) return;
        toast({ title: body.error || "保存速记失败", variant: "destructive" });
        return;
      }
      clearSubmittedSnapshot();
      toast({ title: "已保存为速记" });
      onAdded();
    } catch (error) {
      if (isCurrent()) toast({ title: error instanceof Error ? error.message : "保存失败，请重试", variant: "destructive" });
    } finally {
      if (isCurrent()) {
        pending.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="dashboard-capture flex flex-col gap-1.5">
      <div className="dashboard-capture-fields">
        <div className="dashboard-capture-input relative">
          <PenLine className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Textarea
            value={text}
            onChange={(e) => {
              if (!hydrated.current) editedBeforeHydration.current = true;
              setText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) {
                e.preventDefault();
                if (!submitting) void handleSubmit();
              }
            }}
            placeholder="记录想法、粘贴链接，或以「待办：」开头添加待办…"
            aria-label="快速记录"
            aria-describedby="dashboard-capture-hint"
            className="min-h-20 resize-y border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="dashboard-capture-actions">
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
      </div>
      <p id="dashboard-capture-hint" className="min-h-4 pl-1 text-xs text-muted-foreground" aria-live="polite">
        {detected.text ? `回车保存为「${CAPTURE_KIND_LABEL[detected.kind]}」` : ""}
      </p>
      {storageUnavailable && (
        <p role="status" className="pl-1 text-xs text-destructive">
          草稿暂存在当前页面；浏览器存储不可用，切换账号或刷新前请先保存。
        </p>
      )}
    </div>
  );
}
