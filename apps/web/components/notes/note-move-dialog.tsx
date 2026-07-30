"use client";

import { useMemo, useState, useEffect } from "react";
import { Check, Search, FolderInput, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildNoteTree,
  getParentCandidates,
  type NoteTreeItem,
  type NoteTreeNode,
} from "@/lib/notes/tree";

interface NoteMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  noteTitle: string;
  currentParentId: string | null;
  /** 全部笔记（未删除），用于构建候选 */
  notes: NoteTreeItem[];
  /**
   * 确认移动回调。应当返回 Promise：成功 resolve，失败 reject（会在对话框内展示错误并允许重试）。
   * 父组件负责做乐观更新/回滚；对话框内部只关心 disabled 和错误展示。
   */
  onConfirm: (parentId: string | null) => Promise<void>;
}

export function NoteMoveDialog({
  open,
  onOpenChange,
  noteId,
  noteTitle,
  currentParentId,
  notes,
  onConfirm,
}: NoteMoveDialogProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(currentParentId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(currentParentId);
      setSubmitting(false);
      setError(null);
    }
  }, [open, currentParentId]);

  // 搜索模式下用扁平列表（带祖先路径），否则用缩进树
  const candidates = useMemo(
    () => getParentCandidates(notes, noteId),
    [notes, noteId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((n) =>
      (n.title || "无标题笔记").toLowerCase().includes(q)
    );
  }, [candidates, query]);

  const tree = useMemo(() => {
    // 仅展示可用的候选节点（已经排除自己+后代）
    const candidateIds = new Set(candidates.map((n) => n.id));
    const pruned: NoteTreeItem[] = candidates.map((n) => {
      // 不在候选集中的 parent 视为已断开，降级成根
      return {
        ...n,
        parent_note_id:
          n.parent_note_id && candidateIds.has(n.parent_note_id)
            ? n.parent_note_id
            : null,
      };
    });
    return buildNoteTree(pruned);
  }, [candidates]);

  const handleConfirm = async () => {
    if (selected === currentParentId) {
      onOpenChange(false);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(selected);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "移动失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-5 w-5" />
            移动到
          </DialogTitle>
          <DialogDescription className="line-clamp-1">
            将「{noteTitle || "无标题笔记"}」移动到其他页面下方，或设为顶层笔记。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索页面..."
              className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="max-h-[320px] overflow-y-auto rounded-md border">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                selected === null && "bg-accent text-accent-foreground"
              )}
            >
              <span>🏠</span>
              <span className="flex-1">顶层笔记（无父页面）</span>
              {selected === null && <Check className="h-4 w-4" />}
            </button>
            <div className="-mx-1 h-px bg-border my-1 mx-3" />

            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                没有匹配的页面
              </div>
            ) : query ? (
              <FlatList
                items={filtered}
                allNotes={notes}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <TreeList
                nodes={tree}
                selected={selected}
                onSelect={setSelected}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {selected === currentParentId ? "保持位置" : "移动"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FlatList({
  items,
  allNotes,
  selected,
  onSelect,
}: {
  items: NoteTreeItem[];
  allNotes: NoteTreeItem[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const byId = new Map(allNotes.map((n) => [n.id, n]));
  const ancestorPath = (id: string): string => {
    const parts: string[] = [];
    let cur = byId.get(id)?.parent_note_id || null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const p = byId.get(cur);
      if (!p) break;
      parts.unshift(p.title || "无标题笔记");
      cur = p.parent_note_id || null;
    }
    return parts.join(" / ");
  };
  return (
    <>
      {items.map((note) => {
        const path = ancestorPath(note.id);
        return (
          <button
            key={note.id}
            type="button"
            onClick={() => onSelect(note.id)}
            className={cn(
              "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
              selected === note.id && "bg-accent text-accent-foreground"
            )}
          >
            <span className="shrink-0 mt-0.5">{note.icon || "📄"}</span>
            <span className="flex-1 min-w-0">
              <span className="block truncate">{note.title || "无标题笔记"}</span>
              {path && (
                <span className="block truncate text-xs text-muted-foreground">
                  {path}
                </span>
              )}
            </span>
            {selected === note.id && <Check className="h-4 w-4 mt-0.5" />}
          </button>
        );
      })}
    </>
  );
}

function TreeList({
  nodes,
  selected,
  onSelect,
  depth = 0,
}: {
  nodes: NoteTreeNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((note) => (
        <div key={note.id}>
          <button
            type="button"
            onClick={() => onSelect(note.id)}
            className={cn(
              "flex w-full items-center gap-2 py-2 pr-3 text-left text-sm transition-colors hover:bg-accent",
              selected === note.id && "bg-accent text-accent-foreground"
            )}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
          >
            <span className="shrink-0">{note.icon || "📄"}</span>
            <span className="flex-1 truncate">{note.title || "无标题笔记"}</span>
            {selected === note.id && <Check className="h-4 w-4" />}
          </button>
          {note.children.length > 0 && (
            <TreeList
              nodes={note.children}
              selected={selected}
              onSelect={onSelect}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </>
  );
}
