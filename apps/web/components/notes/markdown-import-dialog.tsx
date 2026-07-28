"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { markdownToTiptapDoc } from "@/lib/import/markdown-to-tiptap";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Upload, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

type ImportMode = "paste" | "upload";

interface MarkdownImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (noteId: string) => void;
}

export function MarkdownImportDialog({
  open,
  onOpenChange,
  onImported,
}: MarkdownImportDialogProps) {
  const [mode, setMode] = useState<ImportMode>("paste");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  const reset = () => {
    setMode("paste");
    setTitle("");
    setMarkdown("");
    setFileName("");
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(md|markdown)$/i) && file.type !== "text/markdown") {
      setError("请选择 .md 或 .markdown 文件");
      return;
    }

    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setMarkdown(content);
      setMode("paste");
    };
    reader.onerror = () => {
      setError("读取文件失败，请重试");
    };
    reader.readAsText(file);
  };

  const fallbackPlainTextDoc = (text: string) => {
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
    if (paragraphs.length === 0) {
      return { type: "doc", content: [{ type: "paragraph" }] };
    }
    return {
      type: "doc",
      content: paragraphs.map((p) => ({
        type: "paragraph",
        content: p.split("\n").flatMap((line, i) => [
          ...(i > 0 ? [{ type: "hardBreak" }] : []),
          { type: "text", text: line },
        ]),
      })),
    };
  };

  const extractTitleFromMarkdown = (md: string): string => {
    const match = md.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim().slice(0, 120);
    const firstLine = md.split("\n").find((l) => l.trim());
    if (firstLine) return firstLine.trim().slice(0, 60);
    return "导入笔记";
  };

  const handleImport = async () => {
    const content = markdown.trim();
    if (!content) {
      setError("请粘贴 Markdown 文本或选择文件");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      let doc: Record<string, unknown>;
      let autoTitle: string;
      let truncated = false;

      try {
        const result = markdownToTiptapDoc(content);
        doc = result.doc;
        autoTitle = result.title;
        truncated = result.truncated;
      } catch (convertErr) {
        console.warn("Markdown 转换失败，降级为纯文本导入:", convertErr);
        doc = fallbackPlainTextDoc(content);
        autoTitle = extractTitleFromMarkdown(content);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录，请先登录");

      const finalTitle = title.trim() || autoTitle;
      const { data, error: insertError } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          title: finalTitle,
          content: doc,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      if (!data) throw new Error("导入失败，请重试");

      toast({
        title: "笔记已导入",
        description: truncated
          ? "文档较长，部分内容已截断"
          : `已创建笔记「${finalTitle}」`,
      });
      reset();
      onOpenChange(false);
      onImported(data.id as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
      toast({ title: "导入失败", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!importing) {
          if (!next) reset();
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            导入 Markdown
          </DialogTitle>
          <DialogDescription>
            粘贴 Markdown 文本或上传 .md 文件，将创建新笔记
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex rounded-lg border p-1 bg-muted/30 gap-1">
            <button
              type="button"
              onClick={() => setMode("paste")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                mode === "paste"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              disabled={importing}
            >
              <FileText className="h-4 w-4" />
              粘贴文本
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("upload");
                fileInputRef.current?.click();
              }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                mode === "upload"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              disabled={importing}
            >
              <Upload className="h-4 w-4" />
              上传文件
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,text/markdown"
            onChange={handleFileSelect}
            className="hidden"
            disabled={importing}
          />

          {fileName && mode === "paste" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
              <FileText className="h-4 w-4" />
              <span>已选择文件：{fileName}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="md-title">笔记标题（可选）</Label>
            <Input
              id="md-title"
              placeholder="留空则自动取 Markdown 第一个 # 标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={importing}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="md-content">Markdown 内容</Label>
            <Textarea
              id="md-content"
              placeholder="在此粘贴 Markdown 文本..."
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              disabled={importing}
              className="min-h-[260px] font-mono text-sm resize-y"
              rows={10}
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={importing}
          >
            取消
          </Button>
          <Button onClick={handleImport} disabled={importing || !markdown.trim()}>
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                导入中...
              </>
            ) : (
              "导入"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
