"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { parseBatchUrls, createConcurrencyGate, type BatchItem } from "@/lib/inbox/batch-import";
import { collectReadingItem } from "@/lib/reading/collect";
import {
  Link2,
  Loader2,
  CheckCircle2,
  XCircle,
  RotateCw,
  AlertCircle,
  Copy,
} from "lucide-react";

const CONCURRENCY = 3;

interface BatchImportPanelProps {
  /** 全部完成后回调（成功数 / 失败数 / 重复跳过数） */
  onComplete?: (successCount: number, failedCount: number, skippedCount: number) => void;
}

export function BatchImportPanel({ onComplete }: BatchImportPanelProps) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  // 原始文本保留，便于失败后重试
  const lastRawRef = useRef<string>("");

  const updateItem = (id: string, patch: Partial<BatchItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const processOne = useCallback(
    async (item: BatchItem): Promise<"success" | "failed" | "skipped"> => {
      updateItem(item.id, { status: "scraping", error: undefined, note: undefined });
      // 收集语义统一走 collectReadingItem（抓取/仅存链接降级/去重/事件），本面板只呈现逐条结果
      const result = await collectReadingItem(item.url);
      if (result.status === "error") {
        updateItem(item.id, { status: "failed", error: result.message || "保存失败" });
        return "failed";
      }
      if (result.status === "duplicate") {
        updateItem(item.id, {
          status: "duplicate",
          title: result.title ?? undefined,
          note: "已存在，跳过",
        });
        return "skipped";
      }
      updateItem(item.id, {
        status: "done",
        title: result.title ?? undefined,
        note: result.status === "saved-link-only" ? "抓取失败，仅存链接" : undefined,
      });
      return "success";
    },
    []
  );

  const runItems = useCallback(
    async (targets: BatchItem[]) => {
      if (targets.length === 0) return;
      setRunning(true);

      const gate = createConcurrencyGate(CONCURRENCY);
      let success = 0;
      let failed = 0;
      let skipped = 0;
      await Promise.all(
        targets.map(async (it) => {
          const outcome = await gate(() => processOne(it));
          if (outcome === "success") success += 1;
          else if (outcome === "skipped") skipped += 1;
          else failed += 1;
        })
      );

      setRunning(false);
      onComplete?.(success, failed, skipped);
    },
    [processOne, onComplete]
  );

  const start = useCallback(async () => {
    const urls = parseBatchUrls(text);
    if (urls.length === 0) return;

    lastRawRef.current = text;
    const initial: BatchItem[] = urls.map((u) => ({
      id: u,
      url: u,
      status: "pending",
    }));
    setItems(initial);
    await runItems(initial);
  }, [text, runItems]);

  const retryFailed = useCallback(async () => {
    const failedItems = items.filter((i) => i.status === "failed");
    await runItems(failedItems);
  }, [items, runItems]);

  const stats = {
    pending: items.filter((i) => i.status === "pending").length,
    active: items.filter((i) => i.status === "scraping" || i.status === "saving").length,
    done: items.filter((i) => i.status === "done").length,
    duplicate: items.filter((i) => i.status === "duplicate").length,
    failed: items.filter((i) => i.status === "failed").length,
  };
  const hasResults = items.length > 0;
  const hasFailed = stats.failed > 0;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div>
          <label className="text-sm font-medium">批量粘贴链接</label>
          <p className="text-xs text-muted-foreground mt-1">
            一行一个 URL，或用逗号/空格分隔。支持自动去重、并发抓取（最多 {CONCURRENCY} 个同时）；已收藏过的链接会跳过。
          </p>
        </div>

        <textarea
          className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
          placeholder={"https://example.com/article-1\nhttps://example.com/article-2\nhttps://example.com/article-3"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={running}
          spellCheck={false}
        />

        <div className="flex items-center gap-2">
          <Button onClick={start} disabled={running || !text.trim()}>
            {running ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                开始批量抓取
              </>
            )}
          </Button>
          {hasFailed && !running && (
            <Button variant="outline" onClick={retryFailed}>
              <RotateCw className="h-4 w-4 mr-2" />
              重试失败项（{stats.failed}）
            </Button>
          )}
          {hasResults && !running && (
            <Button
              variant="ghost"
              onClick={() => {
                setItems([]);
                setText("");
              }}
            >
              清空
            </Button>
          )}
        </div>

        {hasResults && (
          <div className="space-y-2">
            {/* 进度汇总 */}
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                成功 {stats.done}
              </span>
              {stats.duplicate > 0 && (
                <span className="text-amber-600 flex items-center gap-1">
                  <Copy className="h-3.5 w-3.5" />
                  跳过 {stats.duplicate}
                </span>
              )}
              {stats.failed > 0 && (
                <span className="text-destructive flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5" />
                  失败 {stats.failed}
                </span>
              )}
              {stats.active > 0 && (
                <span className="text-blue-600 flex items-center gap-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  处理中 {stats.active}
                </span>
              )}
              {stats.pending > 0 && (
                <span className="text-muted-foreground">等待 {stats.pending}</span>
              )}
            </div>

            {/* 进度条 */}
            {running && (
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width: `${Math.round(((stats.done + stats.duplicate + stats.failed) / items.length) * 100)}%`,
                  }}
                />
              </div>
            )}

            {/* 列表 */}
            <div className="max-h-64 overflow-y-auto space-y-1 border rounded-md p-2">
              {items.map((it) => (
                <div
                  key={it.id}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded text-sm",
                    it.status === "done" && "bg-green-50 dark:bg-green-950/30",
                    it.status === "duplicate" && "bg-amber-50 dark:bg-amber-950/30",
                    it.status === "failed" && "bg-destructive/5"
                  )}
                >
                  <div className="shrink-0">
                    {it.status === "done" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    {it.status === "duplicate" && <Copy className="h-4 w-4 text-amber-600" />}
                    {it.status === "failed" && <XCircle className="h-4 w-4 text-destructive" />}
                    {(it.status === "scraping" || it.status === "saving") && (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    )}
                    {it.status === "pending" && (
                      <div className="h-4 w-4 rounded-full border-2 border-muted" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">
                      {it.title || it.url}
                    </p>
                    {it.note && (
                      <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        {it.note}
                      </p>
                    )}
                    {it.error && (
                      <p className="text-xs text-destructive flex items-center gap-1 mt-0.5">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        {it.error}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{it.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
