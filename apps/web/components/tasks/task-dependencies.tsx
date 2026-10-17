"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Link2, LockKeyhole, Plus, X } from "@/components/icons";
import type { Task, TaskDependency } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  failedTaskDependencyLoadSections,
  getTaskDependencyView,
  taskDependencyLoadErrorMessage,
  wouldCreateTaskDependencyCycle,
  type TaskDependencyLoadSection,
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
  // 依赖关系加载失败时不得显示「暂无前置/后置任务」假空状态，也不得允许添加依赖
  // （wouldCreateTaskDependencyCycle 需要完整依赖数据才可靠）——用「成功加载过」标记区分
  const [dependenciesLoaded, setDependenciesLoaded] = useState(false);
  // 本次加载失败的部分：非空时标题行下方提示 + 重试；同任务重载失败保留上次成功数据
  const [loadFailures, setLoadFailures] = useState<TaskDependencyLoadSection[]>([]);
  // 旧请求丢弃：任务切换（effect 自增）或同任务内再次加载（重试/增删依赖）都会推进请求号，
  // 结果返回时请求号已过期就整个丢弃，防止慢响应覆盖新任务/新数据
  const loadSeqRef = useRef(0);

  const load = async () => {
    const requestSeq = ++loadSeqRef.current;
    const [taskRes, dependencyRes] = await Promise.all([
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
    if (loadSeqRef.current !== requestSeq) return;
    setLoadFailures(
      failedTaskDependencyLoadSections({ tasks: taskRes, dependencies: dependencyRes })
    );
    // 只替换成功的部分；失败的保留上次成功数据（首次失败则保持初始值），提示条说明缺了什么
    if (!taskRes.error) {
      setTasks((taskRes.data || []) as Task[]);
    }
    if (!dependencyRes.error) {
      setDependencies((dependencyRes.data || []) as TaskDependency[]);
      setDependenciesLoaded(true);
    }
  };

  useEffect(() => {
    // 切换任务：立即清掉上一任务的数据与失败提示并标记未加载，使在途请求全部作废，绝不留给新任务
    loadSeqRef.current += 1;
    setCandidateId("");
    setLoadFailures([]);
    setTasks([]);
    setDependencies([]);
    setDependenciesLoaded(false);
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
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
            <LockKeyhole className="h-3 w-3" />
            被 {view.blockingPrerequisites.length} 项阻塞
          </span>
        )}
      </div>

      {/* 加载失败：如实提示缺了哪部分并提供重试，不冒充「没有依赖」 */}
      {loadFailures.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <span>{taskDependencyLoadErrorMessage(loadFailures)}</span>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 px-2.5 text-xs md:min-h-11"
            onClick={() => void load()}
          >
            重试
          </Button>
        </div>
      )}

      <div className="flex min-w-0 gap-2">
        <select
          aria-label="选择前置任务"
          value={candidateId}
          onChange={(event) => setCandidateId(event.target.value)}
          disabled={!dependenciesLoaded}
          className="h-8 min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-base leading-6 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-8 md:text-sm"
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
          disabled={!candidateId || saving || !dependenciesLoaded}
          onClick={() => void addDependency()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:h-8 md:w-8"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <DependencyList
        title="前置任务"
        emptyText={dependenciesLoaded ? "暂无前置任务" : "依赖关系暂时无法加载"}
        tasks={view.prerequisites}
        onOpenTask={openTask}
        onRemove={(taskId) => void removeDependency(taskId)}
      />
      <DependencyList
        title="后置任务"
        emptyText={dependenciesLoaded ? "暂无后置任务" : "依赖关系暂时无法加载"}
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
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <button
                type="button"
                onClick={() => onOpenTask(item.id)}
                className="min-h-11 min-w-0 flex-1 truncate text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px] md:min-h-8"
              >
                {item.title}
              </button>
              {onRemove && (
                <button
                  type="button"
                  aria-label={`移除前置任务 ${item.title}`}
                  onClick={() => onRemove(item.id)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px] md:h-8 md:w-8"
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
