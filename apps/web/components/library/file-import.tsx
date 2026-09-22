"use client";

// 资料库「文件」视图的导入面板（阶段 D）：拖入/选择文件 → POST /api/imports。
// 逐文件显示状态（待处理/上传中/解析中/已保存/失败），失败项可单独重试
// （复用同一 retryKey，服务端唯一约束幂等，不重复建资料）。
// 统一输入框拖入的文件经 organize:import-files 事件交给本面板（任务书 §七：
// 文件进入导入流程）。
import { useCallback, useEffect, useRef, useState } from "react";
import { IMPORT_ACCEPT } from "@/lib/imports/kinds";
import { validateImportBatch } from "@/lib/imports/budgets";
import type { ImportFileResult } from "@/lib/imports/types";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export const IMPORT_FILES_EVENT = "organize:import-files";

const STATUS_LABEL: Record<ImportFileResult["status"], string> = {
  pending: "待处理",
  uploading: "上传中",
  parsing: "解析中",
  saved: "已保存",
  failed: "失败",
};

export function statusLabel(status: ImportFileResult["status"]): string {
  return STATUS_LABEL[status];
}

interface PendingFile {
  file: File;
  retryKey: string;
}

type QueueRow = ImportFileResult & { retryKey: string; file?: File };

export function FileImport({ onImported }: { onImported: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const submit = useCallback(async (pending: PendingFile[]) => {
    if (running || !pending.length) return;
    setRunning(true);
    // 先出队列占位（乐观状态：上传中），失败重试时保留原行
    setQueue((prev) => {
      const rest = prev.filter((row) => !pending.some((p) => p.retryKey === row.retryKey));
      return [
        ...pending.map((p) => ({
          id: p.retryKey, taskId: "", fileName: p.file.name, kind: "text" as const,
          size: p.file.size, status: "uploading" as const, error: null,
          readingItemId: null, pageCount: null,
          createdAt: new Date().toISOString(), retryKey: p.retryKey,
        })),
        ...rest,
      ];
    });
    try {
      const form = new FormData();
      for (const { file, retryKey } of pending) {
        form.append("files", file);
        form.append("retryKeys", retryKey);
      }
      const res = await fetch("/api/imports", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: data?.error || "导入失败", variant: "destructive" });
        setQueue((prev) => prev.filter((row) => !pending.some((p) => p.retryKey === row.retryKey)));
        return;
      }
      const results = (data.files ?? []) as ImportFileResult[];
      setQueue((prev) => [
        ...results.map((row) => {
          const match = pending.find((p) => p.retryKey === row.id || p.file.name === row.fileName);
          return { ...row, retryKey: match?.retryKey ?? row.id, file: match?.file };
        }),
        ...prev.filter((row) => !pending.some((p) => p.retryKey === row.retryKey)),
      ]);
      const saved = results.filter((r) => r.status === "saved").length;
      const failed = results.filter((r) => r.status === "failed").length;
      if (failed === 0) toast({ title: `已导入 ${saved} 个文件` });
      else if (saved === 0) toast({ title: `${failed} 个文件导入失败`, variant: "destructive" });
      else toast({ title: `已导入 ${saved} 个，${failed} 个失败（可在下方单独重试）`, variant: "destructive" });
      onImportedRef.current();
    } catch {
      toast({ title: "导入失败：网络异常，请稍后重试", variant: "destructive" });
      setQueue((prev) => prev.filter((row) => !pending.some((p) => p.retryKey === row.retryKey)));
    } finally {
      setRunning(false);
    }
  }, [running]);

  const runFiles = useCallback((files: File[]) => {
    const batchError = validateImportBatch(files);
    if (batchError) {
      toast({ title: batchError, variant: "destructive" });
      return;
    }
    void submit(files.map((file) => ({ file, retryKey: crypto.randomUUID() })));
  }, [submit]);

  // 统一输入框拖入文件 → 导入流程（任务书 §七）
  const runRef = useRef(runFiles);
  runRef.current = runFiles;
  useEffect(() => {
    const handler = (event: Event) => {
      const files = (event as CustomEvent<{ files?: File[] }>).detail?.files;
      if (files?.length) runRef.current(files);
    };
    window.addEventListener(IMPORT_FILES_EVENT, handler);
    return () => window.removeEventListener(IMPORT_FILES_EVENT, handler);
  }, []);

  const retry = (row: QueueRow) => {
    if (!row.file) {
      // File 句柄不在内存（如页面刷新后从恢复列表重试）：引导重新选择
      inputRef.current?.click();
      toast({ title: `请重新选择「${row.fileName}」以重试（结果会并入原导入记录）` });
      return;
    }
    // 复用原 retryKey：服务端唯一约束幂等，重试不产生重复资料
    void submit([{ file: row.file, retryKey: row.retryKey }]);
  };

  return (
    <section
      aria-label="文件导入"
      className={cn(
        "rounded-lg border border-dashed px-4 py-3 transition-colors",
        dragging ? "border-primary bg-accent" : "border-border bg-muted/20",
      )}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = running ? "none" : "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (running) return;
        const dropped = Array.from(event.dataTransfer.files);
        if (dropped.length) runFiles(dropped);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">导入文件</span>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          原件存档 + 提取正文入稍后读；支持 TXT / Markdown / CSV / JSON / PDF / DOCX / XLSX、图片与音频
        </span>
        <Button variant="outline" size="sm" disabled={running} onClick={() => inputRef.current?.click()}>
          {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          选择文件
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          className="hidden"
          aria-label="选择要导入的文件"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (selected.length) runFiles(selected);
          }}
        />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        每次最多 6 个文件、合计 20MB；PDF 限 200 页，Excel 限 50 个工作表 / 10 万单元格。
        扫描型 PDF 会提示需要 OCR；加密、损坏或超限文件会分别说明原因，原件保留、可单独重试。
      </p>

      {queue.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label="导入结果">
          {queue.slice(0, 12).map((row) => (
            <li key={row.retryKey} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{row.fileName}</span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5",
                  row.status === "saved" && "bg-muted text-muted-foreground",
                  row.status === "failed" && "bg-destructive/10 text-destructive",
                  (row.status === "uploading" || row.status === "parsing" || row.status === "pending") &&
                    "bg-muted text-muted-foreground",
                )}
              >
                {STATUS_LABEL[row.status]}
              </span>
              {row.status === "failed" && (
                <>
                  <span className="min-w-0 flex-[100%] basis-full text-destructive sm:flex-none sm:basis-auto">
                    {row.error}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => retry(row)}>
                    重试
                  </Button>
                </>
              )}
              {row.status === "saved" && row.readingItemId && (
                <a className="rounded px-1.5 py-0.5 text-primary hover:underline" href={`/library/${row.readingItemId}`}>
                  打开条目
                </a>
              )}
              {row.status === "saved" && !row.readingItemId && (
                <span className="text-muted-foreground">原件已存档</span>
              )}
            </li>
          ))}
          {queue.length > 12 && (
            <li className="text-xs text-muted-foreground">……共 {queue.length} 项，完整历史见下方文件列表</li>
          )}
        </ul>
      )}
    </section>
  );
}
