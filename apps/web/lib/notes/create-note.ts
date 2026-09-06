import type { createClient } from "@/lib/supabase/client";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import {
  enqueueNoteCreate,
  makeNoteCreateOp,
} from "@/lib/offline/note-queue";
import { isOnline } from "@/lib/offline/network";

type SupabaseClient = ReturnType<typeof createClient>;

export type CreateNoteResult =
  | { status: "created"; noteId: string }
  | { status: "queued"; noteId: string; persisted: boolean }
  | { status: "unauthenticated" }
  | { status: "failed"; message: string };

export interface NewNoteOverrides {
  title?: string;
  parent_note_id?: string | null;
  icon?: string | null;
}

function buildNotePayload(userId: string, overrides: NewNoteOverrides): Record<string, unknown> {
  return {
    // 空标题：编辑页用浅灰占位符「无标题笔记」展示 + 自动聚焦
    title: overrides.title ?? "",
    content: { type: "doc", content: [{ type: "paragraph" }] },
    icon: overrides.icon ?? null,
    cover_url: null,
    cover_position: 50,
    parent_note_id: overrides.parent_note_id ?? null,
  };
}

/**
 * 新建笔记的统一入口（N02）：列表、侧栏「+」、标签页条「+」、块「转换成页面」、
 * QuickAdd、命令面板、刘海快捷笔记全部走这里，保证默认字段与离线语义一致。
 *
 * 行为：在线直写（RLS 会话内）；断网或网络失败时以客户端 UUID 入队
 * （organize:offline:note-creates，回放以主键唯一约束幂等去重）并返回 queued，
 * 客户端 UUID 即最终 id，调用方可直接跳转 /notes/{id}（编辑器草稿管线接管后续）。
 * 假后端模式（NEXT_PUBLIC_MOCK_BACKEND）下同样可用——不要改走 /api 路由。
 */
export async function createNewNote(
  supabase: SupabaseClient,
  overrides: NewNoteOverrides = {}
): Promise<CreateNoteResult> {
  // X1：getSession 读本地会话（无网络请求），离线创建可用；getUser 离线返回 null 会静默吞掉创建
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return { status: "unauthenticated" };

  const noteId = crypto.randomUUID();
  const payload = {
    id: noteId,
    user_id: user.id,
    ...buildNotePayload(user.id, overrides),
  };

  const queue = (): CreateNoteResult => {
    const { persisted } = enqueueNoteCreate(localStorage, makeNoteCreateOp(payload));
    return { status: "queued", noteId, persisted };
  };

  if (!isOnline()) return queue();
  const { error } = await supabase.from("notes").insert(payload);
  if (!error) return { status: "created", noteId };
  // 网络错误按离线创建处理（客户端 id 保证回放不重复）
  if (isNetworkSaveError(error)) return queue();
  return { status: "failed", message: error.message || "创建笔记失败" };
}

/** 便于调用方提示的短文案 */
export function describeCreateNoteResult(result: CreateNoteResult): string {
  switch (result.status) {
    case "created":
      return "已创建";
    case "queued":
      return result.persisted ? "已离线创建，联网后自动同步" : "本地存储不可用，离线创建可能丢失";
    case "unauthenticated":
      return "请先登录";
    case "failed":
      return result.message;
  }
}
