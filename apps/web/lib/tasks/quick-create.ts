import type { createClient } from "@/lib/supabase/client";
import { isOnline } from "@/lib/offline/network";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { enqueueTaskOp, makeTaskCreateOp } from "@/lib/offline/task-queue";
import type { Task } from "@organize/shared";

type SupabaseClient = ReturnType<typeof createClient>;

export type QuickTaskCreateResult =
  | { status: "created" | "queued"; task: Task; persisted?: boolean }
  | { status: "unauthenticated" }
  | { status: "failed"; message: string };

export interface QuickTaskCreateOptions {
  title: string;
  dueDate?: string | null;
  listId?: string | null;
}

/**
 * 跨入口的轻量待办创建：在线直接写入；离线或网络失败时保留同一客户端 id 入队，
 * 使工作台和刘海面板具备一致的回放幂等语义。
 */
export async function createQuickTask(
  supabase: SupabaseClient,
  { title, dueDate = null, listId = null }: QuickTaskCreateOptions,
): Promise<QuickTaskCreateResult> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return { status: "failed", message: "请输入待办内容" };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return { status: "unauthenticated" };

  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    user_id: user.id,
    title: normalizedTitle,
    description: null,
    status: "todo",
    priority: "medium",
    category: "work",
    list_id: listId,
    due_date: dueDate,
    estimated_minutes: null,
    actual_minutes: null,
    reading_item_id: null,
    note_id: null,
    is_pinned: false,
    sort_order: 0,
    completed_at: null,
    created_at: now,
    updated_at: now,
    tags: [],
  } as Task;
  const payload = {
    id: task.id,
    user_id: task.user_id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    category: task.category,
    list_id: task.list_id,
    due_date: task.due_date,
  };
  const queue = () => {
    const { persisted } = enqueueTaskOp(localStorage, user.id, makeTaskCreateOp(payload));
    return { status: "queued" as const, task, persisted };
  };

  if (!isOnline()) return queue();
  const { error } = await supabase.from("tasks").insert(payload);
  if (!error) return { status: "created", task };
  if (isNetworkSaveError(error)) return queue();
  return { status: "failed", message: error.message || "创建任务失败" };
}
