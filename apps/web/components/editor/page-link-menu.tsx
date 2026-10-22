"use client";

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, Plus, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { createNewNote, describeCreateNoteResult } from "@/lib/notes/create-note";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EditorPopover } from "./editor-popover";
import { highlightMatch } from "./highlight-match";
import { insertPageLink, type PageLinkEvent } from "./extensions/page-link-trigger";

type Session = Extract<PageLinkEvent, { type: "start" | "update" }>;
interface PageOption { id: string; title: string; icon: string | null; parent_note_id: string | null; parent_title?: string }

export async function searchLinkPages(query: string, noteId?: string): Promise<PageOption[]> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("请先登录后搜索页面");
  // No owner filter: session RLS also includes accessible shared pages. Never use a service key.
  let request = supabase.from("notes").select("id, title, icon, parent_note_id")
    .is("deleted_at", null).order("updated_at", { ascending: false }).limit(20);
  if (noteId) request = request.neq("id", noteId);
  if (query.trim()) request = request.ilike("title", `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error } = await request;
  if (error || !Array.isArray(data)) throw new Error("页面加载失败，请重试");
  const pages = data as PageOption[];
  const parentIds = [...new Set(pages.flatMap((page) => page.parent_note_id ? [page.parent_note_id] : []))];
  if (!parentIds.length) return pages;
  const parents = await supabase.from("notes").select("id, title").in("id", parentIds).is("deleted_at", null);
  if (parents.error || !Array.isArray(parents.data)) throw new Error("父页面信息加载失败，请重试");
  const titles = new Map<string, string>(parents.data.map((parent: { id: string; title: string }) => [parent.id, parent.title || "无标题笔记"]));
  return pages.map((page) => ({ ...page, parent_title: page.parent_note_id ? titles.get(page.parent_note_id) : undefined }));
}

export function PageLinkMenu({ editor, noteId, onOpenChange }: {
  editor: Editor; noteId?: string; onOpenChange?: (open: boolean) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const close = useCallback(() => setSession(null), []);
  const open = Boolean(session && editor.isEditable);
  useLayoutEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);
  useEffect(close, [editor, noteId, close]);
  useEffect(() => {
    const dom = editor.view.dom;
    const handler = (event: Event) => {
      if (event.target !== dom) return;
      const detail = (event as CustomEvent<PageLinkEvent>).detail;
      if (detail.type === "start") setSession(detail);
      if (detail.type === "update") setSession((current) => current ? detail : null);
      if (detail.type === "exit") close();
    };
    dom.addEventListener("organize-page-link", handler);
    const checkEditable = () => { if (!editor.isEditable) close(); };
    editor.on("blur", close);
    editor.on("transaction", checkEditable);
    editor.on("update", checkEditable);
    return () => { dom.removeEventListener("organize-page-link", handler); editor.off("blur", close); editor.off("transaction", checkEditable); editor.off("update", checkEditable); };
  }, [editor, close]);
  return session && editor.isEditable
    ? <PageLinkResults editor={editor} noteId={noteId} session={session} onClose={close} />
    : null;
}

function PageLinkResults({ editor, noteId, session, onClose }: {
  editor: Editor; noteId?: string; session: Session; onClose: () => void;
}) {
  const [pages, setPages] = useState<PageOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedQuery, setResolvedQuery] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const currentSession = useRef<Session | null>(session);
  currentSession.current = session;
  useEffect(() => () => { currentSession.current = null; }, []);
  const query = session.query.trim();
  const busy = loading || resolvedQuery !== query;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCreateError(null);
    setActive(0);
    const timer = setTimeout(() => {
      void searchLinkPages(query, noteId).then((result) => {
        if (!cancelled) setPages(result);
      }).catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "页面加载失败，请重试");
      }).finally(() => { if (!cancelled) { setResolvedQuery(query); setLoading(false); } });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, noteId, retry]);

  const count = pages.length + (query ? 1 : 0);
  const select = async (index: number) => {
    if (busy || error || creating || !editor.isEditable) return;
    const page = pages[index];
    if (page) {
      if (insertPageLink(editor, session.range, page)) onClose();
      return;
    }
    if (index !== pages.length || !query) return;
    setCreating(true);
    setCreateError(null);
    try {
      // Create a standalone page: the current editable page may belong to a collaborator,
      // while the existing parent constraint only permits pages owned by the same user.
      const result = await createNewNote(createClient(), { title: query });
      if (result.status === "failed" || result.status === "unauthenticated") {
        if (currentSession.current) setCreateError(describeCreateNoteResult(result));
        return;
      }
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      const current = currentSession.current;
      // Closing/moving/editing while creation is pending must never insert into a stale selection.
      if (current && current.query.trim() === query && insertPageLink(editor, current.range, { id: result.noteId, title: query })) onClose();
      toast({ title: describeCreateNoteResult(result) });
    } catch {
      if (currentSession.current) setCreateError("创建页面失败，请重试");
    } finally {
      if (currentSession.current) setCreating(false);
    }
  };
  const keyHandler = useRef<(event: Event) => void>(() => {});
  keyHandler.current = (event) => {
    const detail = (event as CustomEvent<PageLinkEvent>).detail;
    if (detail.type !== "key") return;
    event.preventDefault();
    if (detail.key === "Escape") { onClose(); return; }
    if (busy || error || creating || !count) return;
    if (detail.key === "ArrowDown") setActive((value) => Math.min(value + 1, count - 1));
    else if (detail.key === "ArrowUp") setActive((value) => Math.max(value - 1, 0));
    else void select(active);
  };
  useEffect(() => {
    const dom = editor.view.dom;
    const handler = (event: Event) => { if (event.target === dom) keyHandler.current(event); };
    dom.addEventListener("organize-page-link", handler);
    return () => dom.removeEventListener("organize-page-link", handler);
  }, [editor]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  return <EditorPopover point={session.point} onClose={onClose} className="page-link-popover">
    <div className="editor-menu-filter-hint" role="status" aria-live="polite">
      <Search className="h-3.5 w-3.5" />
      <span>{creating ? "正在新建页面…" : busy ? "正在加载页面…" : query ? `搜索页面：${query}` : "最近编辑的页面 · 输入以搜索"}</span>
    </div>
    {error && <div className="editor-menu-empty" role="alert">{error} <Button variant="ghost" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={() => setRetry((value) => value + 1)}>重试</Button></div>}
    {createError && <div className="editor-menu-empty" role="alert">{createError}</div>}
    <div ref={listRef} className="editor-menu-scroll" role="listbox" aria-label="链接到页面" aria-busy={busy || creating}>
      {!busy && !error && !pages.length && <div className="editor-menu-empty">{query ? "没有匹配的页面" : "暂无可链接的页面"}</div>}
      {pages.map((page, index) => <Button key={page.id} type="button" variant="ghost" role="option" aria-selected={index === active}
        disabled={busy || creating || Boolean(error)} className={cn("h-auto w-full justify-start gap-2.5 whitespace-normal px-2 py-2 text-left font-normal", index === active && "is-active bg-accent")}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => void select(index)}>
        {page.icon ? <span className="skill-icon" aria-hidden="true">{page.icon}</span> : <FileText className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 break-words"><strong>{highlightMatch(page.title || "无标题笔记", query)}</strong><small>{page.parent_note_id ? (page.parent_title ? `位于 ${page.parent_title}` : "子页面") : "笔记"}</small></span>
      </Button>)}
      {query && !error && <Button type="button" variant="ghost" role="option" aria-selected={active === pages.length} disabled={busy || creating}
        className={cn("h-auto w-full justify-start gap-2.5 whitespace-normal px-2 py-2 text-left font-normal", active === pages.length && "is-active bg-accent")}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(pages.length)} onClick={() => void select(pages.length)}>
        <Plus className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">新建页面“{query}”</span>
      </Button>}
    </div>
  </EditorPopover>;
}
