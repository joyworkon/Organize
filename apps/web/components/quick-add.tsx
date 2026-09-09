"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Link2, FileText, Feather, ListTodo, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { createNewNote, describeCreateNoteResult } from "@/lib/notes/create-note";
import { createQuickTask } from "@/lib/tasks/quick-create";
import { quickAddDueDate } from "@/lib/tasks/workspace";
import { enqueueMemoCreate, makeMemoCreateOp } from "@/lib/offline/memo-queue";
import { loadMemoDraft, saveMemoDraft, clearMemoDraft } from "@/lib/memos/draft";
import { emitDataChanged } from "@/lib/desktop/notch";
import { collectReadingItem, collectResultToast } from "@/lib/reading/collect";
import { isImeComposing } from "@/lib/input/submit-guard";
import { isOnline } from "@/lib/offline/network";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { toast } from "@/hooks/use-toast";

const options = [
  { mode: "memo", label: "速记", description: "随手记下一个想法", icon: Feather },
  { mode: "url", label: "保存链接", description: "收藏文章，留待慢慢阅读", icon: Link2 },
  { mode: "task", label: "添加待办", description: "把想做的事变成下一步", icon: ListTodo },
  { mode: "note", label: "新建笔记", description: "展开思考，整理成一篇笔记", icon: FileText },
] as const;
type EntryMode = (typeof options)[number]["mode"];
type QuickAddMode = "menu" | EntryMode;
const emptyDrafts = { url: "", memo: "", task: "", note: "" };

