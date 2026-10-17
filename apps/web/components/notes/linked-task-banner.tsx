"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ListChecks } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import {
  linkedTasksOverflowLabel,
  nextLinkedTasksAfterLoad,
  shouldHideLinkedTaskBanner,
  type LinkedTaskRow,
} from "@/lib/notes/linked-task-banner-load";

/**
 * 笔记详情页的关联任务横幅：当有待办通过 note_id 指向当前笔记时，
 * 在标题下方展示一条可跳转回待办的入口；真·无关联时不渲染。
 * 加载失败时如实报错并提供重试，保留上次成功数据，不冒充「没有关联任务」。
 */
export function LinkedTaskBanner({ noteId }: { noteId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [tasks, setTasks] = useState<LinkedTaskRow[]>([]);
  // 真实关联任务总数（count exact），「等 N 个」如实报它而非被 limit 截断的列表长度
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 重试计数：递增触发下方 effect 重新加载（保留 active 清理语义）
  const [retryCount, setRetryCount] = useState(0);
  // 最近一次落到 UI 的状态：effect 闭包读 state 在切笔记重置后仍是旧值，保留旧数据必须读 ref（#362 的坑）
  const previousRef = useRef<{ tasks: LinkedTaskRow[]; total: number }>({ tasks: [], total: 0 });

  // 切笔记：上一篇笔记的关联任务与失败提示不得带入新笔记
  useEffect(() => {
    previousRef.current = { tasks: [], total: 0 };
    setTasks([]);
    setTotal(0);
    setLoadError(null);
  }, [noteId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error, count } = await supabase
        .from("tasks")
        .select("id, title, status", { count: "exact" })
        .eq("note_id", noteId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(3);
      if (!active) return;
      const plan = nextLinkedTasksAfterLoad({
        previous: previousRef.current,
        data: (data ?? null) as LinkedTaskRow[] | null,
        error,
        count,
      });
      previousRef.current = { tasks: plan.tasks, total: plan.total };
      setTasks(plan.tasks);
      setTotal(plan.total);
      setLoadError(plan.loadError);
    };
    void load();
    return () => {
      active = false;
    };
  }, [noteId, supabase, retryCount]);

  if (shouldHideLinkedTaskBanner({ tasks, loadError })) return null;

  const overflowLabel = linkedTasksOverflowLabel(total, Math.min(tasks.length, 2));

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
        {overflowLabel && <span>{overflowLabel}</span>}
      </span>
      {loadError && (
        <span className="flex shrink-0 items-center gap-1 text-destructive" role="alert">
          {loadError}
          {tasks.length > 0 ? "，显示的是上次加载结果" : ""}
          <button
            type="button"
            className="underline underline-offset-2 hover:opacity-80"
            onClick={() => setRetryCount((current) => current + 1)}
          >
            重试
          </button>
        </span>
      )}
    </div>
  );
}
