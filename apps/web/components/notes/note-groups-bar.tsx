"use client";

import { useState } from "react";
import type { NoteGroup } from "@organize/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from "@/components/icons";
import { UNGROUPED_KEY } from "@/lib/notes/groups";
import { cn } from "@/lib/utils";

export const NOTE_DRAG_MIME = "application/x-organize-note";

/**
 * 笔记页分组条：「全部 / 各分组 / 未分组」筛选，分组可改名、删除；
 * 笔记卡片可直接拖到某个分组上归类（拖到「未分组」= 移出分组）。
 */
export function NoteGroupsBar({
  groups,
  counts,
  active,
  onActiveChange,
  onCreate,
  onRename,
  onDelete,
  onDropNote,
  onAutoGroup,
}: {
  groups: NoteGroup[];
  /** key（分组 id / UNGROUPED_KEY / "all"）→ 篇数 */
  counts: Map<string, number>;
  active: string;
  onActiveChange: (key: string) => void;
  onCreate: () => void;
  onRename: (group: NoteGroup) => void;
  onDelete: (group: NoteGroup) => void;
  onDropNote: (noteId: string, groupId: string | null) => void;
  onAutoGroup: () => void;
}) {
  const [dropKey, setDropKey] = useState<string | null>(null);

  const chip = (key: string, label: string, group?: NoteGroup) => {
    const selected = active === key;
    const droppable = key !== "all";
    return (
      <div
        key={key}
        className={cn(
          "group/chip flex shrink-0 items-center rounded-full border text-sm transition-colors",
          selected ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted",
          dropKey === key && "ring-2 ring-primary ring-offset-1"
        )}
        onDragOver={(event) => {
          if (!droppable || !event.dataTransfer.types.includes(NOTE_DRAG_MIME)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropKey(key);
        }}
        onDragLeave={() => setDropKey((k) => (k === key ? null : k))}
        onDrop={(event) => {
          const noteId = event.dataTransfer.getData(NOTE_DRAG_MIME);
          setDropKey(null);
          if (!droppable || !noteId) return;
          event.preventDefault();
          onDropNote(noteId, key === UNGROUPED_KEY ? null : key);
        }}
        data-group-chip={key}
      >
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onActiveChange(key)}
          className="flex items-center gap-1.5 py-1 pl-3 pr-3"
        >
          <span className="max-w-[10rem] truncate">{label}</span>
          <span className={cn("text-xs", selected ? "text-background/70" : "text-muted-foreground")}>{counts.get(key) ?? 0}</span>
        </button>
        {group && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`分组「${group.name}」操作`}
                className={cn(
                  "-ml-1.5 mr-1 grid h-6 w-6 place-items-center rounded-full opacity-60 hover:opacity-100",
                  selected ? "hover:bg-background/20" : "hover:bg-background"
                )}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => onRename(group)}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(group)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                删除分组
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  return (
    <div className="flex items-center gap-2" aria-label="笔记分组">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
        {chip("all", "全部")}
        {groups.map((g) => chip(g.id, g.name, g))}
        {groups.length > 0 && chip(UNGROUPED_KEY, "未分组")}
        <Button variant="ghost" size="sm" className="shrink-0 gap-1 text-muted-foreground" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" />
          新建分组
        </Button>
      </div>
      <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={onAutoGroup}>
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
        自动分组
      </Button>
    </div>
  );
}
