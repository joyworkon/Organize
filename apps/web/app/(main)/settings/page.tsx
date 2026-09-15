"use client";

import { useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { showConfirm } from "@/components/ui/prompt-dialog";
import { resetOnboarding } from "@/components/onboarding";
import { tiptapJsonToMarkdown } from "@/lib/export/tiptap-to-md";
import { createBackupV2 } from "@/lib/backup/schema";
import { fetchBackupData, pruneExportData } from "@/lib/backup/export-data";
import {
  AttachmentPackageCancelledError,
  buildAttachmentPackage,
  scanAttachmentReferences,
  type ScannedPackage,
} from "@/lib/backup/attachment-package";
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
  const [exportingAttachments, setExportingAttachments] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // B07-4：附件包依赖对象存储（Storage 下载/重放），mock 后端无 Storage
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_BACKEND === "true";

  const exportWithAttachments = async () => {
    setExportingAttachments(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const loadingToast = toast({ title: "带附件备份导出中（含附件下载）…" });

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error("未登录");
      }

      // 与「导出数据 (JSON)」同一条导出链（fetchBackupData → 剪枝 → v5），
      // 附件包是它的伴生容器（设计 §3：成对交付，恢复时两个文件一起用）
      const backupData = pruneExportData(await fetchBackupData(supabase, user.id));
      const exportObj = createBackupV2(backupData);

      const scanned: ScannedPackage = scanAttachmentReferences(backupData);
      const dateStr = formatDateForFilename(new Date());
      const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, "");

      downloadFile(
        `organize-export-${dateStr}.json`,
        JSON.stringify(exportObj, null, 2),
        "application/json;charset=utf-8"
      );

      if (scanned.files.length === 0) {
        loadingToast.dismiss();
        toast({
          title: "导出成功",
          description: "未发现本应用存储的附件，JSON 已包含全部数据（无需附件包）",
        });
        return;
      }

      const chunks: BlobPart[] = [];
      const result = await buildAttachmentPackage(
        scanned,
        (chunk) => {
          chunks.push(new Uint8Array(chunk));
        },
        { supabase, signal: controller.signal, appVersion: APP_VERSION }
      );
      const blob = new Blob(chunks, { type: "application/zip" });
      const zipUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = zipUrl;
      a.download = `organize-files-${dateStr}-${timeStr}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);

      loadingToast.dismiss();
      toast({
        title: `导出成功：${result.fileCount} 个附件（${(result.totalBytes / 1024 / 1024).toFixed(2)} MB）`,
        description: `JSON 与附件包成对使用；外链图片 ${scanned.externalUrls.length} 条未打包（依赖原站）`,
      });
    } catch (err) {
      loadingToast.dismiss();
      toast({
        title: err instanceof AttachmentPackageCancelledError ? "已取消导出" : "导出失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      abortRef.current = null;
      setExportingAttachments(false);
    }
  };

  const cancelAttachmentExport = () => {
    abortRef.current?.abort();
  };

  const exportData = async () => {
    setExportingData(true);
    const loadingToast = toast({ title: "数据导出中..." });

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error("未登录");
      }

      // B01：表清单/分页/过滤抽取到 lib/backup/export-data（与恢复演练脚本共用，
      // 消除两处查询漂移）；剪枝处理回收站行的孤儿子行与悬空引用
      const backupData = pruneExportData(await fetchBackupData(supabase, user.id));
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

        {/* D06 迁移表：插件入口收进设置页（/plugins 原页保留，侧栏入口由改版移除） */}
        <div className="p-5 border-b">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">插件管理</h2>
              <p className="text-sm text-muted-foreground mt-1">
                启用或配置内置插件（AI 摘要、标签推荐等）。
              </p>
            </div>
            <Link
              href="/plugins"
              className="shrink-0 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              打开插件
            </Link>
          </div>
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
              备份包含什么？（v5 格式清单）
            </summary>
            <div className="px-3 pb-3 space-y-2 text-xs leading-relaxed">
              <div>
                <span className="font-medium text-foreground">包含（28 张表）：</span>
                <span className="text-muted-foreground">
                  阅读条目、笔记（含层级/页面设置/版本历史/评论/建议）、任务（清单/依赖/提醒/附件元数据/动态/模板）、速记、任务↔笔记双链、标签、高亮、收藏、同步块、数据库块、倒数日、经验
                </span>
              </div>
              <div>
                <span className="font-medium text-foreground">「导出数据 (JSON + 附件包)」额外包含：</span>
                <span className="text-muted-foreground">
                  本应用存储的附件与图片文件本体（zip 附件包，与 JSON 成对恢复到新账号存储并自动改写引用）。
                  外链图片与失效外链仍不打包（依赖原站）；base64 内联内容天然自包含。
                </span>
              </div>
              <div>
                <span className="font-medium text-destructive">不包含：</span>
                <span className="text-muted-foreground">
                  登录凭据（auth）、插件配置、公开分享链接、AI 服务配置（含密钥，永不导出）；纯 JSON 导出不含附件文件本体
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
              disabled={exportingData || exportingAttachments}
              className="flex items-center gap-2"
            >
              {exportingData ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              导出数据 (JSON)
            </Button>
            {!isMockMode && (
              <Button
                onClick={() => void exportWithAttachments()}
                disabled={exportingData || exportingAttachments}
                variant="outline"
                className="flex items-center gap-2"
              >
                {exportingAttachments ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                导出数据 (JSON + 附件包)
              </Button>
            )}
            {exportingAttachments && (
              <Button variant="ghost" size="sm" onClick={cancelAttachmentExport}>
                取消附件导出
              </Button>
            )}
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
          {isMockMode && (
            <p className="text-xs text-muted-foreground mt-2">
              mock 模式无对象存储，附件包导出不可用；仅支持 JSON 元数据导出。
            </p>
          )}
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
                「导出数据」可随时带走全部数据的 JSON 副本；附件文件本体请选「JSON + 附件包」携带。
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
