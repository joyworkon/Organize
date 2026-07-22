"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tiptapJsonToMarkdown, downloadMarkdown } from "@/lib/export/tiptap-to-md";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { Note } from "@organize/shared";

interface ExportButtonProps {
  noteId: string;
  /** 已知的笔记标题（避免重复请求；若未传会拉取） */
  title?: string;
  size?: "icon" | "sm" | "default";
  iconOnly?: boolean;
  triggerVariant?: "ghost" | "outline";
}

/**
 * 导出笔记为 Markdown 文件。
 * 因为列表页只拿得到 noteId，这里自己拉一次完整 content。
 */
export function ExportButton({
  noteId,
  title,
  size = "icon",
  iconOnly = true,
  triggerVariant = "ghost",
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleExport = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notes")
        .select("title, content")
        .eq("id", noteId)
        .maybeSingle();
      if (error || !data) {
        console.error("导出失败", error);
        return;
      }
      const md = tiptapJsonToMarkdown(
        data.content as Record<string, unknown> | null,
        data.title || title || "无标题"
      );
      const filename = (data.title || title || "note").replace(/[\\/:*?"<>|]/g, "_");
      downloadMarkdown(filename, md);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={triggerVariant}
      size={size}
      className="gap-1.5"
      title="导出为 Markdown"
      onClick={handleExport}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className={cn(iconOnly ? "h-4 w-4" : "h-3.5 w-3.5", "animate-spin")} />
      ) : (
        <Download className={iconOnly ? "h-4 w-4" : "h-3.5 w-3.5"} />
      )}
      {!iconOnly && "导出"}
    </Button>
  );
}
