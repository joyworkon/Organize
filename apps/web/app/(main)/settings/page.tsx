"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { resetOnboarding } from "@/components/onboarding";
import { tiptapJsonToMarkdown } from "@/lib/export/tiptap-to-md";
import {
  Settings as SettingsIcon,
  Palette,
  Download,
  FileText,
  Info,
  HelpCircle,
  RotateCcw,
  Loader2,
} from "lucide-react";

const APP_VERSION = "0.1.0";

function formatDateForFilename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SettingsPage() {
  const supabase = createClient();
  const [exportingData, setExportingData] = useState(false);
  const [exportingMarkdown, setExportingMarkdown] = useState(false);

  const exportData = async () => {
    setExportingData(true);
    const loadingToast = toast({ title: "数据导出中..." });

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error("未登录");
      }

      const [
        readingItemsRes,
        notesRes,
        tasksRes,
        tagsRes,
        lessonsRes,
        highlightsRes,
      ] = await Promise.all([
        supabase.from("reading_items").select("*").eq("user_id", user.id),
        supabase.from("notes").select("*").eq("user_id", user.id),
        supabase.from("tasks").select("*").eq("user_id", user.id),
        supabase.from("tags").select("*").eq("user_id", user.id),
        supabase.from("lessons").select("*").eq("user_id", user.id),
        supabase.from("highlights").select("*").eq("user_id", user.id),
      ]);

      const exportObj = {
        version: 1,
        exportedAt: new Date().toISOString(),
        reading_items: readingItemsRes.data || [],
        notes: notesRes.data || [],
        tasks: tasksRes.data || [],
        tags: tagsRes.data || [],
        lessons: lessonsRes.data || [],
        highlights: highlightsRes.data || [],
      };

      const dateStr = formatDateForFilename(new Date());
      downloadFile(
        `organize-export-${dateStr}.json`,
        JSON.stringify(exportObj, null, 2),
        "application/json;charset=utf-8"
      );

      loadingToast.dismiss();
      toast({ title: "导出成功", description: "数据已导出为 JSON 文件" });
    } catch (err) {
      console.error("Export failed:", err);
      loadingToast.dismiss();
      toast({
        title: "导出失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      setExportingData(false);
    }
  };

  const exportMarkdown = async () => {
    setExportingMarkdown(true);
    const loadingToast = toast({ title: "Markdown 导出中..." });

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error("未登录");
      }

      const { data: notes, error: notesError } = await supabase
        .from("notes")
        .select("id, title, content, created_at, updated_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (notesError) throw notesError;

      const mdParts: string[] = [];
      mdParts.push(`# Organize 笔记导出\n\n导出时间: ${new Date().toLocaleString("zh-CN")}\n\n---\n`);

      for (const note of notes || []) {
        let noteContent = "";
        if (note.content && typeof note.content === "object") {
          try {
            noteContent = tiptapJsonToMarkdown(note.content, note.title || undefined);
          } catch {
            noteContent = note.title ? `# ${note.title}\n\n(内容解析失败)` : "(内容解析失败)";
          }
        } else if (note.title) {
          noteContent = `# ${note.title}\n\n(无内容)`;
        }

        if (noteContent) {
          mdParts.push(noteContent);
          mdParts.push("\n\n---\n");
        }
      }

      const dateStr = formatDateForFilename(new Date());
      downloadFile(
        `organize-notes-${dateStr}.md`,
        mdParts.join("\n"),
        "text/markdown;charset=utf-8"
      );

      loadingToast.dismiss();
      toast({ title: "导出成功", description: "笔记已导出为 Markdown 文件" });
    } catch (err) {
      console.error("Markdown export failed:", err);
      loadingToast.dismiss();
      toast({
        title: "导出失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      setExportingMarkdown(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">设置</h1>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="p-5 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Palette className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">外观</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            主题切换可在侧边栏底部操作，支持明暗模式切换和主题色自定义。
          </p>
        </div>

        <div className="p-5 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Download className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">数据管理</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            导出你的所有数据，用于备份或迁移。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={exportData}
              disabled={exportingData}
              className="flex items-center gap-2"
            >
              {exportingData ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              导出数据 (JSON)
            </Button>
            <Button
              onClick={exportMarkdown}
              disabled={exportingMarkdown}
              variant="outline"
              className="flex items-center gap-2"
            >
              {exportingMarkdown ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
             导出 Markdown
            </Button>
          </div>
        </div>

        <div className="p-5 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Info className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">关于</h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">版本</span>
              <span className="text-sm font-medium">v{APP_VERSION}</span>
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <HelpCircle className="h-4 w-4" />
              按 <kbd className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded border">?</kbd> 键查看所有快捷键
            </p>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <RotateCcw className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">其他</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            重新查看新手指引。
          </p>
          <Button
            variant="outline"
            onClick={resetOnboarding}
            className="flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            重新查看引导
          </Button>
        </div>
      </div>
    </div>
  );
}
