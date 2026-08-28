import type { createClient } from "@/lib/supabase/client";

type SupabaseClient = ReturnType<typeof createClient>;

export interface CreatedNote {
  id: string;
}

export interface NewNoteOverrides {
  title?: string;
  parent_note_id?: string | null;
  icon?: string | null;
}

/**
 * 新建笔记的统一入口：侧边栏「+」、标签页条「+」、块「转换成页面」共用，
 * 保证默认内容一致。走浏览器端 Supabase 客户端（会话内 RLS），
 * 假后端模式（NEXT_PUBLIC_MOCK_BACKEND）下同样可用——不要改走 /api 路由。
 */
export async function createNewNote(
  supabase: SupabaseClient,
  overrides: NewNoteOverrides = {}
): Promise<CreatedNote | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("notes")
    .insert({
      user_id: user.id,
      // 空标题：编辑页用浅灰占位符「无标题笔记」展示 + 自动聚焦
      title: overrides.title ?? "",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      icon: overrides.icon ?? null,
      cover_url: null,
      cover_position: 50,
      parent_note_id: overrides.parent_note_id ?? null,
    })
    .select()
    .single();
  if (error || !data) return null;
  return data as CreatedNote;
}
