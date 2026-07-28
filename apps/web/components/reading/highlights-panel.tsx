"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Trash2, X } from "lucide-react";
import type { Highlight, HighlightColor } from "@organize/shared";
import { toast } from "@/hooks/use-toast";

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
  onDelete: (id: string) => Promise<void>;
}

function truncateText(text: string, maxLen: number = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export function HighlightsPanel({ isOpen, onClose, highlights, onDelete }: HighlightsPanelProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
              {highlights.map((highlight) => (
                <div
                  key={highlight.id}
                  className="group p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => handleHighlightClick(highlight)}
                >
                  <div className="flex items-start gap-2">
                    <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", COLOR_DOT[highlight.color])} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed text-foreground">
                        {truncateText(highlight.content)}
                      </p>
                      {highlight.note && (
                        <p className="text-xs text-muted-foreground mt-1.5 pl-2 border-l-2 border-muted">
                          {highlight.note}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">
                          {new Date(highlight.created_at).toLocaleString("zh-CN", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(highlight.id);
                          }}
                          disabled={deletingId === highlight.id}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive rounded transition-all"
                          title="删除高亮"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
              {highlights.map((highlight) => (
                <div
                  key={highlight.id}
                  className="group p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => handleHighlightClick(highlight)}
                >
                  <div className="flex items-start gap-2">
                    <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", COLOR_DOT[highlight.color])} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed">
                        {truncateText(highlight.content)}
                      </p>
                      {highlight.note && (
                        <p className="text-xs text-muted-foreground mt-1.5 pl-2 border-l-2 border-muted">
                          {highlight.note}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">
                          {new Date(highlight.created_at).toLocaleString("zh-CN", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(highlight.id);
                          }}
                          disabled={deletingId === highlight.id}
                          className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                          title="删除高亮"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
