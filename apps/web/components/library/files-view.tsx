"use client";

// 资料库「文件」视图（阶段 D）：导入记录列表（GET /api/imports）。
// 刷新后可恢复（持久在 import_files 表）；状态轮询直到没有进行中的文件；
// 失败项单独重试（服务端 retry_key 唯一约束幂等）；原件经 /api/imports/file 鉴权下载。
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import type { ImportFileResult } from "@/lib/imports/types";
import { statusLabel } from "./file-import";
import { FileText, Loader2 } from "@/components/icons";
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

export function FilesView({ refreshTick }: { refreshTick: number }) {
  const [files, setFiles] = useState<ImportFileResult[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/imports?limit=50", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { files: ImportFileResult[] };
      setFiles(data.files);
      // 仍有进行中文件 → 2s 后轮询（状态机落库可恢复，不依赖内存 Promise）
      const busy = data.files.some(
        (f) => f.status === "pending" || f.status === "uploading" || f.status === "parsing",
      );
      if (busy) timerRef.current = setTimeout(() => void fetchFiles(), 2000);
    } catch {
      /* 网络异常静默，下轮刷新或用户操作重试 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void fetchFiles();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchFiles, refreshTick]);

  return (
    <div className="space-y-2" aria-busy={loading}>
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
            </span>
          </div>
        ))
      )}
    </div>
  );
}
