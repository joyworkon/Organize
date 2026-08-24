"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import type { NoteWithTags } from "@organize/shared";
import {
  Pin,
  MoreVertical,
  Download,
  Sparkles,
  History,
  Share2,
  Trash2,
  Link2,
  Star,
  FolderInput,
} from "lucide-react";
import { ShareDialog } from "@/components/share/share-dialog";
import { exportNoteToMarkdown } from "@/components/share/export-button";
import { NoteHistoryDialog } from "@/components/notes/note-history-dialog";
import { AutoTagDialog } from "@/components/tags/auto-tag-dialog";
import { TagBadge } from "@/components/tags/tag-badge";
import { nodeText } from "@/components/editor/block-utils";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { NoteSearchMatch } from "@/lib/notes/search-match";

export type NoteViewMode = "card" | "list";

type DialogKind = "export" | "autotag" | "history" | "share" | null;

interface NoteCardProps {
  note: NoteWithTags;
  view: NoteViewMode;
  searchMatch?: NoteSearchMatch | null;
  titleMatched?: boolean;
  selected?: boolean;
  onSelectChange?: (id: string, checked: boolean) => void;
  selectionMode?: boolean;
  onTogglePin?: (id: string, pinned: boolean) => void;
  onDelete?: (id: string) => void;
  onTagsApplied?: (id: string, names: string[]) => void;
  onMove?: (id: string) => void;
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
  searchMatch,
  titleMatched = false,
  selected = false,
  onSelectChange,
  selectionMode = false,
  onTogglePin,
  onDelete,
  onTagsApplied,
  onMove,
}: NoteCardProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const showCheckbox = Boolean(onSelectChange);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);

  const excerpt = searchMatch?.snippet || extractExcerpt(note.content);
  const tags = note.tags || [];
  const href =
    !titleMatched && searchMatch?.blockId
      ? `/notes/${note.id}#block-${encodeURIComponent(searchMatch.blockId)}`
      : `/notes/${note.id}`;
  const Excerpt = searchMatch ? (
    <>
      {excerpt.slice(0, searchMatch.matchStart)}
      <mark className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-900/70">
        {excerpt.slice(searchMatch.matchStart, searchMatch.matchEnd)}
      </mark>
      {excerpt.slice(searchMatch.matchEnd)}
    </>
  ) : (
    excerpt
  );

  useEffect(() => {
    let mounted = true;
    async function checkFavorite() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("favorites")
        .select("id")
        .eq("user_id", user.id)
        .eq("target_type", "note")
        .eq("target_id", note.id)
        .maybeSingle();
      if (mounted) {
        setIsFavorited(!!data);
      }
    }
    checkFavorite();
    return () => { mounted = false; };
  }, [supabase, note.id]);

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isTogglingFavorite) return;
    setIsTogglingFavorite(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "请先登录", variant: "destructive" });
        return;
      }
      if (isFavorited) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("target_type", "note")
          .eq("target_id", note.id);
        if (error) throw error;
        setIsFavorited(false);
        toast({ title: "已取消收藏" });
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({
            user_id: user.id,
            target_type: "note",
            target_id: note.id,
          });
        if (error) throw error;
        setIsFavorited(true);
        toast({ title: "已收藏" });
      }
    } catch {
      toast({ title: "操作失败", variant: "destructive" });
    } finally {
      setIsTogglingFavorite(false);
    }
  };

  const stop = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleCardClick = (e: React.MouseEvent) => {
    if (showCheckbox) {
      e.preventDefault();
      e.stopPropagation();
      onSelectChange!(note.id, !selected);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      window.open(href, "_blank");
      return;
    }
    router.push(href);
  };

  const handleCardAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1 && !showCheckbox) {
      e.preventDefault();
      window.open(href, "_blank");
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
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") stop(e); }}
          className={cn(
            "p-1 rounded hover:bg-accent text-muted-foreground shrink-0",
            !selectionMode && !showCheckbox && "opacity-40 group-hover:opacity-100"
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
          onClick={handleToggleFavorite}
          disabled={isTogglingFavorite}
        >
          <Star className={cn("h-3.5 w-3.5 mr-2", isFavorited && "fill-yellow-500 text-yellow-500")} />
          {isFavorited ? "取消收藏" : "收藏"}
        </DropdownMenuItem>

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

        {onMove && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onMove(note.id);
            }}
          >
            <FolderInput className="h-3.5 w-3.5 mr-2" />
            移动到
          </DropdownMenuItem>
        )}

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
        className={cn(!selectionMode && "opacity-40 group-hover:opacity-100")}
      />
    </div>
  );

  const cardBaseClass = cn(
    "group cursor-pointer transition-colors duration-150 relative overflow-hidden",
    showCheckbox ? "hover:bg-primary/5" : "hover:bg-accent",
    selected && "ring-2 ring-primary",
    note.is_pinned && "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:bg-primary"
  );

  const pinnedIcon = (inline = false) =>
    note.is_pinned && (
      <Pin className={cn("h-3.5 w-3.5 text-primary fill-primary shrink-0", inline && "mt-0.5")} />
    );

  const tagsPreview = (count: number) =>
    tags.length > 0 && (
      <span className="hidden md:flex items-center gap-1 shrink-0">
        {tags.slice(0, count).map((tag) => (
          <TagBadge key={tag.id} tag={tag} size="sm" />
        ))}
        {tags.length > count && (
          <span className="text-xs text-muted-foreground">+{tags.length - count}</span>
        )}
      </span>
    );

  const readingLink = note.reading_item && (
    <span
      className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
      title={(note.reading_item as any).title || (note.reading_item as any).url}
      onClick={stop}
    >
      <Link2 className="h-3 w-3" />
      <span className="hidden lg:inline truncate max-w-[12rem]">
        {(note.reading_item as any).title || (note.reading_item as any).url}
      </span>
    </span>
  );

  const dateBadge = (
    <span className="text-xs text-muted-foreground shrink-0">
      {new Date(note.updated_at).toLocaleDateString("zh-CN")}
    </span>
  );

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
          onMouseDown={handleCardAuxClick}
          className={cn(cardBaseClass)}
        >
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-3">
              {CheckboxEl}
              {pinnedIcon()}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {Title}
                {tagsPreview(2)}
                {readingLink}
                {dateBadge}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {MoreMenu}
              </div>
            </div>
            {excerpt && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-1.5 ml-8">
                {Excerpt}
              </p>
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
        onMouseDown={handleCardAuxClick}
        className={cn(cardBaseClass, "h-full flex flex-col")}
      >
        <CardContent className="p-3 sm:p-4 flex-1 flex flex-col">
          <div className="flex items-start gap-2">
            {CheckboxEl}
            {pinnedIcon(true)}
            <div className="flex-1 min-w-0">
              {Title}
            </div>
            {MoreMenu}
          </div>
          {excerpt && (
            <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed mt-2">
              {Excerpt}
            </p>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground flex-wrap">
            {tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {tags.slice(0, 3).map((tag) => (
                  <TagBadge key={tag.id} tag={tag} size="sm" />
                ))}
                {tags.length > 3 && (
                  <span className="text-xs text-muted-foreground">+{tags.length - 3}</span>
                )}
              </div>
            )}
            <div className="flex-1" />
            {note.reading_item && (
              <span
                className="flex items-center gap-1 line-clamp-1"
                title={(note.reading_item as any).title || (note.reading_item as any).url}
                onClick={stop}
              >
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
