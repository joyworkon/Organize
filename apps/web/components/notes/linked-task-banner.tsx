"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface LinkedTask {
  id: string;
  title: string;
  status: string;
}

/**
 * 笔记详情页的关联任务横幅：当有待办通过 note_id 指向当前笔记时，
 * 在标题下方展示一条可跳转回待办的入口；无关联时不渲染。
 */
export function LinkedTaskBanner({ noteId }: { noteId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [tasks, setTasks] = useState<LinkedTask[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("tasks")
        .select("id, title, status")
        .eq("note_id", noteId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(3);
      if (active) setTasks((data || []) as LinkedTask[]);
    };
    void load();
    return () => {
      active = false;
    };
  }, [noteId, supabase]);

  if (tasks.length === 0) return null;

  return (
    <div className="note-meta-row flex items-center gap-1.5 text-xs text-muted-foreground">
      <ListChecks className="h-3 w-3 shrink-0" />
      <span className="shrink-0">关联任务</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2">
        {tasks.slice(0, 2).map((task) => (
          <Link
            key={task.id}
            href={`/tasks?task=${task.id}`}
            className="truncate text-primary hover:underline"
          >
            {task.status === "done" ? "✓ " : ""}
            {task.title}
          </Link>
        ))}
        {tasks.length > 2 && <span>等 {tasks.length} 个</span>}
      </span>
    </div>
  );
}
