"use client";

// 「生成整理稿」对话框（阶段 4）：预览（来源清单 + 字符预算）→ 确认生成。
// 生成幂等（同来源同版本复用既有整理稿）；失败可原样重试；AI 未配置/mock
// 时明确报错，来源资料不受任何影响。
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "@/components/icons";
import { toast } from "@/hooks/use-toast";

export interface DigestRequest {
  collectionId: string;
  sourceType: "reading" | "memo" | "file";
  ids: string[];
}

interface PreviewSource {
  sourceType: string;
  sourceId: string;
  label: string;
  chars: number;
}

export function DigestPreviewDialog({
  request,
  onClose,
  onCreated,
}: {
  request: DigestRequest | null;
  onClose: () => void;
  onCreated?: (digestId: string) => void;
}) {
  const [preview, setPreview] = useState<{ key: string; totalChars: number; sources: PreviewSource[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    void (async () => {
      try {
        const res = await fetch(`/api/collections/${request.collectionId}/digest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceType: request.sourceType, ids: request.ids, preview: true }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error || "预览失败");
          return;
        }
        setPreview(data.preview);
      } catch {
        if (!cancelled) setError("预览失败：网络异常");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!request) return null;

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${request.collectionId}/digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: request.sourceType, ids: request.ids }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "整理稿生成失败");
        return;
      }
      toast({
        title: data.reused
          ? `已有同版本整理稿《${data.title}》，直接打开（幂等，不重复生成）`
          : `整理稿《${data.title}》已生成`,
      });
      onCreated?.(data.digestId);
      onClose();
    } catch {
      setError("整理稿生成失败：网络异常");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="生成整理稿"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border bg-card p-4 shadow-lg">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          生成整理稿
        </h2>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </div>
        ) : preview ? (
          <>
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto" aria-label="来源清单">
              {preview.sources.map((source, index) => (
                <li key={`${source.sourceType}:${source.sourceId}`} className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                    来源{index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{source.label}</span>
                  <span className="text-muted-foreground">{source.chars.toLocaleString()} 字</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              合计 {preview.totalChars.toLocaleString()} 字（预算：单来源 2 万、合计 6 万字，超限不会截断提交）。
              生成的是独立文章，不改动来源；同来源同版本重复生成会复用既有整理稿。
            </p>
          </>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button
            size="sm"
            disabled={loading || generating || !!error || !preview}
            onClick={() => void generate()}
          >
            {generating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            {generating ? "生成中…" : "确认生成"}
          </Button>
        </div>
      </div>
    </div>
  );
}
