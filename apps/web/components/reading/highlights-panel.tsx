"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ExternalLink, ListTodo, StickyNote, Trash2, X } from "lucide-react";
import type { Highlight, HighlightColor } from "@organize/shared";
import { toast } from "@/hooks/use-toast";
import type { HighlightReferenceState } from "@/lib/reading/highlight-references";

const COLOR_DOT: Record<HighlightColor, string> = {
  yellow: "bg-yellow-300",
  green: "bg-green-300",
  blue: "bg-blue-300",
  pink: "bg-pink-300",
  purple: "bg-purple-300",
};

interface HighlightsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  highlights: Highlight[];
  references: Record<string, HighlightReferenceState>;
  onDelete: (id: string) => Promise<void>;
  onConvert: (id: string, targetType: "note" | "task") => Promise<void>;
  onOpenReference: (targetType: "note" | "task", id: string) => void;
}

function truncateText(text: string, maxLen: number = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export function HighlightsPanel({
  isOpen,
  onClose,
  highlights,
  references,
  onDelete,
  onConvert,
  onOpenReference,
}: HighlightsPanelProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [convertingKey, setConvertingKey] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
  };

  const handleHighlightClick = (highlight: Highlight) => {
    const marks = document.querySelectorAll("mark.hl-yellow, mark.hl-green, mark.hl-blue, mark.hl-pink, mark.hl-purple");
    for (const mark of Array.from(marks)) {
      if (mark.textContent?.trim() === highlight.content.trim()) {
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
        mark.classList.add("ring-2", "ring-primary", "ring-offset-1");
        setTimeout(() => mark.classList.remove("ring-2", "ring-primary", "ring-offset-1"), 1500);
        onClose();
        return;
      }
    }
    toast({ title: "请选中后点击高亮位置", description: "刷新页面后高亮位置需要重新选择" });
  };

  const handleConvert = async (id: string, targetType: "note" | "task") => {
    const key = `${id}:${targetType}`;
    setConvertingKey(key);
    await onConvert(id, targetType);
    setConvertingKey(null);
  };

  const renderReferenceAction = (
    highlight: Highlight,
    targetType: "note" | "task"
  ) => {
    const reference = references[highlight.id];
    const id = targetType === "note" ? highlight.note_id : highlight.task_id;
    const state = targetType === "note" ? reference?.note_state : reference?.task_state;
    const label = targetType === "note" ? "笔记" : "任务";
    const Icon = targetType === "note" ? StickyNote : ListTodo;
    if (!id) {
      return (
        <button
          onClick={(event) => {
            event.stopPropagation();
            void handleConvert(highlight.id, targetType);
          }}
          disabled={convertingKey === `${highlight.id}:${targetType}`}
          className="inline-flex min-h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent disabled:opacity-50"
        >
          <Icon className="h-3.5 w-3.5" />
          转为{label}
        </button>
      );
    }
    if (state === "active") {
      return (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onOpenReference(targetType, id);
          }}
          className="inline-flex min-h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          打开{label}
        </button>
      );
    }
    return (
      <span className="inline-flex min-h-8 items-center rounded-md border border-dashed px-2 text-xs text-muted-foreground">
        {state === "deleted" ? `${label}已在垃圾箱` : state === "missing" ? `${label}引用已失效` : "检查中"}
      </span>
    );
  };

  const renderHighlights = (mobile = false) =>
    highlights.map((highlight) => (
      <div
        key={highlight.id}
        className="group cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent/50"
        onClick={() => handleHighlightClick(highlight)}
      >
        <div className="flex items-start gap-2">
          <div className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", COLOR_DOT[highlight.color])} />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-relaxed text-foreground">{truncateText(highlight.content)}</p>
            {highlight.note && (
              <p className="mt-1.5 border-l-2 border-muted pl-2 text-xs text-muted-foreground">
                {highlight.note}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {renderReferenceAction(highlight, "note")}
              {renderReferenceAction(highlight, "task")}
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDelete(highlight.id);
                }}
                disabled={deletingId === highlight.id}
                className={cn(
                  "ml-auto min-h-8 rounded p-1.5 text-muted-foreground transition-colors hover:text-destructive",
                  !mobile && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                )}
                title="删除高亮"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="mt-1 block text-xs text-muted-foreground">
              {new Date(highlight.created_at).toLocaleString("zh-CN", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      </div>
    ));

  return (
    <>
      <div
        className={cn(
          "hidden xl:block fixed top-14 right-0 bottom-0 z-20 w-80 bg-background border-l transition-transform duration-300",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h4 className="text-sm font-semibold">划线高亮</h4>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-57px)] p-4">
          {highlights.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              暂无高亮，选中文本即可添加高亮
            </div>
          ) : (
            <div className="space-y-3">
              {renderHighlights()}
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          "xl:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "xl:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t",
          "rounded-t-xl transition-transform duration-300 ease-out",
          "max-h-[70vh] overflow-y-auto",
          isOpen ? "translate-y-0" : "translate-y-full"
        )}
      >
        <div className="sticky top-0 bg-background border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">划线高亮</h4>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-sm p-1"
            >
              关闭
            </button>
          </div>
        </div>
        <div className="p-4">
          {highlights.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              暂无高亮，选中文本即可添加高亮
            </div>
          ) : (
            <div className="space-y-3">
              {renderHighlights(true)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
