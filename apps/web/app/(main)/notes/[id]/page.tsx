"use client";

import { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { TipTapEditor } from "@/components/editor/tiptap-editor";
import { NotePageMenu, type NoteFont } from "@/components/notes/note-page-menu";
import { Backlinks } from "@/components/notes/backlinks";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ArrowLeft, Loader2, Check, FileText, Calendar } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FavoriteButton } from "@/components/favorite-button";

// 页面级展示偏好按单篇笔记持久化（当前用 localStorage；接真实后端后可换成 notes 表的页面设置字段）。
const fullWidthKey = (id: string) => `organize:note:${id}:fullWidth`;
const fontKey = (id: string) => `organize:note:${id}:font`;
const smallFontKey = (id: string) => `organize:note:${id}:smallFont`;

export default function NoteEditorPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState<Record<string, unknown> | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [readingItemId, setReadingItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [fullWidth, setFullWidth] = useState(false);
  const [font, setFont] = useState<NoteFont>("default");
  const [smallFont, setSmallFont] = useState(false);
  // 轻量内联提示（拷贝链接/内容成功等），不依赖全局 Toast。
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const draftRef = useRef<{ title: string; content: Record<string, unknown> | null }>({ title: "", content: null });
  const dirtyRef = useRef(false);
  const savingPromiseRef = useRef<Promise<void> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

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
        setCreatedAt(data.created_at || null);
        setReadingItemId(data.reading_item_id || null);
        draftRef.current = { title: loadedTitle, content: loadedContent };
      }
      setLoading(false);
    }
    void loadNote();
    return () => { active = false; };
  }, [noteId, supabase]);

  // 读取该笔记的页面级展示偏好（全宽 / 字体 / 小字号）
  useEffect(() => {
    try {
      setFullWidth(localStorage.getItem(fullWidthKey(noteId)) === "1");
      const savedFont = localStorage.getItem(fontKey(noteId));
      if (savedFont === "serif" || savedFont === "mono" || savedFont === "default") {
        setFont(savedFont);
      }
      setSmallFont(localStorage.getItem(smallFontKey(noteId)) === "1");
    } catch {
      /* localStorage 不可用时用默认展示偏好 */
    }
  }, [noteId]);

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

  // 标题始终是不含换行的单字符串（T3）：把粘贴进来的换行折叠成空格。
  const handleTitleChange = (raw: string) => {
    const newTitle = raw.replace(/\s*\n\s*/g, " ");
    setTitle(newTitle);
    draftRef.current.title = newTitle;
    queueSave();
  };

  // 标题自动增高：支持超长标题换行、随内容增高（T3）。
  const autoGrowTitle = useCallback(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    autoGrowTitle();
  }, [title, fullWidth, loading, autoGrowTitle]);

  // T1/T2：在标题里按回车，把拆分点之后的文字迁移到正文顶部的新段落。
  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    // 输入法组合态下回车只是确认候选词，不触发拆分。
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();

    const el = event.currentTarget;
    // 选区起点作为拆分点：选中内容连同其后文字一并进入正文（不静默丢字）。
    const splitAt = el.selectionStart ?? title.length;
    const before = title.slice(0, splitAt);
    const after = title.slice(splitAt);

    setTitle(before);
    draftRef.current.title = before;

    const editor = editorRef.current;
    if (editor) {
      const first = editor.state.doc.firstChild;
      const firstIsEmptyParagraph = first?.type.name === "paragraph" && first.content.size === 0;
      if (after.length === 0 && firstIsEmptyParagraph) {
        // 正文顶部已是可直接进入的空段落，复用它，避免堆叠多个空块。
        editor.chain().focus("start").run();
      } else {
        // 在正文最前面插入新段落，旧内容整体顺延；光标落在迁移文字末尾。
        editor
          .chain()
          .insertContentAt(0, {
            type: "paragraph",
            content: after ? [{ type: "text", text: after }] : [],
          })
          .setTextSelection(1 + after.length)
          .focus()
          .run();
      }
    }

    queueSave();
  };

  const toggleFullWidth = () => {
    const next = !fullWidth;
    setFullWidth(next);
    try {
      localStorage.setItem(fullWidthKey(noteId), next ? "1" : "0");
    } catch {
      /* 忽略：无法持久化时仍保留本次会话内的切换效果 */
    }
  };

  const changeFont = (next: NoteFont) => {
    setFont(next);
    try {
      localStorage.setItem(fontKey(noteId), next);
    } catch {
      /* 忽略持久化失败 */
    }
  };

  const toggleSmallFont = () => {
    const next = !smallFont;
    setSmallFont(next);
    try {
      localStorage.setItem(smallFontKey(noteId), next ? "1" : "0");
    } catch {
      /* 忽略持久化失败 */
    }
  };

  // 轻量内联提示：显示一条短消息，2 秒后自动消失。
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("已复制链接");
    } catch {
      showToast("复制失败，请手动复制地址栏链接");
    }
  }, [showToast]);

  const copyContent = useCallback(async () => {
    // 标题 + 正文纯文本；正文取自编辑器实例的 getText（保留段落换行）。
    const bodyText = editorRef.current?.getText({ blockSeparator: "\n\n" }) ?? "";
    const full = [title.trim(), bodyText.trim()].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(full);
      showToast("已复制页面内容");
    } catch {
      showToast("复制失败");
    }
  }, [title, showToast]);

  const duplicateNote = useCallback(async () => {
    // 创建副本前先把当前改动落库，保证副本拿到最新内容。
    await flushSave();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        showToast("未登录，无法创建副本");
        return;
      }
      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          title: title ? `${title} 副本` : "无标题笔记 副本",
          content: draftRef.current.content ?? content,
        })
        .select()
        .single();
      if (error || !data) {
        showToast("创建副本失败");
        return;
      }
      // 软导航到副本，保住 mock 后端的内存数据。
      router.push(`/notes/${data.id}`);
    } catch {
      showToast("创建副本失败");
    }
  }, [flushSave, supabase, title, content, router, showToast]);

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
      <EmptyState
        icon={FileText}
        title="笔记不存在"
        description="笔记可能已被删除或链接无效"
        action={
          <Link href="/notes">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回笔记列表
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div
      className={cn(
        "note-page mx-auto space-y-4",
        fullWidth ? "max-w-none md:px-10" : "max-w-3xl",
        font === "serif" && "note-page-serif",
        font === "mono" && "note-page-mono",
        smallFont && "note-page-small"
      )}
    >
      {/* 面包屑 */}
      <Breadcrumb className="pt-2">
        <BreadcrumbList>
          <BreadcrumbItem className="hidden sm:inline-flex">
            <BreadcrumbLink href="/">首页</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden sm:block" />
          <BreadcrumbItem>
            <BreadcrumbLink href="/notes">笔记</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage
              className="max-w-[20ch] sm:max-w-[40ch]"
              title={title || undefined}
            >
              {title || "无标题笔记"}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <Link href="/notes">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            返回
          </Button>
        </Link>
        <div className="flex items-center gap-3">
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
          <FavoriteButton targetType="note" targetId={noteId} />
          <NotePageMenu
            fullWidth={fullWidth}
            onToggleFullWidth={toggleFullWidth}
            font={font}
            onFontChange={changeFont}
            smallFont={smallFont}
            onToggleSmallFont={toggleSmallFont}
            onCopyLink={copyLink}
            onCopyContent={copyContent}
            onDuplicate={duplicateNote}
          />
        </div>
      </div>

      {/* 标题：自动增高、不限长度；回车执行 T1/T2 而非插入换行 */}
      <textarea
        ref={titleRef}
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        onKeyDown={handleTitleKeyDown}
        onInput={autoGrowTitle}
        placeholder="笔记标题"
        rows={1}
        className="note-title w-full resize-none overflow-hidden break-words bg-transparent px-0 py-2 text-2xl font-bold leading-tight outline-none placeholder:text-muted-foreground"
      />

      {/* 创建时间 */}
      {createdAt && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground -mt-2">
          <Calendar className="h-3 w-3" />
          创建于 {new Date(createdAt).toLocaleDateString("zh-CN")}
        </div>
      )}

      {/* 编辑器 */}
      <TipTapEditor
        noteId={noteId}
        noteTitle={title}
        content={content}
        onUpdate={handleContentUpdate}
        onEditorReady={(editor) => { editorRef.current = editor; }}
      />

      {/* 反向链接 & 关联阅读 */}
      <Backlinks noteId={noteId} readingItemId={readingItemId} />

      {/* 轻量内联提示 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
