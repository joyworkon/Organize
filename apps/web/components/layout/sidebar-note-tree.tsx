"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuIcon,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderInput,
  Link as LinkIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "@/components/icons";
import { NoteMoveDialog } from "@/components/notes/note-move-dialog";
import { NOTE_DRAG_MIME } from "@/components/notes/note-groups-bar";
import { limitNoteRoots, type NoteTreeItem, type NoteTreeNode } from "@/lib/notes/tree";
import {
  canDropNoteOn,
  flattenNoteTree,
  persistNoteMove,
  persistNoteRename,
  type NoteMoveClient,
  type NoteRenameClient,
} from "@/lib/notes/tree-drop";
import {
  SIDEBAR_TREE_COLLAPSED_EVENT,
  expandTreeIds,
  findTreeAncestorIds,
  loadCollapsedTreeIds,
  toggleCollapsedTreeId,
} from "@/lib/notes/tree-expansion";
import { moveNoteToTrash } from "@/lib/notes/delete-note";
import { createNewNote, describeCreateNoteResult } from "@/lib/notes/create-note";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";

/** 侧栏笔记列表默认只显示的顶层笔记数 */
const SIDEBAR_NOTES_LIMIT = 5;
/** 「查看更多」展开状态的 localStorage 键（每个列表各记各的，分组段用 `键:分组id`） */
export const SIDEBAR_NOTE_TREE_SHOW_ALL_KEY = "organize-sidebar-notes-show-all";

/**
 * 侧栏「笔记」树（从 sidebar.tsx 抽出）：行内「+」新建子页面 /「⋯」与右键同一菜单
 * （打开、新建子页面、重命名、移动到、复制链接、删除）、拖放到另一篇笔记上成为其子页面、
 * 折叠状态 localStorage 记忆、当前打开的笔记自动展开祖先并 scrollIntoView。
 *
 * 触屏（无 hover）下行内按钮常显（max-md:opacity-100）；菜单由自研 ContextMenu 承载，
 * 它只监听右键——「⋯」与 Shift+F10/ContextMenu 键通过在行元素上派发合成 contextmenu
 * 事件复用同一菜单，不另造第二套菜单实现。
 */
