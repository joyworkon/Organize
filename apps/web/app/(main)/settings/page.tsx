"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { showConfirm } from "@/components/ui/prompt-dialog";
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
  ShieldAlert,
} from "lucide-react";
import { AISettingsSection } from "@/components/settings/ai-settings";
import { RestoreSection } from "@/components/settings/restore-section";
import { NotchTriggerSetting } from "@/components/settings/notch-trigger-setting";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeColorPicker } from "@/components/theme-color-picker";

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
  const [deletingAccount, setDeletingAccount] = useState(false);
  const router = useRouter();
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
            "id, url, title, content, excerpt, cover_image, reading_status, reading_progress, is_pinned, full_width, started_reading_at, completed_reading_at, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "notes",
          columns:
            "id, title, content, reading_item_id, icon, cover_url, cover_position, parent_note_id, full_width, font_family, small_font, is_pinned, last_edit_by, created_at, updated_at",
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
            "id, title, description, status, priority, category, due_date, estimated_minutes, actual_minutes, reading_item_id, note_id, parent_task_id, is_pinned, sort_order, completed_at, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "task_dependencies",
          columns: "task_id, depends_on_task_id, created_at",
          userOwned: true,
          order: ["task_id", "depends_on_task_id"],
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
            "id, reading_item_id, content, note, color, anchor_path, anchor_offset, note_id, task_id, created_at, updated_at",
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
        {
          table: "synced_blocks",
          columns: "id, content, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "db_databases",
          columns:
            "id, parent_note_id, title, icon, schema, views, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "db_rows",
          columns: "id, database_id, sort, values, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "task_lists",
          columns: "id, name, icon, color, sort_order, is_default, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "task_reminders",
          columns: "id, task_id, anchor, offset_minutes, notified_at, created_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "task_attachments",
          columns: "id, task_id, name, bucket, path, mime_type, size_bytes, created_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "task_activities",
          columns: "id, task_id, action, detail, created_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "task_templates",
          columns: "id, name, template, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "countdown_days",
          columns: "id, title, target_date, repeat_annually, deleted_at, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "memos",
          columns: "id, content, tags, deleted_at, created_at, updated_at",
          userOwned: true,
          order: ["id"],
        },
        {
          table: "task_item_refs",
          columns: "id, task_id, note_id, block_id, created_at",
          userOwned: true,
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

  const handleDeleteAccount = async () => {
    const confirmed = await showConfirm({
      title: "永久删除账号？",
      description:
        "你的全部数据（稍后读、笔记、任务、速记、高亮、清单等）将随账号立即物理删除，不可恢复。此操作无法撤销。",
      confirmText: "永久删除我的账号",
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingAccount(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast({
          title: body?.error || "账号删除失败，请稍后重试",
          variant: "destructive",
        });
        return;
      }
      await supabase.auth.signOut();
      router.push("/login");
    } catch {
      toast({ title: "账号删除请求失败，请稍后重试", variant: "destructive" });
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <PageHeader icon={SettingsIcon} title="设置" />

      <div className="rounded-lg border bg-card">
        <div className="p-5 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Palette className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">外观</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            选择主题色，明暗模式可在侧边栏底部切换。
          </p>
          <ThemeColorPicker />
        </div>

        <AISettingsSection />

        <NotchTriggerSetting />

        <div className="p-5 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Download className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">数据管理</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            导出你的所有数据，用于备份或迁移。
          </p>
          {/* P0-04：包含/排除清单——不打包的东西必须明说，禁止「成功但丢数据」 */}
          <details className="mb-4 rounded-md border bg-muted/30 text-sm">
            <summary className="cursor-pointer select-none px-3 py-2 text-muted-foreground">
              备份包含什么？（v4 格式清单）
            </summary>
            <div className="px-3 pb-3 space-y-2 text-xs leading-relaxed">
              <div>
                <span className="font-medium text-foreground">包含（28 张表）：</span>
                <span className="text-muted-foreground">
                  阅读条目、笔记（含层级/页面设置/版本历史/评论/建议）、任务（清单/依赖/提醒/附件元数据/动态/模板）、速记、任务↔笔记双链、标签、高亮、收藏、同步块、数据库块、倒数日、经验
                </span>
              </div>
              <div>
                <span className="font-medium text-destructive">不包含：</span>
                <span className="text-muted-foreground">
                  附件与图片的<strong>文件本体</strong>（仅恢复元数据，文件需另行保管）、登录凭据（auth）、插件配置、公开分享链接、AI 服务配置（含密钥，永不导出）
                </span>
              </div>
              <div className="text-muted-foreground">
                恢复为「整体替换」语义：只允许恢复到空账户，ID 全部重新生成并重建内部链接与任务绑定。
              </div>
            </div>
          </details>
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
          <RestoreSection />
        </div>

        <div className="p-5 border-b border-destructive/30">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <h2 className="text-lg font-semibold">账号与数据</h2>
          </div>
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">隐私说明</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                你的数据仅存于你自己的账户空间（行级隔离），不会与其他用户共享。
                「导出数据」可随时带走全部数据的 JSON 副本；附件与图片文件本体不在备份内。
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-destructive">删除账号</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                永久删除账号及全部数据，立即生效且不可恢复。建议先「导出数据」留底。
              </p>
              <Button
                variant="destructive"
                size="sm"
                className="mt-2 flex items-center gap-2"
                onClick={() => void handleDeleteAccount()}
                disabled={deletingAccount}
              >
                {deletingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                永久删除我的账号
              </Button>
            </div>
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
