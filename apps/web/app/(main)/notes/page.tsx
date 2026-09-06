"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Network } from "lucide-react";
import { TagFilter } from "@/components/tags/tag-filter";
import { useAllTags } from "@/components/tags/use-tags";
import { BatchActionsBar } from "@/components/batch-actions-bar";
import { useSelection } from "@/hooks/use-selection";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { NoteWithTags } from "@organize/shared";
import type { NoteTreeItem } from "@/lib/notes/tree";
import { Plus, Search, FileText, ArrowUpDown, ListChecks, Trash2, Pin, Upload, WifiOff } from "lucide-react";
import { NoteCard, NoteFavoritesContext, type NoteViewMode } from "@/components/notes/note-card";
import { NoteMoveDialog } from "@/components/notes/note-move-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { LayoutGrid, List as ListIcon, FileDown } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { JoyspaceImportDialog } from "@/components/notes/joyspace-import-dialog";
import { MarkdownImportDialog } from "@/components/notes/markdown-import-dialog";
import { mutateTrash } from "@/lib/trash/client";
import { findNoteSearchMatch } from "@/lib/notes/search-match";
import { isOnline, useOnlineStatus } from "@/lib/offline/network";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import {
  enqueueNoteCreate,
  findNoteCreate,
  makeNoteCreateOp,
  noteCreatesCount,
  readNoteCreates,
  removeNoteCreate,
  replayNoteCreates,
  writeNoteCreates,
  type NoteCreateWriter,
} from "@/lib/offline/note-queue";
import {
  enqueueNoteDelete,
  noteDeletesCount,
  readNoteDeletes,
  replayNoteDeletes,
  writeNoteDeletes,
  type NoteDeleteWriter,
} from "@/lib/offline/note-delete-queue";
import { groupNotesByDate, type DateGroup } from "@/lib/date-groups";
import { useHotkey, hasOpenDialog } from "@/lib/hooks/use-hotkey";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
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

  // X1 离线同步：网络状态 + 待回放操作数（离线创建 + 离线删除）
  const online = useOnlineStatus();
  const [pendingOps, setPendingOps] = useState(0);
  const refreshPendingOps = useCallback(() => {
    const count = noteCreatesCount(localStorage) + noteDeletesCount(localStorage);
    setPendingOps(count);
    return count;
  }, []);
  useEffect(() => {
    refreshPendingOps();
  }, [refreshPendingOps]);

  /** 待同步创建转为列表乐观条目（仅保留列表渲染所需字段） */
  const pendingCreatesAsNotes = useCallback((): NoteWithTags[] => {
    const keyword = search.trim().toLowerCase();
    return readNoteCreates(localStorage)
      .filter((op) => {
        if (selectedTagIds.length > 0) return false; // 待同步笔记无标签，不进入标签筛选
        if (!keyword) return true;
        return String(op.note.title || "").toLowerCase().includes(keyword);
      })
      .map((op) => ({
        id: String(op.note.id),
        user_id: String(op.note.user_id || ""),
        title: (op.note.title as string | null) ?? null,
        content: (op.note.content as Record<string, unknown> | null) ?? null,
        reading_item_id: null,
        is_pinned: false,
        created_at: new Date(op.created_at).toISOString(),
        updated_at: new Date(op.created_at).toISOString(),
        tags: [],
      }));
  }, [search, selectedTagIds]);

  // N04：列表层一次查询全部收藏状态，卡片经 Context 共享（不再逐卡查询）
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const loadFavorites = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setFavoritedIds(new Set());
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("favorites")
      .select("target_id")
      .eq("user_id", user.id)
      .eq("target_type", "note")
      .in("target_id", ids);
    setFavoritedIds(new Set((data || []).map((row) => row.target_id)));
  }, [supabase]);

  const fetchNotes = useCallback(async () => {
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      // 未登录/会话失效时也必须结束 loading：否则骨架屏永不消失，页面像卡死
      if (reqIdRef.current === myReqId) setLoading(false);
      return;
    }

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
      .order(sortBy, { ascending: sortOrder === "asc" })
      .order("id", { ascending: false }); // F04：末位稳定 tiebreak，分块拉取不重不漏

    // F04：数据库单请求默认 1000 行上限——分块循环拉全量，
    // 避免第 1001 条之后的笔记无声消失（列表/搜索/计数完整性）
    let data: NoteWithTags[] = [];
    let error: { message: string } | null = null;
    {
      const PAGE = 1000;
      const SAFETY_MAX = 10000;
      for (let from = 0; from < SAFETY_MAX; from += PAGE) {
        const { data: pageData, error: pageError } = await query.range(from, from + PAGE - 1);
        if (pageError) { error = pageError; break; }
        data = data.concat((pageData || []) as NoteWithTags[]);
        if (!pageData || pageData.length < PAGE) break;
      }
    }

    if (reqIdRef.current !== myReqId) return;

    if (!error && data) {
      // X1：合并待同步的离线创建（服务端尚未有的），置顶展示
      const serverIds = new Set((data as NoteWithTags[]).map((note) => note.id));
      const pending = pendingCreatesAsNotes().filter((note) => !serverIds.has(note.id));
      setNotes([...pending, ...(data as NoteWithTags[])]);
      // N04：一次 in(id) 批量查询收藏状态
      void loadFavorites((data as NoteWithTags[]).map((note) => note.id));
    } else if (error && isOnline()) {
      // 失败不能静默：否则列表停在旧数据上，用户无从得知已经看不到最新内容。
      // 离线时的查询失败是预期行为，由顶栏离线角标表达，不另弹 toast。
      toast({ title: "加载笔记列表失败", description: error.message, variant: "destructive" });
    }
    setLoading(false);
  }, [search, sortBy, sortOrder, selectedTagIds, supabase, pendingCreatesAsNotes, loadFavorites]);

  /** 回放离线队列（创建 + 删除）：联网后按序推送，应用成功的触发一次列表刷新 */
  const replayPendingOps = useCallback(async () => {
    const createOps = readNoteCreates(localStorage);
    const deleteOps = readNoteDeletes(localStorage);
    if (createOps.length === 0 && deleteOps.length === 0) {
      setPendingOps(0);
      return;
    }
    const createWriter: NoteCreateWriter = {
      insertNote: async (note) => {
        const { error } = await supabase.from("notes").insert(note);
        return { error };
      },
    };
    const createResult = await replayNoteCreates(createWriter, createOps);
    writeNoteCreates(localStorage, createResult.remaining);
    // 软删除必须走 mutate_trash RPC：直写 deleted_at 被 RLS 拒绝；
    // RPC 幂等（目标已删/不存在时更新 0 行，不报错）
    const deleteWriter: NoteDeleteWriter = {
      softDeleteNote: async (id) => {
        const { error } = await supabase.rpc("mutate_trash", {
          p_action: "soft_delete",
          p_resource_type: "note",
          p_ids: [id],
        });
        return { error };
      },
    };
    const deleteResult = await replayNoteDeletes(deleteWriter, deleteOps);
    writeNoteDeletes(localStorage, deleteResult.remaining);
    setPendingOps(createResult.remaining.length + deleteResult.remaining.length);
    const applied = createResult.applied + deleteResult.applied;
    if (applied > 0) {
      await fetchNotes();
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      toast({ title: `已同步 ${applied} 项离线更改` });
    }
  }, [fetchNotes, supabase]);

  // 联网即回放（含首次挂载时队列有积压的场景）。
  // replayPendingOps 的引用随搜索/排序变化——直接放进依赖会变成
  // 每次搜索按键都全量重放一遍队列，这里只跟随联网状态这一稳定触发源。
  const replayRef = useRef(replayPendingOps);
  useEffect(() => {
    replayRef.current = replayPendingOps;
  });
  useEffect(() => {
    if (online) void replayRef.current();
  }, [online]);

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
      // X1：getSession 读本地会话（无网络请求），离线创建可用；getUser 离线返回 null 会静默吞掉创建
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) throw new Error("未登录，请先登录");

      // X1：id 始终由客户端生成——离线创建可立即入队并跳转编辑器，
      // 服务端主键唯一约束保证回放幂等（23505 视为已应用）
      const insertPayload: Record<string, unknown> = {
        id: crypto.randomUUID(),
        user_id: user.id,
        // 空标题：编辑页用浅灰占位符「无标题笔记」展示 + 自动聚焦；列表/侧边栏显示时回退
        title: "",
        content: { type: "doc", content: [{ type: "paragraph" }] },
      };
      const applyOfflineCreate = () => {
        enqueueNoteCreate(localStorage, makeNoteCreateOp(insertPayload));
        refreshPendingOps();
        // 离线时客户端路由跳转不可靠（RSC 请求会失败）：就地插入列表顶部，
        // 联网回放后经 fetchNotes 去重收敛（serverIds 判定）
        const optimistic: NoteWithTags = {
          id: insertPayload.id as string,
          user_id: user.id,
          title: "",
          content: insertPayload.content as Record<string, unknown>,
          reading_item_id: null,
          is_pinned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          tags: [],
        };
        setNotes((current) => current.some((n) => n.id === optimistic.id) ? current : [optimistic, ...current]);
        toast({ title: "已离线创建，联网后自动同步" });
      };
      if (!isOnline()) {
        applyOfflineCreate();
        return;
      }

      const { data, error } = await supabase
        .from("notes")
        .insert(insertPayload)
        .select()
        .single();

      if (error) {
        // X1：网络错误按离线创建处理（客户端 id 保证回放不重复）
        if (isNetworkSaveError(error)) {
          applyOfflineCreate();
          return;
        }
        throw error;
      }

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
    // 仍在离线创建队列里的笔记（服务端还没有）：删除即丢弃草稿并刷新计数，
    // 否则列表会经 pendingCreatesAsNotes 重新显示它，联网回放还会把它插回服务端
    const discardPendingDraft = () => {
      removeNoteCreate(localStorage, id);
      refreshPendingOps();
    };
    // X1：离线软删除——乐观移出列表并入删除队列，联网回放 mutate_trash RPC
    const offlineDelete = () => {
      if (findNoteCreate(localStorage, id)) discardPendingDraft();
      else enqueueNoteDelete(localStorage, id);
      refreshPendingOps();
      setNotes((prev) => removeNotes(prev, new Set([id])));
      toast({ title: "已离线删除，联网后自动同步" });
    };
    if (!isOnline()) {
      offlineDelete();
      return;
    }
    try {
      await mutateTrash("note", [id], "soft_delete");
      if (findNoteCreate(localStorage, id)) discardPendingDraft();
      setNotes((prev) => removeNotes(prev, new Set([id])));
      toast({ title: "笔记已移入垃圾箱" });
    } catch (error) {
      // X1：网络错误按离线删除处理——入队待回放，不回滚乐观移除
      if (isNetworkSaveError(error)) {
        offlineDelete();
        return;
      }
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
    // 离线队列里尚未落库的条目只在本地存在：不进服务端垃圾桶 RPC，
    // 单独按"丢弃离线草稿"如实计数
    const offlineIds = new Set(readNoteCreates(localStorage).map((op) => op.note.id));
    const serverIds = ids.filter((id) => !offlineIds.has(id));
    const offlineCount = ids.length - serverIds.length;
    // X1：离线删除——草稿直接丢弃，服务端已有笔记入删除队列，联网回放
    const offlineBatchDelete = () => {
      if (offlineCount > 0) ids.forEach((id) => removeNoteCreate(localStorage, id));
      serverIds.forEach((id) => enqueueNoteDelete(localStorage, id));
      refreshPendingOps();
      setNotes((prev) => removeNotes(prev, selectedIds));
      exitSelection();
      toast({
        title:
          offlineCount > 0
            ? `${serverIds.length} 篇已离线删除、${offlineCount} 篇离线草稿已丢弃，联网后自动同步`
            : `已离线删除 ${serverIds.length} 篇笔记，联网后自动同步`,
      });
    };
    if (!isOnline()) {
      offlineBatchDelete();
      return;
    }
    try {
      if (serverIds.length > 0) {
        await mutateTrash("note", serverIds, "soft_delete");
      }
      if (offlineCount > 0) {
        // 丢弃离线草稿要真实生效：同步移出队列并刷新计数，
        // 否则 pendingCreatesAsNotes 会把它们重新合并回列表、联网后被回放插入
        ids.forEach((id) => removeNoteCreate(localStorage, id));
        refreshPendingOps();
      }
      setNotes((prev) => removeNotes(prev, selectedIds));
      exitSelection();
      toast({
        title:
          offlineCount > 0
            ? `${serverIds.length} 篇已移入垃圾箱，${offlineCount} 篇离线草稿已丢弃`
            : `${serverIds.length} 篇笔记已移入垃圾箱`,
      });
    } catch (error) {
      // X1：网络错误按离线删除处理——入队待回放，不回滚乐观移除
      if (isNetworkSaveError(error)) {
        offlineBatchDelete();
        return;
      }
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
    // 排除仍在离线队列、尚未落库的条目：全选后批量删除/置顶对它们必然无效，
    // 却会提示"成功处理 N 篇"，制造假成功
    const pendingIds = new Set(readNoteCreates(localStorage).map((op) => op.note.id));
    selectAll(notes.filter((n) => !pendingIds.has(n.id)).map((n) => n.id));
  };

  // 高亮匹配要遍历每篇笔记的正文 JSON，按 150ms 防抖避免击键卡顿（取数本身已有 300ms 防抖）
  const debouncedHighlight = useDebouncedValue(search, 150);
  const searchMatches = useMemo(() => {
    const query = debouncedHighlight.trim();
    if (!query) return new Map<string, ReturnType<typeof findNoteSearchMatch>>();
    return new Map(notes.map((note) => [note.id, findNoteSearchMatch(note.content, query)]));
  }, [notes, debouncedHighlight]);

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

  const toggleFavoriteById = useCallback(async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ title: "请先登录", variant: "destructive" });
      return;
    }
    if (favoritedIds.has(id)) {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("user_id", user.id)
        .eq("target_type", "note")
        .eq("target_id", id);
      if (error) throw new Error(error.message);
      setFavoritedIds((current) => { const next = new Set(current); next.delete(id); return next; });
      toast({ title: "已取消收藏" });
    } else {
      const { error } = await supabase
        .from("favorites")
        .insert({ user_id: user.id, target_type: "note", target_id: id });
      if (error) throw new Error(error.message);
      setFavoritedIds((current) => new Set(current).add(id));
      toast({ title: "已收藏" });
    }
  }, [supabase, favoritedIds]);

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
        // parent_note_id 在编辑器保存快照里：必须同步递增 content_revision，
        // 否则其他标签页的编辑器下次自动保存会把这次移动静默还原
        const { data: current } = await supabase
          .from("notes")
          .select("content_revision")
          .eq("id", noteId)
          .single();
        const { error } = await supabase
          .from("notes")
          .update({
            parent_note_id: nextParentId,
            content_revision: Number(current?.content_revision ?? 0) + 1,
          })
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
      {/* U03：移动端顶栏已显示分区名，内容区大标题隐藏 */}
      <div className="hidden md:block">
      <PageHeader
        icon={FileText}
        title={
          <>
            笔记
            {!online && (
              <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground" role="status">
                <WifiOff className="h-3.5 w-3.5" />
                离线中{pendingOps > 0 ? ` · ${pendingOps} 篇待同步` : ""}
              </span>
            )}
          </>
        }
        description="记录你的想法和阅读笔记"
        actions={
          <>
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
          </>
        }
      />
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

          {/* D00 迁移表：图谱入口收进笔记页工具行（仍到 /graph，保留其内部切换） */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => router.push("/graph")}
            title="图谱视图"
          >
            <Network className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">图谱</span>
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
                <NoteFavoritesContext.Provider value={{ favoritedIds, toggleFavorite: toggleFavoriteById }}>
                  <div className="grid gap-2 sm:gap-3">
                    {section.items.map((note) => (
                      <NoteCard key={note.id} {...noteCardProps(note)} />
                    ))}
                  </div>
                </NoteFavoritesContext.Provider>
              </section>
            ))}
          </div>
        ) : (
          <NoteFavoritesContext.Provider value={{ favoritedIds, toggleFavorite: toggleFavoriteById }}>
            <div className="grid gap-2 sm:gap-3">
              {notes.map((note) => (
                <NoteCard key={note.id} {...noteCardProps(note)} />
              ))}
            </div>
          </NoteFavoritesContext.Provider>
        )
      ) : (
        <NoteFavoritesContext.Provider value={{ favoritedIds, toggleFavorite: toggleFavoriteById }}>
          <div className="grid gap-2 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((note) => (
              <NoteCard key={note.id} {...noteCardProps(note)} />
            ))}
          </div>
        </NoteFavoritesContext.Provider>
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
