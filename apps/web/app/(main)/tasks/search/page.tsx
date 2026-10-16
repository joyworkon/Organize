"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ListChecks, Search as SearchIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { TASK_STATUS_CONFIG } from "@organize/shared";
import { formatTaskDate } from "@/components/tasks/task-date-popover";
import { searchTasks, taskDate, useTaskWorkspaceData } from "@/lib/tasks/workspace";
import { cn } from "@/lib/utils";

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tasks, lists, loading } = useTaskWorkspaceData();
  const queryFromUrl = searchParams.get("q") || "";
  const [query, setQuery] = useState(queryFromUrl);

  useEffect(() => setQuery(queryFromUrl), [queryFromUrl]);

  const results = useMemo(() => searchTasks(tasks, query, lists), [lists, query, tasks]);
  const listNames = useMemo(() => new Map(lists.map((list) => [list.id, list.name])), [lists]);

  const updateQuery = (value: string) => {
    setQuery(value);
    const next = new URLSearchParams(searchParams.toString());
    if (value.trim()) next.set("q", value);
    else next.delete("q");
    const encoded = next.toString();
    router.replace(encoded ? `/tasks/search?${encoded}` : "/tasks/search", { scroll: false });
  };

  return (
    <section className="flex w-full flex-col gap-4 sm:gap-6">
      <PageHeader
        icon={SearchIcon}
        title="搜索任务"
        search={
          <div className="relative w-full sm:max-w-md">
            <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              aria-label="搜索任务"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="搜索标题、描述、清单或标签"
              className="pl-10"
            />
          </div>
        }
      />
      <div className="text-sm text-muted-foreground">
        {loading ? "正在搜索…" : query.trim() ? `找到 ${results.length} 个结果` : "输入关键词开始搜索"}
      </div>
      {!loading && query.trim() && results.length === 0 ? (
        <EmptyState icon={SearchIcon} title="没有匹配任务" description="试试标题、描述、清单名或标签名称" />
      ) : query.trim() ? (
        <div className="divide-y border-y">
          {results.map((task) => {
            const status = TASK_STATUS_CONFIG[task.status];
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => router.push(`/tasks/${task.id}`)}
                className="flex min-h-14 w-full items-start gap-3 px-3 py-3 text-left transition-colors duration-100 motion-reduce:duration-0 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:px-4"
              >
                <ListChecks className={cn("mt-0.5 h-5 w-5 shrink-0", task.status === "done" ? "text-success" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate font-medium", task.status === "done" && "text-muted-foreground line-through")}>
                    {task.title}
                  </span>
                  {task.description && <span className="mt-1 block truncate text-sm text-muted-foreground">{task.description}</span>}
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{status.label}</span>
                    {task.list_id && listNames.get(task.list_id) && <span>· {listNames.get(task.list_id)}</span>}
                    {task.tags?.map((tag) => <span key={tag.id} className="rounded-full bg-muted px-1.5 py-0.5">#{tag.name}</span>)}
                    {taskDate(task) && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formatTaskDate(taskDate(task))}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="grid h-40 place-items-center text-muted-foreground">加载中…</div>}>
      <SearchPageInner />
    </Suspense>
  );
}
