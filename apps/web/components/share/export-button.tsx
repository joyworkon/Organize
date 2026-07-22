"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tiptapJsonToMarkdown, downloadMarkdown } from "@/lib/export/tiptap-to-md";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

interface ExportButtonProps {
  noteId: string;
  /** 已知的笔记标题（避免重复请求；若未传会拉取） */
  title?: string;
  size?: "icon" | "sm" | "default";
  iconOnly?: boolean;
  triggerVariant?: "ghost" | "outline";
}

/**
 * 导出单篇笔记为 Markdown。内部封装：拉数据 → 转 MD → 触发下载。
 * 可直接调用，不需要渲染按钮（供菜单项复用）。
 */
export async function exportNoteToMarkdown(noteId: string, fallbackTitle?: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("notes")
    .select("title, content")
    .eq("id", noteId)
    .maybeSingle();
  if (error || !data) {
    console.error("导出失败", error);
    throw new Error("导出失败");
  }
  const md = tiptapJsonToMarkdown(
    data.content as Record<string, unknown> | null,
    data.title || fallbackTitle || "无标题"
  );
  const filename = (data.title || fallbackTitle || "note").replace(/[\\/:*?"<>|]/g, "_");
  downloadMarkdown(filename, md);
}

/**
 * 导出按钮（卡片直接渲染场景）。
 */
export function ExportButton({
  noteId,
  title,
  size = "icon",
  iconOnly = true,
  triggerVariant = "ghost",
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleExport = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      await exportNoteToMarkdown(noteId, title);
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
