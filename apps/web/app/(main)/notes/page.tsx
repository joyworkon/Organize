"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Note } from "@organize/shared";
import { Plus, Search, FileText, Trash2, ArrowUpDown, Link2, Pin } from "lucide-react";
import { ShareDialog } from "@/components/share/share-dialog";
import { ExportButton } from "@/components/share/export-button";
import { NoteHistoryDialog } from "@/components/notes/note-history-dialog";
import { AutoTagDialog } from "@/components/tags/auto-tag-dialog";
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

  const deleteNote = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (!error) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
    }
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
        </div>
      </div>

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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <Link key={note.id} href={`/notes/${note.id}`}>
              <Card
                className={cn(
                  "group hover:shadow-md transition-shadow h-full",
                  note.is_pinned && "border-primary/40 bg-primary/5"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <h3 className="font-medium line-clamp-1">
                      {note.title || "无标题"}
                    </h3>
                    <div
                      className={cn(
                        "flex items-center gap-0.5 transition-opacity",
                        note.is_pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          togglePin(note.id, !note.is_pinned);
                        }}
                        className={cn(
                          "p-1 rounded hover:bg-accent",
                          note.is_pinned ? "text-primary" : "text-muted-foreground"
                        )}
                        title={note.is_pinned ? "取消置顶" : "置顶"}
                      >
                        <Pin
                          className={cn("h-3.5 w-3.5", note.is_pinned && "fill-primary")}
                        />
                      </button>
                      <ExportButton noteId={note.id} title={note.title || undefined} size="sm" />
                      <AutoTagDialog
                        resourceType="note"
                        resourceId={note.id}
                        triggerSize="sm"
                        onApplied={() => fetchNotes()}
                      />
                      <NoteHistoryDialog noteId={note.id} triggerSize="sm" />
                      <ShareDialog resourceType="note" resourceId={note.id} triggerSize="sm" />
                      <button
                        onClick={(e) => deleteNote(note.id, e)}
                        className="p-1 rounded hover:bg-accent"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  </div>
                  {/* 关联阅读条目 */}
                  {note.reading_item && (
                    <p className="text-xs text-primary/70 mt-1.5 flex items-center gap-1 line-clamp-1">
                      <Link2 className="h-3 w-3 shrink-0" />
                      {(note.reading_item as any).title || (note.reading_item as any).url}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(note.updated_at).toLocaleString("zh-CN")}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
