import type { createClient } from "@/lib/supabase/client";

type SupabaseClient = ReturnType<typeof createClient>;

export interface CreatedNote {
  id: string;
}

/** 新建空白笔记的统一入口：侧边栏「+」与标签页条「+」共用，保证默认内容一致。 */
export async function createNewNote(
  supabase: SupabaseClient
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
      title: "",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      icon: null,
      cover_url: null,
      cover_position: 50,
      parent_note_id: null,
    })
    .select()
    .single();
  if (error || !data) return null;
  return data as CreatedNote;
}
