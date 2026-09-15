"use client";

// P0-04：设置页「从备份恢复」入口。
// 流程：选择 JSON 文件 → 客户端 inspect 预检（版本/行数/问题清单）→ 二次确认
// （明示整体替换语义与排除项）→ POST /api/backup/restore → 逐表结果报告。
// B07-4：可选第二输入「附件包」（.zip，与 JSON 成对导出的 organize-files-*.zip）——
// 浏览器内完成安全解包校验 + Storage 重放（用户会话，只写自己 bucket），
// 重映射随请求交服务端重写载荷（fail-closed 校验）；缺文件/上传失败进 missing
// 清单不阻断。mock 后端无 Storage，整个附件恢复区隐藏（B07-2/3 明示合同）。
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { inspectBackupV2, BACKUP_TABLES, type BackupV2, type BackupIssue } from "@/lib/backup/schema";
import {
  AttachmentRestoreError,
  restoreAttachmentPackage,
  serializeAttachmentMapping,
  type AttachmentMappingWire,
} from "@/lib/backup/attachment-restore";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Upload, CheckCircle2, AlertTriangle, PackageOpen } from "lucide-react";

interface RestoreReport {
  counts: Record<string, number>;
  attachments?: {
    migrated: { files: number; bytes: number };
    missing: Array<{ file_key: string; old_urls: string[]; reason: string }>;
    externalUrlCount: number;
    inlineBase64Count: number;
  };
}

const isMockMode = process.env.NEXT_PUBLIC_MOCK_BACKEND === "true";

