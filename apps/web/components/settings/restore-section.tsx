"use client";

// P0-04：设置页「从备份恢复」入口。
// 流程：选择 JSON 文件 → 客户端 inspect 预检（版本/行数/问题清单）→ 二次确认
// （明示整体替换语义与排除项）→ POST /api/backup/restore → 逐表结果报告。
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { inspectBackupV2, BACKUP_TABLES, type BackupV2, type BackupIssue } from "@/lib/backup/schema";
import { toast } from "@/hooks/use-toast";
import { Loader2, Upload, CheckCircle2, AlertTriangle } from "lucide-react";

interface RestoreReport {
  counts: Record<string, number>;
}

export function RestoreSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<BackupV2 | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [issues, setIssues] = useState<BackupIssue[]>([]);
  const [restoring, setRestoring] = useState(false);
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

  const doRestore = async () => {
    if (!pending) return;
    setRestoring(true);
    try {
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
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
      setReport({ counts: (data?.counts ?? {}) as Record<string, number> });
      setPending(null);
      toast({ title: "恢复完成", description: "页面即将刷新以加载恢复的数据" });
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      toast({ title: "恢复请求失败", variant: "destructive" });
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
        选择此前导出的 JSON 备份。恢复会先做完整校验（预检），并<b>整体写入当前账户</b>——
        仅允许恢复到空账户；内部链接与任务绑定会在恢复时重建。附件与图片的文件本体不在备份内。
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void pickFile(e.target.files?.[0])}
      />
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
              确认恢复
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={restoring}>
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
        </div>
      )}
    </div>
  );
}
