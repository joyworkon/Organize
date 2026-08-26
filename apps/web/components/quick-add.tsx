"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Link, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { appEvents } from "@/lib/plugin/events";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type QuickAddMode = "menu" | "url";

export function QuickAdd() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<QuickAddMode>("menu");
  const [url, setUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef(url);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const openPanel = useCallback(() => {
    setOpen(true);
    setMode("menu");
    setUrl("");
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, []);

  const closePanel = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      setOpen(false);
      setMode("menu");
      setUrl("");
    }, 150);
  }, []);

  const handleAddUrl = useCallback(async () => {
    const trimmedUrl = urlRef.current.trim();
    if (!trimmedUrl) return;

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "请先登录", variant: "destructive" });
        return;
      }

      const { data: inserted, error } = await supabase
        .from("reading_items")
        .insert({
          user_id: user.id,
          url: trimmedUrl,
          title: trimmedUrl,
          reading_status: "unread",
          reading_progress: 0,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (inserted) {
        appEvents.emit("reading:item-created", {
          itemId: inserted.id,
          url: trimmedUrl,
          title: trimmedUrl,
        });
      }

      toast({ title: "已添加到稍后读" });
      closePanel();
    } catch {
      toast({ title: "添加失败", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }, [supabase, closePanel]);

  const handleCreateNote = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "请先登录", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          title: "无标题笔记",
          content: { type: "doc", content: [{ type: "paragraph" }] },
        })
        .select()
        .single();

      if (error || !data) {
        toast({ title: "创建失败", variant: "destructive" });
        return;
      }

      closePanel();
      router.push(`/notes/${data.id}`);
    } catch {
      toast({ title: "创建失败", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }, [supabase, router, closePanel]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = () => {
        const active = document.activeElement;
        if (!active) return false;
        const tag = active.tagName.toLowerCase();
        return tag === "input" || tag === "textarea" || (active as HTMLElement).isContentEditable;
      };

      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        if (!isInputFocused()) {
          e.preventDefault();
          if (open) {
            closePanel();
          } else {
            openPanel();
          }
        }
      }

      if (e.key === "Escape" && open) {
        e.preventDefault();
        closePanel();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && open && mode === "url") {
        e.preventDefault();
        handleAddUrl();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, mode, openPanel, closePanel, handleAddUrl]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, closePanel]);

  useEffect(() => {
    if (open && mode === "url" && urlInputRef.current) {
      setTimeout(() => urlInputRef.current?.focus(), 50);
    }
  }, [open, mode]);

  return (
    <>
      <Button
        size="icon"
        className={cn(
          "fixed right-4 sm:right-6 z-40 w-12 h-12 rounded-full",
          "shadow-sm border-2 border-primary/20",
          "hover:scale-105 transition-transform duration-200",
          "bottom-[max(6rem,calc(env(safe-area-inset-bottom)+6rem))] sm:bottom-6"
        )}
        onClick={open ? closePanel : openPanel}
      >
        <Plus className={cn("h-6 w-6 transition-transform duration-200", open && "rotate-45")} />
      </Button>

      {open && (
        <div
          ref={panelRef}
          className={cn(
            "fixed right-4 sm:right-6 z-40 w-[calc(100vw-2rem)] sm:w-80",
            "bg-card border rounded-lg p-2",
            "origin-bottom-right transition-all duration-150",
            isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95",
            "bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] sm:bottom-20"
          )}
        >
          {mode === "menu" && (
            <div className="space-y-1">
              <button
                className="flex items-center gap-2 p-2 rounded hover:bg-accent w-full text-left text-sm transition-colors"
                onClick={() => setMode("url")}
              >
                <Link className="h-4 w-4 text-muted-foreground" />
                <span>🔗 添加文章</span>
              </button>
              <button
                className="flex items-center gap-2 p-2 rounded hover:bg-accent w-full text-left text-sm transition-colors"
                onClick={handleCreateNote}
                disabled={isSubmitting}
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span>📝 新建笔记</span>
              </button>
              <div className="pt-2 mt-2 border-t">
                <p className="px-2 text-xs text-muted-foreground">
                  <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded border text-[10px]">⌘N</kbd> 快速打开
                </p>
              </div>
            </div>
          )}

          {mode === "url" && (
            <div className="space-y-2">
              <button
                className="flex items-center gap-1 p-1 rounded hover:bg-accent text-sm text-muted-foreground transition-colors"
                onClick={() => setMode("menu")}
              >
                ← 返回
              </button>
              <div className="flex gap-2">
                <Input
                  ref={urlInputRef}
                  placeholder="粘贴URL到这里..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddUrl();
                  }}
                />
                <Button size="sm" onClick={handleAddUrl} disabled={isSubmitting || !url.trim()}>
                  添加
                </Button>
              </div>
            </div>
          )}

        </div>
      )}
    </>
  );
}
