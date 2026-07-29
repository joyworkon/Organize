"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { resetOnboarding } from "@/components/onboarding";
import { tiptapJsonToMarkdown } from "@/lib/export/tiptap-to-md";
import {
  BACKUP_TABLES,
  BACKUP_MAX_ROWS_PER_TABLE,
  createBackupV2,
  type BackupData,
  type BackupRow,
} from "@/lib/backup/schema";
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
  const supabase = useMemo(() => createClient(), []);
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

      const tableQueries = [
        {
          table: "reading_items",
          columns:
            "id, url, title, content, excerpt, cover_image, reading_status, reading_progress, is_pinned, started_reading_at, completed_reading_at, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "notes",
          columns:
            "id, title, content, reading_item_id, is_pinned, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "tags",
          columns: "id, name, color, created_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "item_tags",
          columns: "item_id, tag_id",
          order: ["item_id", "tag_id"],
        },
        {
          table: "note_tags",
          columns: "note_id, tag_id",
          order: ["note_id", "tag_id"],
        },
        {
          table: "tasks",
          columns:
            "id, title, description, status, priority, category, due_date, estimated_minutes, actual_minutes, reading_item_id, note_id, is_pinned, sort_order, completed_at, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "task_checklists",
          columns:
            "id, task_id, content, is_completed, sort_order, created_at, updated_at",
          order: ["id"],
        },
        {
          table: "task_tags",
          columns: "task_id, tag_id",
          order: ["task_id", "tag_id"],
        },
        {
          table: "lessons",
          columns:
            "id, title, content, lesson_type, task_id, reading_item_id, note_id, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "lesson_tags",
          columns: "lesson_id, tag_id",
          order: ["lesson_id", "tag_id"],
        },
        {
          table: "highlights",
          columns:
            "id, reading_item_id, content, note, color, anchor_path, anchor_offset, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "favorites",
          columns: "id, target_type, target_id, note, created_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "note_versions",
          columns: "id, note_id, content, title, message, created_at",
          order: ["id"],
        },
        {
          table: "note_comment_threads",
          columns: "id, note_id, block_id, resolved_at, created_at, updated_at",
          order: ["id"],
        },
        {
          table: "note_comments",
          columns: "id, thread_id, body, created_at, updated_at",
          order: ["id"],
        },
        {
          table: "note_suggestions",
          columns:
            "id, note_id, block_id, original_block, proposed_block, status, created_at, updated_at",
          order: ["id"],
        },
      ] as const;

      const pageSize = 500;
      const results = await Promise.all(
        tableQueries.map(async (config) => {
          const rows: BackupRow[] = [];
          for (let offset = 0; ; offset += pageSize) {
            let query = supabase.from(config.table).select(config.columns);
            if ("userOwned" in config && config.userOwned) {
              query = query.eq("user_id", user.id);
            }
            for (const field of config.order) {
              query = query.order(field, { ascending: true });
            }

            const result = await query.range(offset, offset + pageSize - 1);
            if (result.error) {
              throw new Error(`${config.table} 导出失败: ${result.error.message}`);
            }
            const page = (result.data ?? []) as unknown as BackupRow[];
            rows.push(...page);
            if (rows.length > BACKUP_MAX_ROWS_PER_TABLE) {
              throw new Error(
                `${config.table} 超过 ${BACKUP_MAX_ROWS_PER_TABLE} 条，无法生成安全备份`
              );
            }
            if (page.length < pageSize) break;
          }
          return rows;
        })
      );

      if (
        tableQueries.some((config, index) => config.table !== BACKUP_TABLES[index])
      ) {
        throw new Error("备份表顺序与格式合同不一致");
      }

      const backupData = Object.fromEntries(
        BACKUP_TABLES.map((table, index) => [table, results[index]])
      ) as unknown as BackupData;
      const exportObj = createBackupV2(backupData);

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
