import { Suspense } from "react";
import { TaskWorkspaceTabs } from "@/components/tasks/task-workspace-tabs";

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-3">
      <Suspense fallback={<div className="h-12 shrink-0 border-b bg-background" />}>
        <TaskWorkspaceTabs />
      </Suspense>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
