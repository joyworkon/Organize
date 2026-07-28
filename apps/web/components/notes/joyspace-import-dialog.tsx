"use client";

import { useState, useMemo } from "react";
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
import { Loader2, FileDown } from "lucide-react";

interface JoyspaceImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 导入成功后回调，参数为新笔记 id。 */
  onImported: (noteId: string) => void;
}

/**
 * 「从 JoySpace 导入」对话框。
 *
 * 配合智能体辅助导入：用户让智能体用 read_joyspace 取回文档 Markdown，
 * 粘贴到这里（可选填来源链接与标题），本组件在浏览器端把 Markdown 转成
 * TipTap 文档 JSON 并作为当前登录用户的一篇新笔记写入（mock / 真实后端通用）。
 */
export function JoyspaceImportDialog({
  open,
  onOpenChange,
  onImported,
}: JoyspaceImportDialogProps) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const reset = () => {
    setSourceUrl("");
    setTitle("");
    setMarkdown("");
    setError(null);
  };

  const handleImport = async () => {
    const content = markdown.trim();
    if (!content) {
      setError("请粘贴要导入的文档内容");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const result = markdownToTiptapDoc(content, {
        sourceUrl: sourceUrl.trim() || undefined,
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录，请先登录");

      const finalTitle = title.trim() || result.title;
      const { data, error: insertError } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          title: finalTitle,
          content: result.doc,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      if (!data) throw new Error("导入失败，请重试");

      toast({
        title: "导入成功",
        description: result.truncated
          ? "文档较长，部分内容已截断，完整内容请查看原文档"
          : `已创建笔记「${finalTitle}」`,
      });
      reset();
      onOpenChange(false);
      onImported(data.id as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败，请重试");
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
            <FileDown className="h-5 w-5" />
            从 JoySpace 导入
          </DialogTitle>
          <DialogDescription>
            让智能体用 read_joyspace 取回文档内容，粘贴到下方即可转成一篇笔记。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="js-source">来源链接（可选）</Label>
            <Input
              id="js-source"
              placeholder="https://joyspace.jd.com/pages/..."
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              disabled={importing}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="js-title">标题（可选，留空则自动取首个标题）</Label>
            <Input
              id="js-title"
              placeholder="自动识别"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={importing}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="js-content">文档内容（Markdown）</Label>
            <Textarea
              id="js-content"
              placeholder="粘贴智能体取回的文档内容（Markdown 格式）…"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              disabled={importing}
              className="min-h-[220px] font-mono text-sm"
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
                导入中…
              </>
            ) : (
              "导入为笔记"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
