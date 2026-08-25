"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagFilter } from "@/components/tags/tag-filter";
import { useAllTags } from "@/components/tags/use-tags";
import { BatchActionsBar } from "@/components/batch-actions-bar";
import { useSelection } from "@/hooks/use-selection";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { NoteWithTags } from "@organize/shared";
import type { NoteTreeItem } from "@/lib/notes/tree";
import { Plus, Search, FileText, ArrowUpDown, ListChecks, Trash2, Pin, Upload } from "lucide-react";
import { NoteCard, type NoteViewMode } from "@/components/notes/note-card";
import { NoteMoveDialog } from "@/components/notes/note-move-dialog";
import { LayoutGrid, List as ListIcon, FileDown } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { JoyspaceImportDialog } from "@/components/notes/joyspace-import-dialog";
import { MarkdownImportDialog } from "@/components/notes/markdown-import-dialog";
import { mutateTrash } from "@/lib/trash/client";
import { findNoteSearchMatch } from "@/lib/notes/search-match";
import { groupNotesByDate, type DateGroup } from "@/lib/date-groups";
import { useHotkey, hasOpenDialog } from "@/lib/hooks/use-hotkey";
import {
  nextSortField,
  applyPinned,
  applyPinnedBatch,
  removeNotes,
  sortNotesLocal,
  type SortField,
  type SortOrder,
} from "./page-utils";

