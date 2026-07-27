"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tag as TagIcon, Plus, Pencil, Trash2, Search, Loader2, ArrowLeft, BookOpen, FileText, LayoutList } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tag, TagWithCount, NoteWithTags, ReadingItem } from "@organize/shared";

type DetailFilter = "all" | "reading" | "notes";

export default function TagsPage() {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const supabase = createClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<TagWithCount | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TagWithCount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [selectedTag, setSelectedTag] = useState<TagWithCount | null>(null);
  const [detailFilter, setDetailFilter] = useState<DetailFilter>("all");
  const [detailItems, setDetailItems] = useState<{ readings: ReadingItem[]; notes: NoteWithTags[] }>({ readings: [], notes: [] });
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: tagData } = await supabase
        .from("tags")
        .select("id, name, created_at")
        .eq("user_id", user.id)
        .order("name", { ascending: true });

      const [itemTagsRes, noteTagsRes] = await Promise.all([
        supabase.from("item_tags").select("tag_id"),
        supabase.from("note_tags").select("tag_id"),
      ]);

      const countMap = new Map<string, { note_count: number; reading_item_count: number }>();
      for (const row of itemTagsRes.data || []) {
        const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0 };
        entry.reading_item_count += 1;
        countMap.set(row.tag_id, entry);
      }
      for (const row of noteTagsRes.data || []) {
        const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0 };
        entry.note_count += 1;
        countMap.set(row.tag_id, entry);
      }

      const result: TagWithCount[] = (tagData || []).map((t) => ({
        id: t.id,
        user_id: user.id,
        name: t.name,
        ...(countMap.get(t.id) || { note_count: 0, reading_item_count: 0 }),
      }));
      setTags(result);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const fetchTagDetail = useCallback(async (tagId: string) => {
    setDetailLoading(true);
    try {
      const [{ data: itemLinks }, { data: noteLinks }] = await Promise.all([
        supabase.from("item_tags").select("item_id").eq("tag_id", tagId),
        supabase.from("note_tags").select("note_id").eq("tag_id", tagId),
      ]);

      const itemIds = (itemLinks || []).map((l) => l.item_id);
      const noteIds = (noteLinks || []).map((l) => l.note_id);

      const [readingsRes, notesRes] = await Promise.all([
        itemIds.length > 0
          ? supabase.from("reading_items").select("*").in("id", itemIds).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        noteIds.length > 0
          ? supabase.from("notes").select("*, tags:tags!note_tags(*)").in("id", noteIds).order("updated_at", { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);

      setDetailItems({
        readings: (readingsRes.data || []) as unknown as ReadingItem[],
        notes: (notesRes.data || []) as unknown as NoteWithTags[],
      });
    } finally {
      setDetailLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    if (selectedTag) {
      fetchTagDetail(selectedTag.id);
    }
  }, [selectedTag, fetchTagDetail]);

  const filtered = tags.filter((t) =>
    !search.trim() ? true : t.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const totalUsage = (t: TagWithCount) => (t.note_count || 0) + (t.reading_item_count || 0);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");

      const { data, error } = await supabase
        .from("tags")
        .upsert({ user_id: user.id, name }, { onConflict: "user_id,name" })
        .select("id, name")
        .single();

      if (error) throw error;
      setNewName("");
      setCreateOpen(false);
      await fetchTags();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setRenaming(true);
    try {
      const { error } = await supabase
        .from("tags")
        .update({ name: renameValue.trim() })
        .eq("id", renameTarget.id);
      if (!error) {
        setRenameTarget(null);
        if (selectedTag?.id === renameTarget.id) {
          setSelectedTag(null);
        }
        await fetchTags();
      }
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("tags").delete().eq("id", deleteTarget.id);
      if (!error) {
        setDeleteTarget(null);
        if (selectedTag?.id === deleteTarget.id) {
          setSelectedTag(null);
        }
        await fetchTags();
      }
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("zh-CN");
  const getHostname = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };

  if (selectedTag) {
    const showReadings = detailFilter === "all" || detailFilter === "reading";
    const showNotes = detailFilter === "all" || detailFilter === "notes";

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setSelectedTag(null)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-accent flex items-center justify-center">
                <TagIcon className="h-4 w-4 text-accent-foreground" />
              </div>
              <h1 className="text-2xl font-bold">{selectedTag.name}</h1>
            </div>
            <p className="text-muted-foreground mt-1 ml-10">
              共 {totalUsage(selectedTag)} 个内容
              {(selectedTag.reading_item_count || 0) > 0 && ` · ${selectedTag.reading_item_count} 篇文章`}
              {(selectedTag.note_count || 0) > 0 && ` · ${selectedTag.note_count} 条笔记`}
            </p>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
          {([
            { key: "all" as const, label: "全部", icon: LayoutList },
            { key: "reading" as const, label: "阅读文章", icon: BookOpen },
            { key: "notes" as const, label: "笔记", icon: FileText },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setDetailFilter(key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
                detailFilter === key
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {detailLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            加载中...
          </div>
        ) : (
          <div className="space-y-2">
            {showReadings && detailItems.readings.map((item) => (
              <Link key={item.id} href={`/library/${item.id}`}>
                <Card className="hover:shadow-sm transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <BookOpen className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium leading-tight line-clamp-1">{item.title || item.url}</h3>
                        {item.excerpt && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{item.excerpt}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <span>阅读文章</span>
                          {getHostname(item.url) && <span>· {getHostname(item.url)}</span>}
                          <span>· {formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}

            {showNotes && detailItems.notes.map((note) => (
              <Link key={note.id} href={`/notes/${note.id}`}>
                <Card className="hover:shadow-sm transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-md bg-accent flex items-center justify-center shrink-0 mt-0.5">
                        <FileText className="h-4 w-4 text-accent-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium leading-tight line-clamp-1">{note.title || "无标题"}</h3>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <span>笔记</span>
                          <span>· 更新于 {formatDate(note.updated_at)}</span>
                          {note.tags && note.tags.length > 0 && (
                            <span>· {note.tags.length} 个标签</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}

            {((showReadings && detailItems.readings.length === 0) && (showNotes && detailItems.notes.length === 0)) && (
              <div className="text-center py-12 text-muted-foreground">
                <TagIcon className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>该分类下暂无内容</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">标签管理</h1>
          <p className="text-muted-foreground mt-1">
            共 {tags.length} 个标签，累计使用 {tags.reduce((sum, t) => sum + totalUsage(t), 0)} 次
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            新建标签
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建标签</DialogTitle>
            </DialogHeader>
            <Input
              placeholder="标签名（最长 32 字符）"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setCreateError(null);
              }}
              maxLength={32}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="筛选标签..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <TagIcon className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>{search ? "没有匹配的标签" : "还没有标签"}</p>
          {!search && (
            <Button variant="link" onClick={() => setCreateOpen(true)} className="mt-2">
              创建第一个标签
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tag) => (
            <Card
              key={tag.id}
              className="group hover:shadow-md transition-all cursor-pointer hover:border-primary/50"
              onClick={() => setSelectedTag(tag)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                    <TagIcon className="h-5 w-5 text-accent-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-foreground">{tag.name}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-3 w-3" />
                        {tag.reading_item_count || 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {tag.note_count || 0}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenameTarget(tag);
                        setRenameValue(tag.name);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:text-destructive"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(tag);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  共 {totalUsage(tag)} 个内容
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名标签</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={32}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>取消</Button>
            <Button onClick={handleRename} disabled={renaming || !renameValue.trim()}>
              {renaming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除标签</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定删除标签 <span className="font-medium text-foreground">{deleteTarget?.name}</span>？
            {deleteTarget && totalUsage(deleteTarget) > 0 && (
              <> 该标签当前用在 {totalUsage(deleteTarget)} 个内容上，删除后会自动从这些内容上移除。</>
            )}
            此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
