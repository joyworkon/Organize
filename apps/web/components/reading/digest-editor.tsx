"use client";

// 整理稿编辑器（阶段 4）：标题 + 迷你标记正文（## 标题、- 列表、1. 步骤、| 表格 |）。
// 保存只写整理稿自身（reading_item），绝不改动任何来源资料；
// HTML ↔ 迷你标记的转换见 lib/collections/digest-editable.ts（表格等富结构不丢失）。
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { editableTextToHtml, htmlToEditableText } from "@/lib/collections/digest-editable";

export function DigestEditor({
  itemId,
  initialTitle,
  initialHtml,
  onSaved,
  onCancel,
}: {
  itemId: string;
  initialTitle: string;
  initialHtml: string;
  onSaved: (title: string, contentHtml: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(() => htmlToEditableText(initialHtml));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) {
      toast({ title: "标题不能为空", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const contentHtml = editableTextToHtml(text);
      const { error } = await supabase
        .from("reading_items")
        .update({ title: title.trim().slice(0, 200), content: contentHtml })
        .eq("id", itemId);
      if (error) {
        toast({ title: `保存失败：${error.message}`, variant: "destructive" });
        return;
      }
      toast({ title: "整理稿已保存（来源资料不受影响）" });
      onSaved(title.trim(), contentHtml);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" aria-label="整理稿编辑器">
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        aria-label="整理稿标题"
        maxLength={200}
        className="text-lg font-semibold"
      />
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="整理稿正文（支持 ## 标题、- 列表、1. 步骤、| 表格 |）"
        rows={20}
        className="w-full rounded-lg border bg-card p-4 font-mono text-sm leading-relaxed outline-none focus:ring-1 focus:ring-primary"
      />
      <p className="text-xs text-muted-foreground">
        语法：## 小节标题；- 要点；1. 步骤；| 表格 |（首行为表头）。保存只更新整理稿本身。
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>取消</Button>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          保存整理稿
        </Button>
      </div>
    </div>
  );
}
