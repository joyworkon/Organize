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
import { Plus, Search, FileText, ArrowUpDown, ListChecks, Trash2, Pin, Upload } from "lucide-react";
import { NoteCard, type NoteViewMode } from "@/components/notes/note-card";
import { LayoutGrid, List as ListIcon, FileDown } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { JoyspaceImportDialog } from "@/components/notes/joyspace-import-dialog";
import { MarkdownImportDialog } from "@/components/notes/markdown-import-dialog";
import {
  nextSortField,
  applyPinned,
  applyPinnedBatch,
  removeNotes,
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

  const selection = useSelection<NoteWithTags>();
  const { selectedIds, isSelectMode, selectAll, clear, isSelected } = selection;

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
      query = query.ilike("title", `%${search.trim()}%`);
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

  const deleteNote = async (id: string) => {
    if (!confirm("确定删除这篇笔记？此操作不可撤销。")) return;
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) {
      toast({ title: "删除失败", description: error.message, variant: "destructive" });
      return;
    }
    setNotes((prev) => removeNotes(prev, new Set([id])));
    toast({ title: "已删除笔记" });
  };

  const togglePin = async (id: string, pinned: boolean) => {
    setNotes((prev) => applyPinned(prev, id, pinned));
    const { error } = await supabase.from("notes").update({ is_pinned: pinned }).eq("id", id);
    if (error) {
      setNotes((prev) => applyPinned(prev, id, !pinned));
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
    if (!confirm(`确定删除选中的 ${selectedIds.size} 篇笔记？此操作不可撤销。`)) return;
    const ids = Array.from(selectedIds);
    const count = ids.length;
    const { error } = await supabase.from("notes").delete().in("id", ids);
    if (error) {
      toast({ title: "批量删除失败", description: error.message, variant: "destructive" });
      return;
    }
    setNotes((prev) => removeNotes(prev, selectedIds));
    exitSelection();
    toast({ title: `已删除 ${count} 篇笔记`, variant: "destructive" });
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
    setNotes((prev) => applyPinnedBatch(prev, selectedIds, pinned));
    exitSelection();
    toast({ title: `已${pinned ? "置顶" : "取消置顶"} ${count} 篇笔记` });
  };

  const handleSelectAllVisible = () => {
    selectAll(notes.map((n) => n.id));
  };

  const noteCardProps = (note: NoteWithTags) => ({
    note,
    view,
    selected: isSelected(note.id),
    onSelectChange: showCheckbox ? handleToggleSelect : undefined,
    selectionMode: selectionMode || isSelectMode,
    onTogglePin: togglePin,
    onDelete: deleteNote,
    onTagsApplied: () => fetchNotes(),
  });

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
          <Button onClick={createNote} disabled={creating} className="shrink-0">
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
            placeholder="搜索..."
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
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={search.trim() || selectedTagIds.length > 0 ? "没有找到匹配的笔记" : "还没有笔记"}
          description="开始记录你的想法和灵感"
        />
      ) : view === "list" ? (
        <div className="grid gap-2 sm:gap-3">
          {notes.map((note) => (
            <NoteCard key={note.id} {...noteCardProps(note)} />
          ))}
        </div>
      ) : (
        <div className="grid gap-2 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <NoteCard key={note.id} {...noteCardProps(note)} />
          ))}
        </div>
      )}
    </div>
  );
}
