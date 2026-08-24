"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { extractLinksFromContent } from "@/lib/note-links";
import { BookOpen, ArrowLeftRight, ExternalLink, Loader2 } from "lucide-react";
import type { ReadingItem } from "@organize/shared";
import type { HighlightReferenceState } from "@/lib/reading/highlight-references";

interface BacklinkNote {
  id: string;
  title: string | null;
  created_at: string;
}

interface BacklinksProps {
  noteId: string;
  readingItemId?: string | null;
}

export function Backlinks({ noteId, readingItemId }: BacklinksProps) {
  const supabase = useMemo(() => createClient(), []);
  const [backlinkNotes, setBacklinkNotes] = useState<BacklinkNote[]>([]);
  const [readingItem, setReadingItem] = useState<ReadingItem | null>(null);
  const [highlightReferences, setHighlightReferences] = useState<HighlightReferenceState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const [notesResult, readingResult, referenceResult, readingStateResult] = await Promise.all([
        supabase
          .from("notes")
          .select("id, title, content, created_at")
          .eq("user_id", user.id)
          .neq("id", noteId)
          .order("updated_at", { ascending: false })
          .limit(100),
        readingItemId
          ? supabase
              .from("reading_items")
              .select("*")
              .eq("id", readingItemId)
              .single()
          : Promise.resolve({ data: null, error: null }),
        supabase.rpc("get_highlight_reference_states", { p_note_id: noteId }),
        supabase.rpc("get_linked_content_states", {
          p_reading_item_id: readingItemId || null,
          p_note_id: noteId,
        }),
      ]);

      if (!active) return;

      if (!notesResult.error && notesResult.data) {
        const linked: BacklinkNote[] = [];
        for (const note of notesResult.data) {
          const links = extractLinksFromContent(note.content);
          if (links.some((l) => l.type === "note" && l.url === noteId)) {
            linked.push({
              id: note.id,
              title: note.title,
              created_at: note.created_at,
            });
            if (linked.length >= 20) break;
          }
        }
        setBacklinkNotes(linked);
      }

      if (readingItemId && !readingResult.error && readingResult.data) {
        setReadingItem(readingResult.data as ReadingItem);
      }
      if (!referenceResult.error && referenceResult.data) {
        setHighlightReferences(referenceResult.data as HighlightReferenceState[]);
      }
      if (
        readingItemId &&
        !readingResult.data &&
        !readingStateResult.error &&
        readingStateResult.data?.[0]
      ) {
        setHighlightReferences((current) => [
          {
            highlight_id: `note-reading:${noteId}`,
            reading_item_id: readingItemId,
            reading_title: readingStateResult.data[0].reading_title,
            reading_state: readingStateResult.data[0].reading_state,
            note_id: noteId,
            note_title: readingStateResult.data[0].note_title,
            note_state: readingStateResult.data[0].note_state,
            task_id: null,
            task_title: null,
            task_state: null,
          },
          ...current,
        ]);
      }

      setLoading(false);
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [noteId, readingItemId, supabase]);

  const hasReading = !!readingItem;
  const hasBacklinks = backlinkNotes.length > 0;
  const linkedTasks = highlightReferences.filter((reference) => reference.task_id);
  const hasUnavailableReading = !!readingItemId && !readingItem;

  if (!loading && !hasReading && !hasUnavailableReading && !hasBacklinks && linkedTasks.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 pt-6 border-t">
      {loading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {hasReading && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            关联阅读
          </h3>
          <Link
            href={`/library/${readingItem.id}`}
            className="flex items-start gap-2 p-2 rounded hover:bg-accent transition-colors group"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                {readingItem.title || "无标题文章"}
              </p>
              {readingItem.url && (
                <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {(() => {
                    try {
                      return new URL(readingItem.url).hostname;
                    } catch {
                      return readingItem.url;
                    }
                  })()}
                </p>
              )}
            </div>
          </Link>
        </div>
      )}

      {!loading && hasUnavailableReading && (
        <div className="mb-6">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            关联阅读
          </h3>
          <div className="rounded border border-dashed p-2 text-sm text-muted-foreground">
            {highlightReferences[0]?.reading_state === "deleted"
              ? "来源阅读已移入垃圾箱"
              : "来源阅读引用已失效"}
          </div>
        </div>
      )}

      {linkedTasks.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            高亮关联任务
          </h3>
          <div className="space-y-1">
            {linkedTasks.map((reference) =>
              reference.task_state === "active" && reference.task_id ? (
                <Link
                  key={reference.highlight_id}
                  href={`/tasks/${reference.task_id}`}
                  className="block rounded p-2 text-sm hover:bg-accent hover:text-primary"
                >
                  {reference.task_title || "无标题任务"}
                </Link>
              ) : (
                <div
                  key={reference.highlight_id}
                  className="rounded border border-dashed p-2 text-sm text-muted-foreground"
                >
                  {reference.task_state === "deleted" ? "关联任务已移入垃圾箱" : "关联任务引用已失效"}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {hasBacklinks && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            反向链接
            <span className="text-xs text-muted-foreground/70">({backlinkNotes.length})</span>
          </h3>
          <div className="space-y-1">
            {backlinkNotes.map((note) => (
              <Link
                key={note.id}
                href={`/notes/${note.id}`}
                className="flex items-start gap-2 p-2 rounded hover:bg-accent transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm group-hover:text-primary transition-colors truncate">
                    {note.title || "无标题笔记"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(note.created_at).toLocaleDateString("zh-CN")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
