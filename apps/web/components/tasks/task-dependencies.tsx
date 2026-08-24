"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Link2, LockKeyhole, Plus, X } from "lucide-react";
import type { Task, TaskDependency } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  getTaskDependencyView,
  wouldCreateTaskDependencyCycle,
} from "@/lib/tasks/dependencies";

interface TaskDependenciesProps {
  task: Task;
  onOpenTask?: (taskId: string) => void;
}

export function TaskDependencies({ task, onOpenTask }: TaskDependenciesProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: taskData }, { data: dependencyData }] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("user_id", task.user_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("task_dependencies")
        .select("*")
        .eq("user_id", task.user_id),
    ]);
    setTasks((taskData || []) as Task[]);
    setDependencies((dependencyData || []) as TaskDependency[]);
  };

  useEffect(() => {
    setCandidateId("");
    void load();
    // task.id 是唯一加载键；supabase 客户端保持稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const view = getTaskDependencyView(tasks, dependencies, task.id);
  const prerequisiteIds = new Set(view.prerequisites.map((item) => item.id));
  const candidates = tasks.filter(
    (item) =>
      !item.deleted_at &&
      item.id !== task.id &&
      !prerequisiteIds.has(item.id) &&
      !wouldCreateTaskDependencyCycle(dependencies, task.id, item.id)
  );

  const openTask = (taskId: string) => {
    if (onOpenTask) onOpenTask(taskId);
    else router.push(`/tasks/${taskId}`);
  };

  const addDependency = async () => {
    if (!candidateId || saving) return;
    setSaving(true);
    const { error } = await supabase.rpc("add_task_dependency", {
      p_task_id: task.id,
      p_depends_on_task_id: candidateId,
    });
    setSaving(false);
    if (error) {
      toast({
        title: "添加依赖失败",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setCandidateId("");
    await load();
    window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
  };

  const removeDependency = async (prerequisiteId: string) => {
    const { error } = await supabase.rpc("remove_task_dependency", {
      p_task_id: task.id,
      p_depends_on_task_id: prerequisiteId,
    });
    if (error) {
      toast({
        title: "移除依赖失败",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    await load();
    window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
  };

  return (
    <section className="space-y-3" aria-label="任务依赖">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="h-4 w-4" />
          依赖关系
        </h3>
        {view.blockingPrerequisites.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            <LockKeyhole className="h-3 w-3" />
            被 {view.blockingPrerequisites.length} 项阻塞
          </span>
        )}
      </div>

      <div className="flex min-w-0 gap-2">
        <select
          aria-label="选择前置任务"
          value={candidateId}
          onChange={(event) => setCandidateId(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">添加前置任务…</option>
          {candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="添加前置任务"
          disabled={!candidateId || saving}
          onClick={() => void addDependency()}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-md border hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <DependencyList
        title="前置任务"
        emptyText="暂无前置任务"
        tasks={view.prerequisites}
        onOpenTask={openTask}
        onRemove={(taskId) => void removeDependency(taskId)}
      />
      <DependencyList
        title="后置任务"
        emptyText="暂无后置任务"
        tasks={view.dependents}
        onOpenTask={openTask}
      />
    </section>
  );
}

function DependencyList({
  title,
  emptyText,
  tasks,
  onOpenTask,
  onRemove,
}: {
  title: string;
  emptyText: string;
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
  onRemove?: (taskId: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      {tasks.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-1">
          {tasks.map((item) => (
            <div key={item.id} className="flex min-h-10 items-center gap-2 rounded-md border px-3">
              {item.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-amber-600" />
              )}
              <button
                type="button"
                onClick={() => onOpenTask(item.id)}
                className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
              >
                {item.title}
              </button>
              {onRemove && (
                <button
                  type="button"
                  aria-label={`移除前置任务 ${item.title}`}
                  onClick={() => onRemove(item.id)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