export function QuickAdd() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<QuickAddMode>("menu");
  const [drafts, setDrafts] = useState(emptyDrafts);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const userIdRef = useRef<string | null>(null);
  const taskContext = useRef<{ listId: string | null; dueDate: string | null }>({ listId: null, dueDate: null });
  const [taskHint, setTaskHint] = useState("");

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active || !session?.user) return;
      userIdRef.current = session.user.id;
      setDrafts((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value || loadMemoDraft(localStorage, session.user.id, `quick-add:${key}`)])) as typeof emptyDrafts);
    });
    return () => { active = false; };
  }, [supabase]);

  const openPanel = useCallback((nextMode: QuickAddMode = "menu") => {
    if (submittingRef.current) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const inTasks = pathname === "/tasks" || pathname.startsWith("/tasks/");
    const scope = inTasks ? params.get("scope") : null;
    taskContext.current = {
      listId: scope === "list" ? params.get("list") : null,
      dueDate: quickAddDueDate(scope === "today" || scope === "upcoming" ? scope : "all"),
    };
    setTaskHint(scope === "list" ? "将添加到当前清单" : scope === "today" || scope === "upcoming" ? "将安排在今天" : "将添加到全部任务");
    setMode(nextMode);
    setOpen(true);
  }, [pathname, params]);

  const createNote = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await createNewNote(supabase);
      if (result.status === "unauthenticated" || result.status === "failed") {
        toast({ title: describeCreateNoteResult(result), variant: "destructive" });
        return;
      }
      if (result.status === "queued") toast({ title: describeCreateNoteResult(result) });
      setOpen(false);
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      router.push(`/notes/${result.noteId}`);
    } catch { toast({ title: "创建失败，请重试", variant: "destructive" }); }
    finally { submittingRef.current = false; setIsSubmitting(false); }
  }, [supabase, router]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const requested = (event as CustomEvent<{ mode?: QuickAddMode }>).detail?.mode;
      if (requested === "note") { void createNote(); return; }
      openPanel(requested && options.some((entry) => entry.mode === requested) ? requested : "menu");
    };
    const handleQuickSave = () => openPanel();
    const handleShare = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text || "";
      const url = text.match(/https?:\/\/[^\s"'）)]+/i)?.[0];
      if (!url || submittingRef.current) return;
      setDrafts((previous) => ({ ...previous, url }));
      openPanel("url");
    };
    window.addEventListener("organize:quick-add", handleOpen);
    window.addEventListener("organize:quick-save", handleQuickSave);
    window.addEventListener("organize:share-prefill", handleShare);
    return () => {
      window.removeEventListener("organize:quick-add", handleOpen);
      window.removeEventListener("organize:quick-save", handleQuickSave);
      window.removeEventListener("organize:share-prefill", handleShare);
    };
  }, [openPanel, createNote]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      const element = document.activeElement;
      const editing = element instanceof HTMLElement && (element.isContentEditable || element.matches("input, textarea"));
      if ((event.metaKey || event.ctrlKey) && event.key === "n" && !editing) {
        event.preventDefault();
        if (!submittingRef.current) { if (open) setOpen(false); else openPanel(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, openPanel]);

  const updateDraft = (value: string) => {
    if (mode === "menu") return;
    setDrafts((previous) => ({ ...previous, [mode]: value }));
    if (userIdRef.current) saveMemoDraft(localStorage, userIdRef.current, `quick-add:${mode}`, value);
  };

  const submit = async () => {
    if (mode === "menu" || mode === "note" || submittingRef.current) return;
    const text = drafts[mode].trim();
    if (!text || (mode === "memo" && text.length > 5000)) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      if (mode === "url") {
        const result = await collectReadingItem(text);
        toast(collectResultToast(result));
        if (result.status === "error") return;
      } else if (mode === "task") {
        const result = await createQuickTask(supabase, { title: text, ...taskContext.current });
        if (result.status === "unauthenticated" || result.status === "failed" || (result.status === "queued" && result.persisted === false)) {
          toast({ title: result.status === "unauthenticated" ? "请先登录" : result.status === "failed" ? result.message : "本地存储不可用，请保留输入并重试", variant: "destructive" });
          return;
        }
        toast({ title: result.status === "queued" ? "已离线创建，联网后自动同步" : "已添加待办" });
        window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
        void emitDataChanged({ topic: "tasks", origin: "main" });
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { toast({ title: "请先登录", variant: "destructive" }); return; }
        const op = makeMemoCreateOp(text);
        let queued = !isOnline();
        if (!queued) {
          try {
            const response = await fetch("/api/memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.memo) });
            if (!response.ok) {
              if (response.status >= 500) queued = true;
              else throw new Error("保存失败，请重试");
            }
          } catch (error) {
            if (isNetworkSaveError(error)) queued = true;
            else throw error;
          }
        }
        if (queued && !enqueueMemoCreate(localStorage, session.user.id, op).persisted) {
          toast({ title: "本地存储不可用，请保留输入并重试", variant: "destructive" });
          return;
        }
        toast({ title: queued ? "已离线保存，联网后自动同步" : "速记已保存" });
        window.dispatchEvent(new CustomEvent("organize:memos-synced"));
        void emitDataChanged({ topic: "memos", origin: "main" });
      }
      setDrafts((previous) => ({ ...previous, [mode]: "" }));
      if (userIdRef.current) clearMemoDraft(localStorage, userIdRef.current, `quick-add:${mode}`);
      setOpen(false);
    } catch (error) {
      toast({ title: "保存失败，输入已保留", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { submittingRef.current = false; setIsSubmitting(false); }
  };

  const selected = options.find((option) => option.mode === mode);
  return (
    <>
      <Button size="icon" aria-label="快速新建" className="fixed bottom-6 right-6 z-40 hidden h-12 w-12 rounded-full shadow-sm md:inline-flex" onClick={() => openPanel()}><Plus className="h-6 w-6" /></Button>
      <Dialog open={open} onOpenChange={(next) => { if (!submittingRef.current) setOpen(next); }}>
        <DialogContent className="quick-add-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
          <DialogHeader>
            <DialogTitle>{selected?.label || "记录点什么"}</DialogTitle>
            <DialogDescription>{mode === "task" ? taskHint : selected?.description || "想法、文章和下一步，都从这里开始"}</DialogDescription>
          </DialogHeader>
          {mode === "menu" ? (
            <div className="space-y-1">
              {options.map(({ mode: next, label, description, icon: Icon }) => (
                <button key={next} type="button" disabled={isSubmitting} className="flex min-h-[72px] w-full items-center gap-4 rounded-xl px-3 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { if (next === "note") void createNote(); else setMode(next); }}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-base font-medium">{label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{description}</span></span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : mode !== "note" && (
            <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-4">
              {mode === "memo" ? (
                <textarea autoFocus aria-label="速记内容" placeholder="此刻有什么想法？用 #标签 标记主题" value={drafts.memo} disabled={isSubmitting} onChange={(event) => updateDraft(event.target.value)} onKeyDown={(event) => { if (!isImeComposing(event) && event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }} rows={5} className="w-full resize-none rounded-xl border bg-card p-3 text-base leading-relaxed outline-none focus:ring-2 focus:ring-ring/30" />
              ) : (
                <Input autoFocus aria-label={mode === "url" ? "文章链接" : "待办内容"} placeholder={mode === "url" ? "粘贴文章链接" : "准备做什么？"} value={drafts[mode]} disabled={isSubmitting} onChange={(event) => updateDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && isImeComposing(event)) event.preventDefault(); }} inputMode={mode === "url" ? "url" : "text"} enterKeyHint="done" className="h-12 text-base" />
              )}
              {mode === "memo" && drafts.memo.length > 4500 && <p className="text-right text-xs text-muted-foreground">{drafts.memo.length} / 5000</p>}
              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => setMode("menu")}><ArrowLeft className="mr-1.5 h-4 w-4" />切换类型</Button>
                <Button type="submit" disabled={isSubmitting || !drafts[mode].trim() || (mode === "memo" && drafts.memo.length > 5000)} className="min-w-28">{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "url" ? "保存链接" : mode === "task" ? "添加待办" : "保存速记"}</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
