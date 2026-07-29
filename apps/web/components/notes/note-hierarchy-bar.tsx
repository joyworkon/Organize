"use client";

import Link from "next/link";
import { Check, ChevronDown, ChevronRight, FileText, Search } from "lucide-react";
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
  onParentChange: (parentId: string | null) => void;
}

export function NoteHierarchyBar({
  noteId,
  title,
  icon,
  parentNoteId,
  notes,
  onParentChange,
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

  return (
    <div className="note-hierarchy-bar">
      <Link href="/notes" className="note-hierarchy-root">
        <FileText className="h-4 w-4" />
        笔记
      </Link>
      {[...ancestors, { id: noteId, title, icon }].map((note, index, path) => (
        <span key={note.id} className="contents">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          {index === path.length - 1 ? (
            <span className="note-hierarchy-current" title={note.title || "无标题笔记"}>
              <span>{note.icon || "📄"}</span>
              {note.title || "无标题笔记"}
            </span>
          ) : (
            <Link
              href={`/notes/${note.id}`}
              className="note-hierarchy-link"
              title={note.title || "无标题笔记"}
            >
              <span>{note.icon || "📄"}</span>
              {note.title || "无标题笔记"}
            </Link>
          )}
        </span>
      ))}

      <Popover onOpenChange={(open) => !open && setQuery("")}>
        <PopoverTrigger asChild>
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
          <div className="note-parent-options">
            <button
              type="button"
              className={cn(!parentNoteId && "is-active")}
              onClick={() => onParentChange(null)}
            >
              <span>📄</span>
              <span>顶层笔记</span>
              {!parentNoteId && <Check className="h-4 w-4" />}
            </button>
            {candidates.map((note) => (
              <button
                key={note.id}
                type="button"
                className={cn(parentNoteId === note.id && "is-active")}
                onClick={() => onParentChange(note.id)}
              >
                <span>{note.icon || "📄"}</span>
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
