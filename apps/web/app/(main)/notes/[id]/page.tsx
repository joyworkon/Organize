"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TipTapEditor } from "@/components/editor/tiptap-editor";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import Link from "next/link";

export default function NoteEditorPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.id as string;
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 加载笔记
  useEffect(() => {
    async function loadNote() {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("id", noteId)
        .single();

      if (!error && data) {
        setTitle(data.title || "");
        setContent(data.content || { type: "doc", content: [{ type: "paragraph" }] });
      }
      setLoading(false);
    }
    loadNote();
  }, [noteId, supabase]);

  // 保存笔记
  const saveNote = useCallback(
    async (newTitle?: string, newContent?: Record<string, unknown>) => {
      setSaving(true);
      const { error } = await supabase
        .from("notes")
        .update({
          title: newTitle ?? title,
          content: newContent ?? content,
        })
        .eq("id", noteId);

      if (!error) {
        setLastSaved(new Date());
      }
      setSaving(false);
    },
    [noteId, title, content, supabase]
  );

  // 防抖自动保存
  const debouncedSave = useCallback(
    (newTitle?: string, newContent?: Record<string, unknown>) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveNote(newTitle, newContent);
      }, 1500);
    },
    [saveNote]
  );

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    debouncedSave(newTitle, undefined);
  };

  const handleContentUpdate = (newContent: Record<string, unknown>) => {
    setContent(newContent);
    debouncedSave(undefined, newContent);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        笔记不存在或已被删除
        <br />
        <Link href="/notes" className="text-primary underline text-sm mt-2 inline-block">
          返回笔记列表
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <Link href="/notes">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            返回
          </Button>
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              保存中...
            </>
          ) : lastSaved ? (
            <>
              <Check className="h-3 w-3 text-green-500" />
              已保存 {lastSaved.toLocaleTimeString("zh-CN")}
            </>
          ) : null}
        </div>
      </div>

      {/* 标题 */}
      <Input
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder="笔记标题"
        className="text-2xl font-bold border-none shadow-none px-0 h-auto py-2 focus-visible:ring-0"
      />

      {/* 编辑器 */}
      <TipTapEditor content={content} onUpdate={handleContentUpdate} />
    </div>
  );
}