export function SidebarNoteTree({
  nodes,
  pathname,
  onNavigate,
  limit = SIDEBAR_NOTES_LIMIT,
  showAllKey = SIDEBAR_NOTE_TREE_SHOW_ALL_KEY,
  emptyText = "还没有笔记",
  allNotes,
  isNoteWritable,
}: {
  nodes: NoteTreeNode[];
  pathname: string;
  onNavigate: () => void;
  /** 顶层最多显示几篇，其余收进「查看更多」 */
  limit?: number;
  /** 「查看更多」展开状态的 localStorage 键（每个列表各记各的） */
  showAllKey?: string;
  emptyText?: string;
  /** 全部未删除笔记的扁平行（「移动到」对话框候选）；缺省用本树展平 */
  allNotes?: NoteTreeItem[];
  /**
   * 行是否可写（重命名/移动/删除/新建子页面）。侧栏树只查当前用户本人笔记，
   * 默认全可写；返回 false 的行菜单只留「打开 / 复制链接」。
   */
  isNoteWritable?: (note: NoteTreeNode) => boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  // 正在拖动的笔记 id：dragover 阶段读不到 dataTransfer.getData，只有 types；
  // dragstart 阶段同源可读，挂在 document 上兼顾从笔记列表卡片拖来的场景
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // ref 与 state 双份：finishRename 可能在同一拍内被 Enter 与 blur 先后触发，ref 判定即时生效
  const renamingIdRef = useRef<string | null>(null);
  const [creatingChildIds, setCreatingChildIds] = useState<ReadonlySet<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set());
  // 删除后本地立刻隐藏（离线入队时服务端行还在，等回放）；树重载后按服务端数据重建
  const [locallyDeletedIds, setLocallyDeletedIds] = useState<ReadonlySet<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState<NoteTreeNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrolledForRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      setShowAll(localStorage.getItem(showAllKey) === "1");
    } catch {
      /* 存储不可用时按默认收起 */
    }
  }, [showAllKey]);
  const toggleShowAll = () => {
    setShowAll((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(showAllKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // 折叠状态：共享 localStorage 键 + 事件跨树实例同步（拖放/新建子页面后展开目标父级
  // 可能落在另一分组段的树实例里）
  useEffect(() => {
    const read = () => setCollapsedIds(loadCollapsedTreeIds(localStorage));
    read();
    window.addEventListener(SIDEBAR_TREE_COLLAPSED_EVENT, read);
    return () => window.removeEventListener(SIDEBAR_TREE_COLLAPSED_EVENT, read);
  }, []);
  const broadcastCollapsed = () =>
    window.dispatchEvent(new CustomEvent(SIDEBAR_TREE_COLLAPSED_EVENT));
  const toggle = (id: string) => {
    setCollapsedIds(toggleCollapsedTreeId(localStorage, id));
    broadcastCollapsed();
  };
  const expandIds = (ids: Iterable<string>) => {
    setCollapsedIds(expandTreeIds(localStorage, ids));
    broadcastCollapsed();
  };

  const activeId = pathname.startsWith("/notes/") ? pathname.slice("/notes/".length) : null;

  // 当前打开的笔记：自动展开所有祖先（只在本树含该笔记时动作）
  useEffect(() => {
    if (!activeId) return;
    const ancestorIds = findTreeAncestorIds(nodes, activeId);
    if (!ancestorIds || ancestorIds.length === 0) return;
    if (!ancestorIds.some((id) => collapsedIds.has(id))) return;
    setCollapsedIds(expandTreeIds(localStorage, ancestorIds));
    window.dispatchEvent(new CustomEvent(SIDEBAR_TREE_COLLAPSED_EVENT));
  }, [activeId, nodes, collapsedIds]);

  // 每个活动笔记只滚一次；祖先还折叠时等展开后的下一轮渲染再滚
  useEffect(() => {
    if (!activeId || lastScrolledForRef.current === activeId) return;
    const ancestorIds = findTreeAncestorIds(nodes, activeId);
    if (!ancestorIds) return;
    if (ancestorIds.some((id) => collapsedIds.has(id))) return;
    lastScrolledForRef.current = activeId;
    containerRef.current
      ?.querySelector(`[data-sidebar-note-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeId, nodes, collapsedIds]);

  useEffect(() => {
    const onDragStart = (event: DragEvent) => {
      const dt = event.dataTransfer;
      if (!dt?.types.includes(NOTE_DRAG_MIME)) return;
      setDraggedNoteId(dt.getData(NOTE_DRAG_MIME) || null);
    };
    const clearDrag = () => setDraggedNoteId(null);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", clearDrag);
    document.addEventListener("drop", clearDrag);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", clearDrag);
      document.removeEventListener("drop", clearDrag);
    };
  }, []);

  const flatItems = useMemo(() => flattenNoteTree(nodes), [nodes]);
  const dialogNotes = allNotes ?? flatItems;
  const { visible, hiddenCount } = limitNoteRoots(nodes, limit, activeId);
  const roots = showAll ? limitNoteRoots(nodes, Number.MAX_SAFE_INTEGER).visible : visible;

  const openNote = (note: NoteTreeNode) => {
    onNavigate();
    router.push(`/notes/${note.id}`);
  };

  const copyLink = async (note: NoteTreeNode) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/notes/${note.id}`);
      toast({ title: "笔记链接已复制" });
    } catch {
      toast({ title: "复制失败", variant: "destructive" });
    }
  };

  const createChild = async (note: NoteTreeNode) => {
    if (creatingChildIds.has(note.id)) return;
    setCreatingChildIds((prev) => new Set(prev).add(note.id));
    try {
      // N02 统一创建服务（离线入队返回 queued，客户端 id 即最终地址）
      const result = await createNewNote(supabase, { parent_note_id: note.id });
      if (result.status === "unauthenticated" || result.status === "failed") {
        toast({ title: describeCreateNoteResult(result), variant: "destructive" });
        return;
      }
      if (result.status === "queued") {
        toast({ title: describeCreateNoteResult(result) });
      }
      // 展开父级让新子页面立刻可见（新笔记成为当前页后祖先自动展开也会兜底）
      expandIds([note.id]);
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      onNavigate();
      router.push(`/notes/${result.noteId}`);
    } finally {
      setCreatingChildIds((prev) => {
        const next = new Set(prev);
        next.delete(note.id);
        return next;
      });
    }
  };

  const startRename = (note: NoteTreeNode) => {
    renamingIdRef.current = note.id;
    setRenamingId(note.id);
  };
  const finishRename = (note: NoteTreeNode, raw: string, commit: boolean) => {
    if (renamingIdRef.current !== note.id) return;
    renamingIdRef.current = null;
    setRenamingId(null);
    if (!commit) return;
    const title = raw.trim();
    if (!title || title === (note.title || "").trim()) return;
    void (async () => {
      try {
        await persistNoteRename(supabase as unknown as NoteRenameClient, note.id, title, () => {
          window.dispatchEvent(new CustomEvent("organize:notes-changed"));
        });
        toast({ title: "已重命名" });
      } catch (error) {
        toast({
          title: "重命名失败",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      }
    })();
  };

  // 与「移动到…」对话框同一条保存路径（persistNoteMove）：成功后展开目标父级，
  // 失败 toast 且树保持原样（侧栏不做乐观更新，重载只发生在写库成功后）
  const moveNote = async (noteId: string, nextParentId: string | null) => {
    const oldParentId = dialogNotes.find((n) => n.id === noteId)?.parent_note_id ?? null;
    if (nextParentId === oldParentId) return;
    try {
      await persistNoteMove(supabase as unknown as NoteMoveClient, noteId, nextParentId, () => {
        window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      });
      toast({ title: "已移动" });
      if (nextParentId) expandIds([nextParentId]);
    } catch (error) {
      toast({
        title: "移动失败",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
      throw error; // 移动对话框内联展示错误并允许重试；拖放调用方 catch 后不再处理
    }
  };

  const deleteNote = async (note: NoteTreeNode) => {
    if (deletingIds.has(note.id)) return;
    if (!confirm("将这篇笔记移入垃圾箱？之后可以恢复。")) return;
    setDeletingIds((prev) => new Set(prev).add(note.id));
    try {
      const result = await moveNoteToTrash(note.id);
      setLocallyDeletedIds((prev) => new Set(prev).add(note.id));
      toast({
        title: result === "queued" ? "已离线删除，联网后自动同步" : "笔记已移入垃圾箱",
      });
      // mutateTrash 成功时已自行广播 notes-changed；离线入队路径补一次让其它视图刷新
      if (result === "queued") {
        window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      }
      if (pathname === `/notes/${note.id}`) {
        onNavigate();
        router.push("/notes");
      }
    } catch (error) {
      toast({
        title: "删除失败",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(note.id);
        return next;
      });
    }
  };

  const renderNodes = (branch: NoteTreeNode[], depth: number): ReactNode => (
    <div className="flex flex-col gap-1">
      {branch.map((note) => {
        const hasChildren = note.children.length > 0;
        const childrenOpen = !collapsedIds.has(note.id);
        const active = pathname === `/notes/${note.id}`;
        const renaming = renamingId === note.id;
        const busy = creatingChildIds.has(note.id) || deletingIds.has(note.id);
        const writable = isNoteWritable ? isNoteWritable(note) : true;
        return (
          <div key={note.id}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  className={cn(
                    "group flex min-w-0 items-center rounded-md text-sm transition-colors",
                    active
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    dropTargetId === note.id && "bg-primary/10 ring-1 ring-primary"
                  )}
                  style={{ paddingLeft: `${8 + Math.min(depth, 6) * 14}px` }}
                  data-sidebar-note-id={note.id}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(NOTE_DRAG_MIME)) return;
                    if (!canDropNoteOn(flatItems, draggedNoteId, note.id)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTargetId(note.id);
                  }}
                  onDragLeave={() =>
                    setDropTargetId((current) => (current === note.id ? null : current))
                  }
                  onDrop={(event) => {
                    const noteId = event.dataTransfer.getData(NOTE_DRAG_MIME);
                    setDropTargetId(null);
                    if (!noteId || !canDropNoteOn(flatItems, noteId, note.id)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    void moveNote(noteId, note.id).catch(() => {
                      /* 失败已 toast，树保持原样 */
                    });
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.key === "F10" && event.shiftKey) ||
                      event.key === "ContextMenu"
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      openRowContextMenu(event.currentTarget, rect.left + 16, rect.bottom + 4);
                    }
                  }}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-background/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => toggle(note.id)}
                      aria-label={childrenOpen ? "收起子页面" : "展开子页面"}
                      aria-expanded={childrenOpen}
                    >
                      {childrenOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <span className="h-6 w-6 shrink-0" />
                  )}
                  {renaming ? (
                    <input
                      autoFocus
                      defaultValue={note.title || ""}
                      placeholder="无标题笔记"
                      aria-label={`重命名 ${note.title || "无标题笔记"}`}
                      className="min-w-0 flex-1 rounded border bg-background px-1.5 py-1 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.preventDefault()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          finishRename(note, event.currentTarget.value, true);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          finishRename(note, event.currentTarget.value, false);
                        }
                      }}
                      onBlur={(event) => finishRename(note, event.currentTarget.value, true)}
                    />
                  ) : (
                    <>
                      <Link
                        href={`/notes/${note.id}`}
                        onClick={onNavigate}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(NOTE_DRAG_MIME, note.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded py-1.5 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={note.title || "无标题笔记"}
                      >
                        <span className="shrink-0">{note.icon || "📄"}</span>
                        <span className="truncate">{note.title || "无标题笔记"}</span>
                      </Link>
                      {/* 行内操作：悬停 / 键盘聚焦行时淡入；当前行常显；触屏（max-md）常显 */}
                      <span
                        className={cn(
                          "ml-auto flex shrink-0 items-center gap-0.5 pr-1 transition-opacity",
                          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100",
                          active && "opacity-100"
                        )}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="新建子页面"
                          aria-label="新建子页面"
                          disabled={busy}
                          className="h-6 w-6 min-h-6 min-w-6 rounded p-0 hover:bg-background/50 md:min-h-6 md:min-w-6"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void createChild(note);
                          }}
                        >
                          {creatingChildIds.has(note.id) ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="更多操作"
                          aria-label="更多操作"
                          className="h-6 w-6 min-h-6 min-w-6 rounded p-0 hover:bg-background/50 md:min-h-6 md:min-w-6"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const row = event.currentTarget.closest("[data-sidebar-note-id]");
                            if (!(row instanceof HTMLElement)) return;
                            const rect = event.currentTarget.getBoundingClientRect();
                            openRowContextMenu(row, rect.left, rect.bottom + 4);
                          }}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => openNote(note)}>
                  <ContextMenuIcon>
                    <FileText className="h-4 w-4" />
                  </ContextMenuIcon>
                  打开
                </ContextMenuItem>
                {writable && (
                  <>
                    <ContextMenuItem onSelect={() => void createChild(note)} disabled={busy}>
                      <ContextMenuIcon>
                        <Plus className="h-4 w-4" />
                      </ContextMenuIcon>
                      新建子页面
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => startRename(note)} disabled={busy}>
                      <ContextMenuIcon>
                        <Pencil className="h-4 w-4" />
                      </ContextMenuIcon>
                      重命名
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => setMoveTarget(note)} disabled={busy}>
                      <ContextMenuIcon>
                        <FolderInput className="h-4 w-4" />
                      </ContextMenuIcon>
                      移动到
                    </ContextMenuItem>
                  </>
                )}
                <ContextMenuItem onSelect={() => void copyLink(note)}>
                  <ContextMenuIcon>
                    <LinkIcon className="h-4 w-4" />
                  </ContextMenuIcon>
                  复制链接
                </ContextMenuItem>
                {writable && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive focus:bg-destructive/10"
                      onSelect={() => void deleteNote(note)}
                      disabled={busy}
                    >
                      <ContextMenuIcon className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </ContextMenuIcon>
                      删除
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
            {hasChildren && childrenOpen && renderNodes(note.children, depth + 1)}
          </div>
        );
      })}
    </div>
  );

  const liveRoots = useMemo(() => {
    if (locallyDeletedIds.size === 0) return roots;
    const prune = (branch: NoteTreeNode[]): NoteTreeNode[] =>
      branch
        .filter((n) => !locallyDeletedIds.has(n.id))
        .map((n) => ({ ...n, children: prune(n.children) }));
    return prune(roots);
  }, [roots, locallyDeletedIds]);

  if (nodes.length === 0) {
    return <p className="px-3 py-1.5 text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div ref={containerRef}>
      {renderNodes(liveRoots, 0)}
      {(hiddenCount > 0 || showAll) && nodes.length > limit && (
        <div className="mt-0.5 flex items-center justify-between gap-2 pl-[30px] pr-2">
          <button
            type="button"
            onClick={toggleShowAll}
            aria-expanded={showAll}
            className="py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showAll ? "收起" : `查看更多（${hiddenCount}）`}
          </button>
          <Link href="/notes" onClick={onNavigate} className="py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
            全部笔记
          </Link>
        </div>
      )}
      {moveTarget && (
        <NoteMoveDialog
          open
          onOpenChange={(open) => {
            if (!open) setMoveTarget(null);
          }}
          noteId={moveTarget.id}
          noteTitle={moveTarget.title || "无标题笔记"}
          currentParentId={moveTarget.parent_note_id ?? null}
          notes={dialogNotes}
          onConfirm={(parentId) => moveNote(moveTarget.id, parentId)}
        />
      )}
    </div>
  );
}

/**
 * 「⋯」按钮与 Shift+F10/ContextMenu 键复用右键菜单：自研 ContextMenu 只监听
 * contextmenu 事件，在行元素上派发一个合成事件即可打开同一菜单（不新造菜单实现）。
 */
function openRowContextMenu(row: HTMLElement, x: number, y: number) {
  row.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y })
  );
}
