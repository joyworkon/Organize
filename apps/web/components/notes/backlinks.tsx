"use client";
import { readingSourceLabel } from "@/lib/reading/source";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fetchAllNoteBacklinks } from "@/lib/notes/backlinks";
import {
  nextBacklinksAfterLoad,
  shouldHideBacklinksPanel,
} from "@/lib/notes/backlinks-load";
import { BookOpen, ArrowLeftRight, ExternalLink, Loader2 } from "@/components/icons";
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
  const [backlinksTruncated, setBacklinksTruncated] = useState(false);
  const [readingItem, setReadingItem] = useState<ReadingItem | null>(null);
  const [highlightReferences, setHighlightReferences] = useState<HighlightReferenceState[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 重试计数：递增触发下方 effect 重新加载（保留 active 清理语义）
  const [retryCount, setRetryCount] = useState(0);
  // 最近一次成功加载的反链列表：刷新失败时保留展示，不拿失败冒充「没有反向链接」
  const lastSuccessRef = useRef<BacklinkNote[] | null>(null);

  // 切笔记：上一笔记的反链列表与失败提示不得带入新笔记
  useEffect(() => {
    lastSuccessRef.current = null;
    setBacklinkNotes([]);
    setBacklinksTruncated(false);
    setLoadError(null);
  }, [noteId]);

  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);
      setLoadError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const [backlinkOutcome, readingResult, referenceResult, readingStateResult] = await Promise.all([
        // R10a：后端分页 RPC 取全反链（只回元数据；服务端 auth.uid() 过滤 + 软删除排除）。
        // 失败不吞成 null：显式交给 nextBacklinksAfterLoad 落成错误态 + 重试，不得冒充「没有反链」
        fetchAllNoteBacklinks(supabase, noteId).then(
          (rows) => ({ ok: true as const, rows }),
          () => ({ ok: false as const })
        ),
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

      // R10a：服务端已保证完整与权限；5000 条防御上限（与 helper 一致）内如实展示；
      // 失败时按 backlinks-load 计划保留上次成功列表（见 lastSuccessRef），不静默清空
      const backlinkPlan = nextBacklinksAfterLoad(
        lastSuccessRef.current,
        backlinkOutcome.ok
          ? { ok: true, rows: backlinkOutcome.rows.slice(0, 5000) }
          : { ok: false }
      );
      if (!backlinkPlan.failed) lastSuccessRef.current = backlinkPlan.rows;
      setBacklinkNotes(backlinkPlan.rows);
      setLoadError(backlinkPlan.loadError);
      if (backlinkOutcome.ok) {
        setBacklinksTruncated(backlinkOutcome.rows.length > 5000);
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
  }, [noteId, readingItemId, supabase, retryCount]);

  const hasReading = !!readingItem;
  const hasBacklinks = backlinkNotes.length > 0;
  const linkedTasks = highlightReferences.filter((reference) => reference.task_id);
  const hasUnavailableReading = !!readingItemId && !readingItem;

  if (
    shouldHideBacklinksPanel({
      loading,
      loadError,
      hasReading,
      hasUnavailableReading,
      hasBacklinks,
      hasLinkedTasks: linkedTasks.length > 0,
    })
  ) {
    return null;
  }

  return (
    // data-testid 供 E2E 作用域定位（侧边栏笔记列表与反链行可能同标题）
    <div className="mt-8 pt-6 border-t" data-testid="backlinks-panel">
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
                      return readingSourceLabel(readingItem.url);
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

      {loadError && (
        <div
          className="mb-6 flex items-center justify-between gap-2 text-sm text-destructive"
          role="alert"
        >
          <span>
            {loadError}
            {hasBacklinks ? "，下方为上次成功加载的反向链接" : ""}
          </span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
            disabled={loading}
            onClick={() => setRetryCount((count) => count + 1)}
          >
            重试
          </button>
        </div>
      )}

      {hasBacklinks && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            反向链接
            <span className="text-xs text-muted-foreground/70">
              ({backlinkNotes.length}{backlinksTruncated ? "+" : ""})
            </span>
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