export function RestoreSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const packageRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const [pending, setPending] = useState<BackupV2 | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const [issues, setIssues] = useState<BackupIssue[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);

  const pickFile = async (file: File | undefined) => {
    setPending(null);
    setIssues([]);
    setReport(null);
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const inspection = inspectBackupV2(parsed);
      if (!inspection.ok) {
        setIssues(inspection.issues);
        toast({ title: "备份校验未通过", description: `${inspection.issues.length} 个问题，见下方清单`, variant: "destructive" });
        return;
      }
      setPending(inspection.backup);
      setPendingName(file.name);
    } catch {
      toast({ title: "文件不是有效 JSON", variant: "destructive" });
    }
  };

  const pickPackage = (file: File | undefined) => {
    setReport(null);
    if (!file) {
      setPackageFile(null);
      return;
    }
    if (!file.name.endsWith(".zip")) {
      toast({ title: "附件包需为 .zip 文件（与 JSON 成对导出）", variant: "destructive" });
      return;
    }
    setPackageFile(file);
  };

  const doRestore = async () => {
    if (!pending) return;
    setRestoring(true);
    let attachmentsWire: AttachmentMappingWire | undefined;
    try {
      // B07-4：附件包先行（设计 §5 顺序「先文件后 JSON」）——浏览器内安全解包
      // 校验 + Storage 重放，全部通过才进入载荷恢复
      if (packageFile) {
        setReplaying(true);
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new AttachmentRestoreError("未登录");
          const zipBytes = new Uint8Array(await packageFile.arrayBuffer());
          const mapping = await restoreAttachmentPackage(zipBytes, {
            supabase,
            userId: user.id,
          });
          attachmentsWire = serializeAttachmentMapping(mapping);
          if (mapping.missing.length > 0) {
            toast({
              title: `附件包：${mapping.migrated.files} 个已迁移，${mapping.missing.length} 个缺失/失败`,
              description: "缺失项在恢复后以失效引用呈现，清单见完成报告",
            });
          }
        } finally {
          setReplaying(false);
        }
      }

      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          attachmentsWire ? { backup: pending, attachments: attachmentsWire } : pending
        ),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          res.status === 409
            ? "目标账户非空：恢复是整体替换语义，请先清空当前账户数据"
            : data?.error || "恢复失败，未写入任何数据";
        toast({ title: message, variant: "destructive" });
        return;
      }
      setReport({
        counts: (data?.counts ?? {}) as Record<string, number>,
        attachments: attachmentsWire
          ? {
              migrated: attachmentsWire.migrated,
              missing: attachmentsWire.missing,
              externalUrlCount: attachmentsWire.externalUrlCount,
              inlineBase64Count: attachmentsWire.inlineBase64Count,
            }
          : undefined,
      });
      setPending(null);
      setPackageFile(null);
      toast({ title: "恢复完成", description: "页面即将刷新以加载恢复的数据" });
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      toast({
        title: "附件包校验未通过或恢复请求失败",
        description: "包损坏/校验失败时未写入任何数据",
        variant: "destructive",
      });
    } finally {
      setRestoring(false);
    }
  };

  const nonzeroCounts = pending
    ? BACKUP_TABLES.filter((table) => (pending.data[table]?.length ?? 0) > 0)
    : [];

  return (
    <div className="mt-5 border-t pt-4">
      <div className="flex items-center gap-2 mb-2">
        <Upload className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">从备份恢复</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        选择此前导出的 JSON 备份；如有配套的附件包（organize-files-*.zip）一并选择，
        附件会重放到当前账户的存储并自动改写引用。恢复会先做完整校验（预检），并<b>整体写入当前账户</b>——
        仅允许恢复到空账户；内部链接与任务绑定会在恢复时重建。
        {!isMockMode && " 附件包在正式恢复前完成逐文件校验，任何损坏都不会写入数据。"}
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="选择 JSON 备份文件"
        onChange={(e) => void pickFile(e.target.files?.[0])}
      />
      <input
        ref={packageRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        aria-label="选择附件包 zip 文件（可选）"
        onChange={(e) => pickPackage(e.target.files?.[0])}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => fileRef.current?.click()}
          disabled={restoring}
        >
          <Upload className="h-4 w-4" />
          选择备份文件
        </Button>
        {!isMockMode && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => packageRef.current?.click()}
            disabled={restoring}
          >
            <PackageOpen className="h-4 w-4" />
            {packageFile ? `附件包：${packageFile.name}` : "选择附件包（可选）"}
          </Button>
        )}
      </div>
      {isMockMode && (
        <p className="text-xs text-muted-foreground mt-2">
          mock 模式无对象存储，附件包恢复不可用；仅支持 JSON 元数据恢复。
        </p>
      )}

      {issues.length > 0 && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1 max-h-40 overflow-y-auto">
          <div className="flex items-center gap-1.5 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> 校验未通过（{issues.length} 项）
          </div>
          {issues.slice(0, 20).map((entry, index) => (
            <div key={index} className="text-muted-foreground">
              <code className="text-[11px]">{entry.path}</code> · {entry.message}
            </div>
          ))}
          {issues.length > 20 && <div className="text-muted-foreground">…共 {issues.length} 项</div>}
        </div>
      )}

      {pending && (
        <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs space-y-2">
          <div className="font-medium">
            预检通过：{pendingName}（格式 v{pending.version}，导出于{" "}
            {new Date(pending.exportedAt).toLocaleString("zh-CN")}）
          </div>
          <div className="text-muted-foreground">
            将恢复 {nonzeroCounts.length} 类数据：
            {nonzeroCounts
              .map((table) => `${table}×${pending.data[table].length}`)
              .join("、")}
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => void doRestore()} disabled={restoring} className="gap-1.5">
              {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {restoring && replaying
                ? "附件重放中…"
                : restoring && packageFile
                  ? "恢复中…"
                  : packageFile
                    ? "确认恢复（含附件包）"
                    : "确认恢复"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setPending(null); setPackageFile(null); }} disabled={restoring}>
              取消
            </Button>
          </div>
        </div>
      )}

      {report && (
        <div className="mt-3 rounded-md border border-green-500/40 bg-green-500/5 p-3 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> 恢复成功
          </div>
          <div className="text-muted-foreground">
            {Object.entries(report.counts)
              .filter(([, count]) => count > 0)
              .map(([table, count]) => `${table}×${count}`)
              .join("、") || "空备份"}
          </div>
          {report.attachments && (
            <div className="text-muted-foreground space-y-0.5">
              <div>
                附件包：迁移 {report.attachments.migrated.files} 个文件（
                {(report.attachments.migrated.bytes / 1024 / 1024).toFixed(2)} MB）
                ；外链图片 {report.attachments.externalUrlCount} 条未打包（依赖原站）；
                base64 内联 {report.attachments.inlineBase64Count} 处（自包含）
              </div>
              {report.attachments.missing.length > 0 && (
                <div className="text-amber-600 dark:text-amber-400">
                  缺失 {report.attachments.missing.length} 个附件（原样保留为失效引用）：
                  {report.attachments.missing
                    .slice(0, 5)
                    .map((entry) => entry.file_key)
                    .join("、")}
                  {report.attachments.missing.length > 5 && " …"}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
