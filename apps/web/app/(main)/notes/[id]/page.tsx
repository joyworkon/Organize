"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TipTapEditor } from "@/components/editor/tiptap-editor";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import Link from "next/link";

export default function NoteEditorPage() {
  const params = useParams();
  const noteId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const draftRef = useRef<{ title: string; content: Record<string, unknown> | null }>({ title: "", content: null });
  const dirtyRef = useRef(false);
  const savingPromiseRef = useRef<Promise<void> | null>(null);

  // 加载笔记
  useEffect(() => {
    let active = true;
    async function loadNote() {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("id", noteId)
        .single();

      if (!active) return;
      if (!error && data) {
        const loadedTitle = data.title || "";
        const loadedContent = data.content || { type: "doc", content: [{ type: "paragraph" }] };
        setTitle(loadedTitle);
        setContent(loadedContent);
        draftRef.current = { title: loadedTitle, content: loadedContent };
      }
      setLoading(false);
    }
    void loadNote();
    return () => { active = false; };
  }, [noteId, supabase]);

  // 保存始终写入同一时刻的完整快照，并串行排空后续改动。
  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (savingPromiseRef.current) return savingPromiseRef.current;
    const promise = (async () => {
      setSaving(true);
      setSaveError("");
      while (dirtyRef.current) {
        dirtyRef.current = false;
        const snapshot = { ...draftRef.current };
        const { error } = await supabase.from("notes").update(snapshot).eq("id", noteId);
        if (error) {
          dirtyRef.current = true;
          setSaveError("保存失败，请检查网络后继续编辑");
          break;
        }
        setLastSaved(new Date());
      }
    })().finally(() => {
      setSaving(false);
      savingPromiseRef.current = null;
    });
    savingPromiseRef.current = promise;
    return promise;
  }, [noteId, supabase]);

  const queueSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushSave(), 900);
  }, [flushSave]);

  useEffect(() => {
    const handlePageHide = () => void flushSave();
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      void flushSave();
    };
  }, [flushSave]);

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    draftRef.current.title = newTitle;
    queueSave();
  };

  const handleContentUpdate = (newContent: Record<string, unknown>) => {
    setContent(newContent);
    draftRef.current.content = newContent;
    queueSave();
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
          {saveError ? (
            <span className="text-destructive">{saveError}</span>
          ) : saving ? (
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
      <TipTapEditor noteId={noteId} noteTitle={title} content={content} onUpdate={handleContentUpdate} />
    </div>
  );
}
