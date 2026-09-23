"use client";

// 资料库「文件」视图（阶段 D；阶段 1 加固）：
// - 刷新后可恢复（持久在 import_files 表），游标分页「加载更多」（不再只有最近 50 条）；
// - 失败行真正可重试：File 句柄已随刷新丢失，重试走「重新选择文件」——先确认身份
//   （文件名与大小都与原记录一致才提交），并复用行上的 retryKey（服务端幂等，不重复建资料）；
// - 状态轮询直到没有进行中的文件；服务端惰性中断回收保证卡住的行终会变成可重试的终态；
// - 原件经 /api/imports/file 鉴权下载。
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ImportFileResult } from "@/lib/imports/types";
import { statusLabel } from "./file-import";
import { FileText, Loader2, RotateCcw } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { AddToCollectionsButton } from "@/components/collections/add-to-collections-button";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  text: "文本", markdown: "Markdown", csv: "CSV", json: "JSON",
  pdf: "PDF", docx: "DOCX", xlsx: "XLSX", image: "图片", audio: "音频",
};

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesView({
  refreshTick,
  onImported,
}: {
  refreshTick: number;
  /** 重试提交成功后通知父级递增 refreshTick（本视图随之刷新，导入面板同步） */
  onImported?: () => void;
}) {
  const [files, setFiles] = useState<ImportFileResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFiles = useCallback(async (cursor?: string | null, append = false) => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/imports?${params}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { files: ImportFileResult[]; nextCursor: string | null };
      setFiles((prev) => (append ? [...prev, ...data.files] : data.files));
      setNextCursor(data.nextCursor);
      // 仍有进行中文件 → 2s 后轮询（中断回收在服务端惰性执行：卡住的行超阈值后
      // 会被标记 failed，轮询自然停止）。刷新/加载更多不重复排轮询。
      const busy = data.files.some(
        (f) => f.status === "pending" || f.status === "uploading" || f.status === "parsing",
      );
      if (busy && !cursor) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void fetchFiles(null, false), 2000);
      }
    } catch {
      /* 网络异常静默，下轮刷新或用户操作重试 */
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void fetchFiles(null, false);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchFiles, refreshTick]);

  // ---- 单文件重试（阶段 1）----
  const retryInputRef = useRef<HTMLInputElement>(null);
  const retryTargetRef = useRef<ImportFileResult | null>(null);
  const [retryingKey, setRetryingKey] = useState<string | null>(null);

  const startRetry = (file: ImportFileResult) => {
    retryTargetRef.current = file;
    retryInputRef.current?.click();
  };

  const submitRetry = useCallback(async (selected: File, target: ImportFileResult) => {
    setRetryingKey(target.retryKey);
    try {
      const form = new FormData();
      form.append("files", selected);
      form.append("retryKeys", target.retryKey);
      const res = await fetch("/api/imports", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: data?.error || "重试失败", variant: "destructive" });
        return;
      }
      const result = (data.files as ImportFileResult[] | undefined)?.[0];
      if (result?.status === "saved") toast({ title: `「${target.fileName}」重试成功` });
      else toast({ title: result?.error || "重试失败", variant: "destructive" });
      onImported?.();
    } catch {
      toast({ title: "重试失败：网络异常，请稍后重试", variant: "destructive" });
    } finally {
      setRetryingKey(null);
      retryTargetRef.current = null;
    }
  }, [onImported]);

  const onRetryFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = "";
    const target = retryTargetRef.current;
    if (!selected || !target) return;
    // 身份确认：文件名与大小都必须与原记录一致，防止把别的文件套进原导入记录
    if (selected.name !== target.fileName || selected.size !== target.size) {
      toast({
        title: "所选文件与原记录不一致（文件名或大小不匹配），未提交",
        description: `请重新选择「${target.fileName}」（${formatSize(target.size)}）`,
        variant: "destructive",
      });
      retryTargetRef.current = null;
      return;
    }
    void submitRetry(selected, target);
  };

  return (
    <div className="space-y-2" aria-busy={loading}>
      <input
        ref={retryInputRef}
        type="file"
        className="hidden"
        aria-label="重新选择文件以重试"
        onChange={onRetryFileSelected}
      />
      {loading ? (
        <div className="grid gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[64px] animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="还没有导入过文件"
          description="用上方「导入文件」拖入或选择文件：原件存档，正文提取后进入稍后读"
        />
      ) : (
        files.map((file) => (
          <div
            key={file.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2.5 text-sm"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{file.fileName}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {KIND_LABEL[file.kind] ?? file.kind}
            </span>
            <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-xs",
                file.status === "saved" && "bg-muted text-muted-foreground",
                file.status === "failed" && "bg-destructive/10 text-destructive",
                (file.status === "uploading" || file.status === "parsing" || file.status === "pending") &&
                  "bg-muted text-muted-foreground",
              )}
            >
              {file.status === "uploading" || file.status === "parsing" ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {statusLabel(file.status)}
                </span>
              ) : (
                statusLabel(file.status)
              )}
            </span>
            {file.pageCount != null && (
              <span className="text-xs text-muted-foreground">{file.pageCount} 页</span>
            )}
            {file.status === "failed" && file.error && (
              <span className="min-w-0 flex-[100%] basis-full text-xs text-destructive">
                {file.error}
              </span>
            )}
            <span className="flex items-center gap-1">
              {file.status === "saved" && (
                <AddToCollectionsButton
                  sourceType="file"
                  id={file.id}
                  hintTitle={file.fileName}
                  label="加入集合"
                />
              )}
              {file.readingItemId && (
                <a className="rounded px-2 py-1 text-primary hover:underline" href={`/library/${file.readingItemId}`}>
                  打开条目
                </a>
              )}
              <a
                className="rounded px-2 py-1 text-primary hover:underline"
                href={`/api/imports/file?id=${encodeURIComponent(file.id)}`}
              >
                下载原件
              </a>
              {file.status === "failed" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  disabled={retryingKey === file.retryKey}
                  aria-label={`重试导入 ${file.fileName}（需重新选择该文件）`}
                  onClick={() => startRetry(file)}
                >
                  {retryingKey === file.retryKey ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1 h-3 w-3" />
                  )}
                  重试
                </Button>
              )}
            </span>
          </div>
        ))
      )}

      {nextCursor && !loading && (
        <div className="py-2 text-center">
          <Button
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void fetchFiles(nextCursor, true);
            }}
          >
            {loadingMore ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                加载中...
              </>
            ) : (
              "加载更多"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
