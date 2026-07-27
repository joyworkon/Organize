"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListItemContextMenu } from "@/components/context-menu/context-menu-list";
import { cn } from "@/lib/utils";
import type { Note, Tag, NoteWithTags } from "@organize/shared";
import {
  Pin,
  MoreVertical,
  Download,
  Sparkles,
  History,
  Share2,
  Trash2,
  Link2,
} from "lucide-react";
import { ShareDialog } from "@/components/share/share-dialog";
import { exportNoteToMarkdown } from "@/components/share/export-button";
import { NoteHistoryDialog } from "@/components/notes/note-history-dialog";
import { AutoTagDialog } from "@/components/tags/auto-tag-dialog";
import { TagBadge } from "@/components/tags/tag-badge";
import { nodeText } from "@/components/editor/block-utils";

export type NoteViewMode = "card" | "list";

type DialogKind = "export" | "autotag" | "history" | "share" | null;

interface NoteCardProps {
  note: NoteWithTags;
  view: NoteViewMode;
  selected?: boolean;
  onSelectChange?: (id: string, checked: boolean) => void;
  selectionMode?: boolean;
  onTogglePin?: (id: string, pinned: boolean) => void;
  onDelete?: (id: string) => void;
  onTagsApplied?: (id: string, names: string[]) => void;
}

