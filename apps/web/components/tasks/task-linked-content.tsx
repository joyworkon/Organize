"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, FileText } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Task } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import {
  nextLinkedContentAfterLoad,
  type LinkedTargetSnapshot,
} from "@/lib/tasks/linked-content-load";

type LinkedTarget = NonNullable<LinkedTargetSnapshot["reading"]>;

export function TaskLinkedContent({ task }: { task: Task }) {
  const supabase = useMemo(() => createClient(), []);
  const [snapshot, setSnapshot] = useState<LinkedTargetSnapshot>({
    reading: null,
    note: null,
  });
  const previousSnapshot = useRef<LinkedTargetSnapshot>(snapshot);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const { reading, note } = snapshot;

  useEffect(() => {
    const emptySnapshot: LinkedTargetSnapshot = { reading: null, note: null };
    previousSnapshot.current = emptySnapshot;
    setSnapshot(emptySnapshot);
    setLoadError(null);
  }, [task.id, task.note_id, task.reading_item_id]);

  useEffect(() => {
    let active = true;

    function commit(next: ReturnType<typeof nextLinkedContentAfterLoad>) {
      previousSnapshot.current = next.current;
      setSnapshot(next.current);
      setLoadError(next.loadError);
    }

    async function loadLinks() {
      try {
        const [referenceResult, readingResult, noteResult, highlightResult] = await Promise.all([
          supabase.rpc("get_linked_content_states", {
            p_reading_item_id: task.reading_item_id || null,
            p_note_id: task.note_id || null,
            p_task_id: task.id,
          }),
          task.reading_item_id
            ? supabase
                .from("reading_items")
                .select("id, title")
                .eq("id", task.reading_item_id)
                .is("deleted_at", null)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          task.note_id
            ? supabase
                .from("notes")
                .select("id, title")
                .eq("id", task.note_id)
                .is("deleted_at", null)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          task.reading_item_id
            ? supabase
                .from("highlights")
                .select("id")
                .eq("task_id", task.id)
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (!active) return;

        const error =
          referenceResult.error || readingResult.error || noteResult.error || highlightResult.error;
        if (error) {
          commit(
            nextLinkedContentAfterLoad({
              previous: previousSnapshot.current,
              ok: false,
              error,
            })
          );
          return;
        }

        const reference = referenceResult.data?.[0] || null;
        const current: LinkedTargetSnapshot = {
          reading: task.reading_item_id
            ? {
                id: task.reading_item_id,
                title: reference?.reading_title || readingResult.data?.title || null,
                state: reference?.reading_state || (readingResult.data ? "active" : "missing"),
                highlightId: highlightResult.data?.id ?? null,
              }
            : null,
          note: task.note_id
            ? {
                id: task.note_id,
                title: reference?.note_title || noteResult.data?.title || null,
                state: reference?.note_state || (noteResult.data ? "active" : "missing"),
              }
            : null,
        };
        commit(
          nextLinkedContentAfterLoad({
            previous: previousSnapshot.current,
            ok: true,
            current,
          })
        );
      } catch (error) {
        if (!active) return;
        commit(
          nextLinkedContentAfterLoad({
            previous: previousSnapshot.current,
            ok: false,
            error: error instanceof Error ? error : null,
          })
        );
      }
    }
    void loadLinks();
    return () => {
      active = false;
    };
  }, [supabase, task.id, task.note_id, task.reading_item_id, loadAttempt]);

  if (!task.reading_item_id && !task.note_id) return null;

  const renderTarget = (target: LinkedTarget | null, type: "reading" | "note") => {
    const label = type === "reading" ? "阅读" : "笔记";
    const Icon = type === "reading" ? BookOpen : FileText;
    if (!target) {
      if (loadError) return null;
      return <span className="text-sm text-muted-foreground">正在检查关联{label}…</span>;
    }
    if (loadError && target.state === "missing") return null;
    if (target.state !== "active") {
      return (
        <span className="inline-flex items-center gap-1 rounded border border-dashed px-2 py-1 text-sm text-muted-foreground">
          <Icon className="h-4 w-4" />
          {target.state === "deleted" ? `关联${label}已在垃圾箱` : `关联${label}引用已失效`}
        </span>
      );
    }
    return (
      <Link
        href={
          type === "reading"
            ? `/library/${target.id}${target.highlightId ? `?hl=${target.highlightId}` : ""}`
            : `/notes/${target.id}`
        }
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <Icon className="h-4 w-4" />
        {target.title || `关联${label}`}
      </Link>
    );
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">关联内容</h3>
      {loadError ? (
        <div className="flex flex-wrap items-center gap-2">
          <span role="alert" className="text-sm text-destructive">
            {loadError}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            重试
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {task.reading_item_id && renderTarget(reading, "reading")}
        {task.note_id && renderTarget(note, "note")}
      </div>
    </div>
  );
}
