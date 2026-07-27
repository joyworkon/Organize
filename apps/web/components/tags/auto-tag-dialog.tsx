"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShareResourceType } from "@organize/shared";

interface Suggestion {
  name: string;
  score: number;
  source: "keyword" | "ai";
}

interface AutoTagDialogProps {
  resourceType: ShareResourceType;
  resourceId: string;
  /** 应用标签后回调（父组件刷新自己的标签展示） */
  onApplied?: (tagNames: string[]) => void;
  triggerSize?: "icon" | "sm";
  triggerVariant?: "ghost" | "outline";
  iconOnly?: boolean;
  /** 受控状态（可选） */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AutoTagDialog({
  resourceType,
  resourceId,
  onApplied,
  triggerSize = "icon",
  triggerVariant = "ghost",
  iconOnly = true,
  open: openProp,
  onOpenChange,
}: AutoTagDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generatorName, setGeneratorName] = useState<string>("keyword");
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = async () => {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setSelected(new Set());
    try {
      const res = await fetch("/api/ai/tags/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource_type: resourceType,
          resource_id: resourceId,
          max_tags: 8,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `请求失败（${res.status}）`);
      }
      const data = await res.json();
      const sugg = (data.suggestions || []) as Suggestion[];
      setSuggestions(sugg);
      setGeneratorName(data.generator || "keyword");
      // 默认全选 score >= 0.5 的
      setSelected(new Set(sugg.filter((s) => s.score >= 0.5).map((s) => s.name)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (o && suggestions.length === 0) {
      fetchSuggestions();
    }
  };

  const handleApply = async () => {
    if (selected.size === 0) return;
    setApplying(true);
    setError(null);
    const endpoint =
      resourceType === "note"
        ? `/api/notes/${resourceId}/tags`
        : `/api/reading-items/${resourceId}/tags`;

    try {
      // 逐个提交（每个都是 POST name）
      const names = Array.from(selected);
      await Promise.all(
        names.map((name) =>
          fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          })
        )
      );
      onApplied?.(names);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "应用失败");
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      {openProp === undefined && (
        <Button
          variant={triggerVariant}
          size={iconOnly ? "sm" : triggerSize}
          className={cn(iconOnly && "h-7 w-7 p-0 gap-0", !iconOnly && "gap-1.5")}
          title="AI 自动打标签"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleOpenChange(true);
          }}
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {!iconOnly && "AI 标签"}
        </Button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              AI 自动打标签
            </DialogTitle>
            <DialogDescription>
              根据内容自动推荐标签，勾选后一键应用
              {generatorName === "ai" ? "（AI 模式）" : "（关键词模式，配置 OPENAI_API_KEY 启用 AI）"}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex flex-col items-center py-8 gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              <p className="text-sm text-muted-foreground">分析内容中...</p>
            </div>
          ) : error ? (
            <div className="py-4">
              <p className="text-sm text-destructive mb-3">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchSuggestions}>
                重试
              </Button>
            </div>
          ) : suggestions.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">
              没有提取到合适的标签，内容可能太短
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 py-2">
                {suggestions.map((s) => {
                  const checked = selected.has(s.name);
                  return (
                    <button
                      key={s.name}
                      onClick={() => toggle(s.name)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-accent"
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                      <span>{s.name}</span>
                      <span className="text-xs opacity-60">
                        {Math.round(s.score * 100)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                已选 {selected.size} / {suggestions.length} 个 · 数字是匹配度
              </p>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={applying}>
              取消
            </Button>
            <Button
              variant="outline"
              onClick={fetchSuggestions}
              disabled={loading || applying}
            >
              重新生成
            </Button>
            <Button
              onClick={handleApply}
              disabled={applying || selected.size === 0 || loading}
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              应用 {selected.size > 0 ? `(${selected.size})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
