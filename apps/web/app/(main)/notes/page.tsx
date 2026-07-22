"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Note } from "@organize/shared";
import { Plus, Search, FileText, ArrowUpDown } from "lucide-react";
import { NoteCard, type NoteViewMode } from "@/components/notes/note-card";
import { Checkbox } from "@/components/ui/checkbox";
import { LayoutGrid, List as ListIcon, CheckSquare, X, Trash2 } from "lucide-react";
import Link from "next/link";

type SortField = "updated_at" | "created_at" | "title";
type SortOrder = "asc" | "desc";

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("updated_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  // 视图：卡片 / 列表
  const [view, setView] = useState<NoteViewMode>("card");
  // 批量选择
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const supabase = createClient();

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    let query = supabase
      .from("notes")
      .select("*, reading_item:reading_items(id, title, url)")
      .eq("user_id", user.id)
      // 置顶项在前，再按用户选择的字段排序
      .order("is_pinned", { ascending: false })
      .order(sortBy, { ascending: sortOrder === "asc" });

    if (search.trim()) {
      query = query.ilike("title", `%${search.trim()}%`);
    }

    const { data, error } = await query;

    if (!error && data) {
      setNotes(data as Note[]);
    }
    setLoading(false);
  }, [search, sortBy, sortOrder, supabase]);

  useEffect(() => {
    const timer = setTimeout(fetchNotes, 300);
    return () => clearTimeout(timer);
  }, [fetchNotes]);

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
        window.location.href = `/notes/${data.id}`;
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
    if (!error) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // ---------- 批量删除 ----------
  const batchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 篇笔记？此操作不可撤销。`)) return;
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from("notes").delete().in("id", ids);
    if (!error) {
      setNotes((prev) => prev.filter((n) => !selectedIds.has(n.id)));
      setSelectedIds(new Set());
      setSelectionMode(false);
    }
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const selectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      notes.forEach((n) => next.add(n.id));
      return next;
    });
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const togglePin = async (id: string, pinned: boolean) => {
    // 乐观更新
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, is_pinned: pinned } : n)));
    const { error } = await supabase.from("notes").update({ is_pinned: pinned }).eq("id", id);
    if (error) {
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, is_pinned: !pinned } : n)));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">笔记</h1>
          <p className="text-muted-foreground mt-1">
            记录你的想法和阅读笔记
          </p>
        </div>
        <Button onClick={createNote} disabled={creating}>
          <Plus className="h-4 w-4 mr-2" />
          新建笔记
        </Button>
      </div>

      {createError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {createError}
        </div>
      )}

      {/* 搜索 + 排序 */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索笔记..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              const fields: SortField[] = ["updated_at", "created_at", "title"];
              const idx = fields.indexOf(sortBy);
              setSortBy(fields[(idx + 1) % fields.length]);
            }}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortBy === "updated_at" ? "更新时间" : sortBy === "created_at" ? "创建时间" : "标题"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
          >
            {sortOrder === "desc" ? "降序" : "升序"}
          </Button>

          {/* 视图切换 */}
          <div className="flex items-center rounded-md border overflow-hidden">
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

          {/* 批量按钮 */}
          <Button
            variant={selectionMode ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setSelectionMode(!selectionMode);
              if (selectionMode) setSelectedIds(new Set());
            }}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            批量
          </Button>
        </div>
      </div>

      {/* 批量操作浮动条 */}
      {(selectionMode || selectedIds.size > 0) && (
        <div className="sticky top-0 z-30 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-b flex items-center gap-2">
          <Checkbox
            checked={notes.length > 0 && notes.every((n) => selectedIds.has(n.id))}
            onCheckedChange={(c) => (c ? selectAllVisible() : clearSelection())}
          />
          <span className="text-sm font-medium">已选 {selectedIds.size} 项</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={batchDelete}
            disabled={selectedIds.size === 0}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* 笔记列表 */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : notes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>{search ? "没有找到匹配的笔记" : "还没有笔记"}</p>
          {!search && (
            <Button variant="link" onClick={createNote} className="mt-2">
              创建第一篇笔记
            </Button>
          )}
        </div>
      ) : view === "list" ? (
        <div className="grid gap-2">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              view="list"
              selected={selectedIds.has(note.id)}
              onSelectChange={selectionMode || selectedIds.size > 0 ? toggleSelect : undefined}
              selectionMode={selectionMode}
              onTogglePin={togglePin}
              onDelete={deleteNote}
              onTagsApplied={() => fetchNotes()}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              view="card"
              selected={selectedIds.has(note.id)}
              onSelectChange={selectionMode || selectedIds.size > 0 ? toggleSelect : undefined}
              selectionMode={selectionMode}
              onTogglePin={togglePin}
              onDelete={deleteNote}
              onTagsApplied={() => fetchNotes()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