function extractExcerpt(content: Record<string, unknown> | null, maxLength = 120): string {
  if (!content) return "";
  const text = nodeText(content as any);
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

export function NoteCard({
  note,
  view,
  selected = false,
  onSelectChange,
  selectionMode = false,
  onTogglePin,
  onDelete,
  onTagsApplied,
}: NoteCardProps) {
  const router = useRouter();
  const showCheckbox = Boolean(onSelectChange);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const excerpt = useMemo(() => extractExcerpt(note.content), [note.content]);
  const tags = note.tags || [];

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (showCheckbox) {
      e.preventDefault();
      e.stopPropagation();
      onSelectChange!(note.id, !selected);
      return;
    }
    router.push(`/notes/${note.id}`);
  };

  const handleLinkClick = (e: React.MouseEvent) => {
    if (showCheckbox) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleDelete = () => {
    onDelete?.(note.id);
  };

  const handleTogglePin = () => {
    onTogglePin?.(note.id, !note.is_pinned);
  };

  const Title = (
    <h3
      className={cn(
        "font-medium leading-snug",
        view === "card" ? "line-clamp-2" : "line-clamp-1 flex-1 min-w-0"
      )}
    >
      {note.title || "无标题"}
    </h3>
  );

  const Dialogs = (
    <>
      <AutoTagDialog
        resourceType="note"
        resourceId={note.id}
        triggerSize="sm"
        onApplied={(names) => {
          onTagsApplied?.(note.id, names);
          setDialog(null);
        }}
        open={dialog === "autotag"}
        onOpenChange={(o) => setDialog(o ? "autotag" : null)}
      />

      <NoteHistoryDialog
        noteId={note.id}
        triggerSize="sm"
        open={dialog === "history"}
        onOpenChange={(o) => setDialog(o ? "history" : null)}
      />

      <ShareDialog
        resourceType="note"
        resourceId={note.id}
        triggerSize="sm"
        open={dialog === "share"}
        onOpenChange={(o) => setDialog(o ? "share" : null)}
      />
    </>
  );

  const MoreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={stop}
          className={cn(
            "p-1 rounded hover:bg-accent text-muted-foreground shrink-0",
            !selectionMode && !showCheckbox && "opacity-0 group-hover:opacity-100"
          )}
          title="更多操作"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stop}>
        {onTogglePin && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(note.id, !note.is_pinned);
            }}
          >
            <Pin className="h-3.5 w-3.5 mr-2" />
            {note.is_pinned ? "取消置顶" : "置顶"}
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            exportNoteToMarkdown(note.id, note.title || undefined);
          }}
        >
          <Download className="h-3.5 w-3.5 mr-2" />
          导出 Markdown
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            setDialog("autotag");
          }}
        >
          <Sparkles className="h-3.5 w-3.5 mr-2 text-purple-500" />
          AI 自动打标签
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            setDialog("history");
          }}
        >
          <History className="h-3.5 w-3.5 mr-2" />
          历史版本
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            setDialog("share");
          }}
        >
          <Share2 className="h-3.5 w-3.5 mr-2" />
          分享
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(note.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5 mr-2" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const CheckboxEl = showCheckbox && (
    <div onClick={stop} className="flex items-center">
      <Checkbox
        checked={selected}
        onCheckedChange={(c) => onSelectChange!(note.id, c === true)}
        className={cn(!selectionMode && "opacity-0 group-hover:opacity-100")}
      />
    </div>
  );

  const ContentWrapper = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    if (showCheckbox) {
      return (
        <div className={className} onClick={handleLinkClick}>
          {children}
        </div>
      );
    }
    return (
      <Link href={`/notes/${note.id}`} className={className}>
        {children}
      </Link>
    );
  };

  if (view === "list") {
    return (
      <>
        <ListItemContextMenu
          type="note"
          item={note}
          onDelete={onDelete ? handleDelete : undefined}
          onTogglePin={onTogglePin ? handleTogglePin : undefined}
        >
        <Card
          onClick={handleCardClick}
          className={cn(
            "group cursor-pointer transition-colors duration-150 relative overflow-hidden",
            showCheckbox ? "hover:bg-primary/5" : "hover:bg-accent",
            selected && "ring-2 ring-primary",
            note.is_pinned && "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:bg-primary"
          )}
        >
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              {CheckboxEl}
              {note.is_pinned && (
                <Pin className="h-3.5 w-3.5 text-primary fill-primary shrink-0" />
              )}
              <ContentWrapper className="flex-1 min-w-0 flex items-center gap-2">
                {Title}
                {tags.length > 0 && (
                  <span className="hidden md:flex items-center gap-1 shrink-0">
                    {tags.slice(0, 2).map((tag) => (
                      <TagBadge key={tag.id} tag={tag} className="text-[10px] px-1.5 py-0" />
                    ))}
                    {tags.length > 2 && (
                      <span className="text-xs text-muted-foreground">+{tags.length - 2}</span>
                    )}
                  </span>
                )}
                {note.reading_item && (
                  <span className="hidden lg:flex items-center gap-1 text-xs text-muted-foreground shrink-0 max-w-[25%]">
                    <Link2 className="h-3 w-3" />
                    <span className="truncate">
                      {(note.reading_item as any).title || (note.reading_item as any).url}
                    </span>
                  </span>
                )}
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(note.updated_at).toLocaleDateString("zh-CN")}
                </span>
              </ContentWrapper>
              <div className="flex items-center gap-0.5 shrink-0">
                {MoreMenu}
              </div>
            </div>
            {excerpt && (
              <ContentWrapper className="block mt-1.5 ml-8">
                <p className="text-xs text-muted-foreground line-clamp-1">{excerpt}</p>
              </ContentWrapper>
            )}
          </CardContent>
        </Card>
        </ListItemContextMenu>
        {Dialogs}
      </>
    );
  }

  return (
    <>
      <ListItemContextMenu
        type="note"
        item={note}
        onDelete={onDelete ? handleDelete : undefined}
        onTogglePin={onTogglePin ? handleTogglePin : undefined}
      >
      <Card
        onClick={handleCardClick}
        className={cn(
          "group cursor-pointer transition-colors duration-150 h-full flex flex-col relative overflow-hidden",
          showCheckbox ? "hover:bg-primary/5" : "hover:bg-accent",
          selected && "ring-2 ring-primary",
          note.is_pinned && "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:bg-primary"
        )}
      >
        <CardContent className="p-4 flex-1 flex flex-col">
          <div className="flex items-start gap-2">
            {CheckboxEl}
            {note.is_pinned && (
              <Pin className="h-3.5 w-3.5 text-primary fill-primary shrink-0 mt-0.5" />
            )}
            <ContentWrapper className="flex-1 min-w-0">
              {Title}
            </ContentWrapper>
            {MoreMenu}
          </div>
          {excerpt && (
            <ContentWrapper className="block mt-2">
              <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">{excerpt}</p>
            </ContentWrapper>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground flex-wrap">
            {tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {tags.slice(0, 3).map((tag) => (
                  <TagBadge key={tag.id} tag={tag} className="text-[10px] px-1.5 py-0" />
                ))}
                {tags.length > 3 && (
                  <span className="text-xs text-muted-foreground">+{tags.length - 3}</span>
                )}
              </div>
            )}
            <div className="flex-1" />
            {note.reading_item && (
              <span className="flex items-center gap-1 line-clamp-1">
                <Link2 className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[8rem]">
                  {(note.reading_item as any).title || (note.reading_item as any).url}
                </span>
              </span>
            )}
            <span className="shrink-0">{new Date(note.updated_at).toLocaleDateString("zh-CN")}</span>
          </div>
        </CardContent>
      </Card>
      </ListItemContextMenu>
      {Dialogs}
    </>
  );
}
