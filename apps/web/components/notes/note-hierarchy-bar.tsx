"use client";

import Link from "next/link";
import { Check, ChevronDown, ChevronRight, FileText, Search } from "@/components/icons";
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getNoteAncestors,
  getParentCandidates,
  type NoteTreeItem,
} from "@/lib/notes/tree";
import { cn } from "@/lib/utils";

interface NoteHierarchyBarProps {
  noteId: string;
  title: string;
  icon: string | null;
  parentNoteId: string | null;
  notes: NoteTreeItem[];
  /** N03：viewer 不可变更父页面（不传则入口整体隐藏） */
  onParentChange?: (parentId: string | null) => void;
  /** 笔记树加载失败提示；有父页面但父链未知时不再冒充顶层笔记，弹层候选提示可能不完整 */
  loadError?: string | null;
  /** 点击「重试」重新加载笔记树 */
  onRetry?: () => void;
}

interface HierarchySegment {
  id: string;
  title: string | null;
  icon: string | null;
  /** 笔记树加载失败时的父链占位段（非链接，仅提示存在未知上级） */
  loadFailed?: boolean;
}

export function NoteHierarchyBar({
  noteId,
  title,
  icon,
  parentNoteId,
  notes,
  onParentChange,
  loadError,
  onRetry,
}: NoteHierarchyBarProps) {
  const [query, setQuery] = useState("");
  const ancestors = useMemo(
    () => getNoteAncestors(notes, noteId),
    [noteId, notes]
  );
  const candidates = useMemo(
    () =>
      getParentCandidates(notes, noteId).filter((note) =>
        (note.title || "无标题笔记").toLowerCase().includes(query.toLowerCase())
      ),
    [noteId, notes, query]
  );
  // 快照为空但有父页面 = 树没加载出来而非真顶层：插一段占位，不冒充顶层笔记
  const ancestorLoadFailed = Boolean(loadError && parentNoteId && ancestors.length === 0);

  const path: HierarchySegment[] = [
    ...ancestors,
    ...(ancestorLoadFailed
      ? [{ id: "note-tree-load-error", title: null, icon: null, loadFailed: true }]
      : []),
    { id: noteId, title, icon },
  ];

  return (
    <div className="note-hierarchy-bar">
      <Link href="/notes" className="note-hierarchy-root">
        <FileText className="h-4 w-4" />
        笔记
      </Link>
      {path.map((note, index) => (
        <span key={note.id} className="contents">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          {index === path.length - 1 ? (
            <span className="note-hierarchy-current" title={note.title || "无标题笔记"}>
              <span className="note-hierarchy-icon">{note.icon || <FileText className="h-4 w-4 text-muted-foreground" />}</span>
              <span className="note-hierarchy-label">{note.title || "无标题笔记"}</span>
            </span>
          ) : note.loadFailed ? (
            <span
              className="note-hierarchy-placeholder"
              title="上级页面加载失败"
              aria-label="上级页面加载失败"
            >
              上级页面
            </span>
          ) : (
            <Link
              href={`/notes/${note.id}`}
              className="note-hierarchy-link"
              title={note.title || "无标题笔记"}
            >
              <span className="note-hierarchy-icon">{note.icon || <FileText className="h-4 w-4 text-muted-foreground" />}</span>
              <span className="note-hierarchy-label">{note.title || "无标题笔记"}</span>
            </Link>
          )}
        </span>
      ))}

      <Popover onOpenChange={(open) => !open && setQuery("")}>
        <PopoverTrigger asChild disabled={!onParentChange}>
          <button
            type="button"
            className="note-hierarchy-move"
            title="更改父页面"
            aria-label="更改父页面"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <div className="note-parent-search">
            <Search className="h-4 w-4" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索父页面..."
            />
          </div>
          {loadError && (
            <div className="note-tree-load-error" role="alert">
              <span>{loadError}，候选列表可能不完整</span>
              {onRetry && (
                <button type="button" onClick={onRetry}>
                  重试
                </button>
              )}
            </div>
          )}
          <div className="note-parent-options">
            <button
              type="button"
              className={cn(!parentNoteId && "is-active")}
              onClick={() => onParentChange?.(null)}
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>顶层笔记</span>
              {!parentNoteId && <Check className="h-4 w-4" />}
            </button>
            {candidates.map((note) => (
              <button
                key={note.id}
                type="button"
                className={cn(parentNoteId === note.id && "is-active")}
                onClick={() => onParentChange?.(note.id)}
              >
                <span>{note.icon || <FileText className="h-4 w-4 text-muted-foreground" />}</span>
                <span>{note.title || "无标题笔记"}</span>
                {parentNoteId === note.id && <Check className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
