"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { TaskMonthView } from "@/components/tasks/task-month-view";
import type { SidebarSelection } from "@/components/tasks/task-sidebar";
import { useTaskWorkspaceData, filterTasksByScope } from "@/lib/tasks/workspace";
import { toast } from "@/hooks/use-toast";

function CalendarPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tasks, loading, refetch, supabase } = useTaskWorkspaceData();
  const scope = (searchParams.get("scope") as SidebarSelection["scope"]) || "all";
  const selection = useMemo<SidebarSelection>(
    () => ({ scope, listId: scope === "list" ? searchParams.get("list") : null }),
    [scope, searchParams]
  );
  const visibleTasks = useMemo(
    () => filterTasksByScope(tasks, selection).filter((task) => !task.deleted_at),
    [selection, tasks]
  );

  const rescheduleTask = useCallback(
    async (taskId: string, date: Date) => {
      const value = date.toISOString();
      const { error } = await supabase
        .from("tasks")
        .update({ schedule_start_at: value, due_date: value })
        .eq("id", taskId);
      if (error) {
        toast({ title: "改期失败", variant: "destructive" });
        return;
      }
      await refetch();
      window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
    },
    [refetch, supabase]
  );

  if (loading) {
    return (
      <div className="grid h-[calc(100vh-11rem)] place-items-center rounded-lg border bg-background text-muted-foreground md:h-[calc(100vh-6rem)]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="organize-task-screen flex h-[calc(100vh-11rem)] min-h-0 w-full flex-col overflow-hidden rounded-lg border bg-background text-foreground md:h-[calc(100vh-6rem)]">
      <TaskMonthView
        tasks={visibleTasks}
        onTaskClick={(task) => router.push(`/tasks/${task.id}`)}
        onRescheduleTask={rescheduleTask}
      />
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="grid h-40 place-items-center text-muted-foreground">加载中…</div>}>
      <CalendarPageInner />
    </Suspense>
  );
}
