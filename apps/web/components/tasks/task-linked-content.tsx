"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, FileText } from "lucide-react";
import type { Task } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import type { ReferenceState } from "@/lib/reading/highlight-references";

interface LinkedTarget {
  id: string;
  title: string | null;
  state: ReferenceState;
}

export function TaskLinkedContent({ task }: { task: Task }) {
  const supabase = useMemo(() => createClient(), []);
  const [reading, setReading] = useState<LinkedTarget | null>(null);
  const [note, setNote] = useState<LinkedTarget | null>(null);

  useEffect(() => {
    let active = true;
    async function loadLinks() {
      const [referenceResult, readingResult, noteResult] = await Promise.all([
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
      ]);
      if (!active) return;
      const reference = referenceResult.data?.[0] || null;
      if (task.reading_item_id) {
        setReading({
          id: task.reading_item_id,
          title: reference?.reading_title || readingResult.data?.title || null,
          state: reference?.reading_state || (readingResult.data ? "active" : "missing"),
        });
      } else {
        setReading(null);
      }
      if (task.note_id) {
        setNote({
          id: task.note_id,
          title: reference?.note_title || noteResult.data?.title || null,
          state: reference?.note_state || (noteResult.data ? "active" : "missing"),
        });
      } else {
        setNote(null);
      }
    }
    void loadLinks();
    return () => {
      active = false;
    };
  }, [supabase, task.id, task.note_id, task.reading_item_id]);

  if (!task.reading_item_id && !task.note_id) return null;

  const renderTarget = (
    target: LinkedTarget | null,
    type: "reading" | "note"
  ) => {
    const label = type === "reading" ? "阅读" : "笔记";
    const Icon = type === "reading" ? BookOpen : FileText;
    if (!target) {
      return <span className="text-sm text-muted-foreground">正在检查关联{label}…</span>;
    }
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
        href={`/${type === "reading" ? "library" : "notes"}/${target.id}`}
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
      <div className="flex flex-wrap gap-2">
        {task.reading_item_id && renderTarget(reading, "reading")}
        {task.note_id && renderTarget(note, "note")}
      </div>
    </div>
  );
}