export default function NotesPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("updated_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [view, setView] = useState<NoteViewMode>("list");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [mdImportOpen, setMdImportOpen] = useState(false);
  const [allNotes, setAllNotes] = useState<NoteTreeItem[]>([]);
  const [moveDialogNoteId, setMoveDialogNoteId] = useState<string | null>(null);

  const selection = useSelection<NoteWithTags>();
  const { selectedIds, isSelectMode, selectAll, clear, isSelected } = selection;
  const searchInputRef = useRef<HTMLInputElement>(null);

  const supabase = useMemo(() => createClient(), []);
  const { tags: allTags, refresh: refreshTags } = useAllTags();

  const reqIdRef = useRef(0);
  const showCheckbox = selectionMode || isSelectMode;

  const fetchNotes = useCallback(async () => {
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    let scopedIds: string[] | null = null;
    if (selectedTagIds.length > 0) {
      const { data: tagRows } = await supabase
        .from("note_tags")
        .select("note_id")
        .in("tag_id", selectedTagIds);
      if (!tagRows || tagRows.length === 0) {
        if (reqIdRef.current !== myReqId) return;
        setNotes([]);
        setLoading(false);
        return;
      }
      scopedIds = Array.from(new Set(tagRows.map((r) => r.note_id as string)));
    }

    let query = supabase
      .from("notes")
      .select("*, reading_item:reading_items(id, title, url), tags:tags!note_tags(id, name)")
      .eq("user_id", user.id);

    if (search.trim()) {
      // 全文搜索：标题 + 正文（search_text 生成列，037 迁移）
      // 剥离会破坏 PostgREST or() 语法的字符
      const pattern = `%${search.trim().replace(/[%_",()\\]/g, " ")}%`;
      query = query.or(`title.ilike.${pattern},search_text.ilike.${pattern}`);
    }
    if (scopedIds) query = query.in("id", scopedIds);

    query = query
      .order("is_pinned", { ascending: false })
      .order(sortBy, { ascending: sortOrder === "asc" });

    const { data, error } = await query;

    if (reqIdRef.current !== myReqId) return;

    if (!error && data) {
      setNotes(data as NoteWithTags[]);
    }
    setLoading(false);
  }, [search, sortBy, sortOrder, selectedTagIds, supabase]);

  useEffect(() => {
    const timer = setTimeout(fetchNotes, 300);
    return () => clearTimeout(timer);
  }, [fetchNotes]);

  const loadAllNotes = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("notes")
      .select("id, title, icon, parent_note_id, updated_at")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    setAllNotes(
      (data || []).map((n) => ({
        id: n.id,
        title: n.title || null,
        icon: n.icon || null,
        parent_note_id: n.parent_note_id || null,
        updated_at: n.updated_at,
      }))
    );
  }, [supabase]);

  useEffect(() => {
    void loadAllNotes();
  }, [loadAllNotes]);

  useEffect(() => {
    const reload = () => {
      void loadAllNotes();
      void fetchNotes();
    };
    window.addEventListener("organize:notes-changed", reload);
    return () => window.removeEventListener("organize:notes-changed", reload);
  }, [loadAllNotes, fetchNotes]);

  const exitSelection = useCallback(() => {
    clear();
    setSelectionMode(false);
  }, [clear]);

  const createNote = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("未登录，请先登录");

      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          title: "无标题笔记",
          content: { type: "doc", content: [{ type: "paragraph" }] },
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        router.push(`/notes/${data.id}`);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  // 页面快捷键：n 新建、/ 聚焦搜索、Esc 退出多选或清空搜索（弹层打开时让位）
  useHotkey([
    {
      key: "n",
      ctrlKey: false,
      metaKey: false,
      handler: () => { if (!hasOpenDialog() && !creating) void createNote(); },
    },
    {
      key: "/",
      ctrlKey: false,
      metaKey: false,
      handler: () => { if (!hasOpenDialog()) searchInputRef.current?.focus(); },
    },
    {
      key: "escape",
      ctrlKey: false,
      metaKey: false,
      handler: () => {
        if (hasOpenDialog()) return;
        if (showCheckbox) exitSelection();
        else if (search) setSearch("");
      },
    },
  ]);

  const deleteNote = async (id: string) => {
    if (!confirm("将这篇笔记移入垃圾箱？之后可以恢复。")) return;
    try {
      await mutateTrash("note", [id], "soft_delete");
      setNotes((prev) => removeNotes(prev, new Set([id])));
      toast({ title: "笔记已移入垃圾箱" });
    } catch (error) {
      toast({
        title: "删除失败",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const togglePin = async (id: string, pinned: boolean) => {
    setNotes((prev) => sortNotesLocal(applyPinned(prev, id, pinned), sortBy, sortOrder));
    const { error } = await supabase.from("notes").update({ is_pinned: pinned }).eq("id", id);
    if (error) {
      setNotes((prev) => sortNotesLocal(applyPinned(prev, id, !pinned), sortBy, sortOrder));
      toast({ title: pinned ? "置顶失败" : "取消置顶失败", variant: "destructive" });
    }
  };

  const handleToggleSelect = useCallback(
    (id: string, checked: boolean) => {
      if (checked) {
        selection.select(id);
      } else {
        selection.deselect(id);
      }
    },
    [selection]
  );

  const batchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`将选中的 ${selectedIds.size} 篇笔记移入垃圾箱？`)) return;
    const ids = Array.from(selectedIds);
    const count = ids.length;
    try {
      await mutateTrash("note", ids, "soft_delete");
      setNotes((prev) => removeNotes(prev, selectedIds));
      exitSelection();
      toast({ title: `${count} 篇笔记已移入垃圾箱` });
    } catch (error) {
      toast({
        title: "批量删除失败",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const batchTogglePin = async (pinned: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const { error } = await supabase
      .from("notes")
      .update({ is_pinned: pinned })
      .in("id", ids);
    if (error) {
      toast({ title: "操作失败", description: error.message, variant: "destructive" });
      return;
    }
    setNotes((prev) => sortNotesLocal(applyPinnedBatch(prev, selectedIds, pinned), sortBy, sortOrder));
    exitSelection();
    toast({ title: `已${pinned ? "置顶" : "取消置顶"} ${count} 篇笔记` });
  };

  const handleSelectAllVisible = () => {
    selectAll(notes.map((n) => n.id));
  };

  const searchMatches = useMemo(() => {
    const query = search.trim();
    if (!query) return new Map<string, ReturnType<typeof findNoteSearchMatch>>();
    return new Map(notes.map((note) => [note.id, findNoteSearchMatch(note.content, query)]));
  }, [notes, search]);

  // 列表视图 + 默认排序（更新时间降序）+ 非搜索态时按时间分组（今天/昨天/本周/更早），
  // 置顶笔记独立成组保持在最上；其余排序方式或搜索态下保持平铺，不干扰用户预期。
  const noteSections = useMemo<DateGroup<NoteWithTags>[] | null>(() => {
    if (view !== "list" || sortBy !== "updated_at" || sortOrder !== "desc" || search.trim()) {
      return null;
    }
    const pinned = notes.filter((note) => note.is_pinned);
    const groups = groupNotesByDate(notes.filter((note) => !note.is_pinned));
    return pinned.length > 0
      ? [{ key: "pinned", label: "置顶", items: pinned }, ...groups]
      : groups;
  }, [notes, view, sortBy, sortOrder, search]);

  const noteCardProps = (note: NoteWithTags) => ({
    note,
    view,
    searchMatch: searchMatches.get(note.id),
    titleMatched:
      !!search.trim() &&
      (note.title || "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    selected: isSelected(note.id),
    onSelectChange: showCheckbox ? handleToggleSelect : undefined,
    selectionMode: selectionMode || isSelectMode,
    onTogglePin: togglePin,
    onDelete: deleteNote,
    onTagsApplied: () => fetchNotes(),
    onMove: (id: string) => setMoveDialogNoteId(id),
  });

  const moveTargetNote = useMemo(
    () => (moveDialogNoteId ? notes.find((n) => n.id === moveDialogNoteId) ?? allNotes.find((n) => n.id === moveDialogNoteId) : null),
    [moveDialogNoteId, notes, allNotes]
  );

  const handleConfirmMove = useCallback(
    async (noteId: string, nextParentId: string | null, oldParentId: string | null) => {
      if (nextParentId === oldParentId) return;
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, parent_note_id: nextParentId } : n))
      );
      setAllNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, parent_note_id: nextParentId } : n))
      );
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      try {
        const { error } = await supabase
          .from("notes")
          .update({ parent_note_id: nextParentId })
          .eq("id", noteId);
        if (error) throw error;
        toast({ title: "已移动" });
      } catch (err) {
        setNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, parent_note_id: oldParentId } : n))
        );
        setAllNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, parent_note_id: oldParentId } : n))
        );
        window.dispatchEvent(new CustomEvent("organize:notes-changed"));
        toast({
          title: "移动失败",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
        throw err;
      }
    },
    [supabase]
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">笔记</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            记录你的想法和阅读笔记
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} className="hidden sm:flex">
            <FileDown className="h-4 w-4 mr-2" />
            从 JoySpace 导入
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMdImportOpen(true)} className="shrink-0">
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">导入MD</span>
          </Button>
          <Button onClick={createNote} disabled={creating} className="shrink-0" title="新建笔记（按 n）">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">新建笔记</span>
          </Button>
        </div>
      </div>

      <JoyspaceImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(id) => router.push(`/notes/${id}`)}
      />
      <MarkdownImportDialog
        open={mdImportOpen}
        onOpenChange={setMdImportOpen}
        onImported={(id) => router.push(`/notes/${id}`)}
      />

      {createError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {createError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="搜索...（按 / 聚焦）"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setSortBy(nextSortField(sortBy))}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{sortBy === "updated_at" ? "更新时间" : sortBy === "created_at" ? "创建时间" : "标题"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
            className="hidden sm:flex"
          >
            {sortOrder === "desc" ? "降序" : "升序"}
          </Button>

          <div className="hidden sm:flex items-center rounded-md border overflow-hidden">
            <button
              onClick={() => setView("card")}
              className={cn(
                "p-1.5 transition-colors",
                view === "card" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              )}
              title="卡片视图"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView("list")}
              className={cn(
                "p-1.5 transition-colors",
                view === "list" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              )}
              title="列表视图"
            >
              <ListIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button
            variant={showCheckbox ? "default" : "ghost"}
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (selectionMode) {
                exitSelection();
              } else {
                setSelectionMode(true);
              }
            }}
          >
            <ListChecks className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">多选</span>
          </Button>
        </div>
      </div>

      <div className="flex items-center">
        <TagFilter
          options={allTags}
          selectedIds={selectedTagIds}
          onChange={setSelectedTagIds}
        />
      </div>

      {isSelectMode && (
        <BatchActionsBar
          selectedCount={selectedIds.size}
          totalCount={notes.length}
          onClear={exitSelection}
          onSelectAll={handleSelectAllVisible}
          typeLabel="篇笔记"
          actions={
            <>
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => batchTogglePin(true)} title="置顶">
                <Pin className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">置顶</span>
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={batchDelete} title="删除">
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">删除</span>
              </Button>
            </>
          }
        />
      )}

      {loading ? (
        <div className="grid gap-2 sm:gap-3" aria-busy="true" aria-label="笔记加载中">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-[88px] animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={search.trim() || selectedTagIds.length > 0 ? "没有找到匹配的笔记" : "还没有笔记"}
          description={
            search.trim() || selectedTagIds.length > 0
              ? "换个关键词或筛选条件试试"
              : "记录你的想法、灵感和阅读笔记"
          }
          action={
            search.trim() || selectedTagIds.length > 0 ? undefined : (
              <Button onClick={createNote} disabled={creating}>
                <Plus className="h-4 w-4 mr-2" />
                新建笔记
              </Button>
            )
          }
        />
      ) : view === "list" ? (
        noteSections ? (
          <div className="space-y-5">
            {noteSections.map((section) => (
              <section key={section.key}>
                <h2 className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                  {section.label}
                  <span className="ml-1.5">{section.items.length}</span>
                </h2>
                <div className="grid gap-2 sm:gap-3">
                  {section.items.map((note) => (
                    <NoteCard key={note.id} {...noteCardProps(note)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="grid gap-2 sm:gap-3">
            {notes.map((note) => (
              <NoteCard key={note.id} {...noteCardProps(note)} />
            ))}
          </div>
        )
      ) : (
        <div className="grid gap-2 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <NoteCard key={note.id} {...noteCardProps(note)} />
          ))}
        </div>
      )}

      {moveTargetNote && (
        <NoteMoveDialog
          open={!!moveDialogNoteId}
          onOpenChange={(o) => { if (!o) setMoveDialogNoteId(null); }}
          noteId={moveTargetNote.id}
          noteTitle={moveTargetNote.title || "无标题笔记"}
          currentParentId={moveTargetNote.parent_note_id ?? null}
          notes={allNotes}
          onConfirm={(parentId) =>
            handleConfirmMove(
              moveTargetNote.id,
              parentId,
              moveTargetNote.parent_note_id ?? null
            )
          }
        />
      )}
    </div>
  );
}
