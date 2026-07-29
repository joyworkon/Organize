import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/notes/[id] - 获取单个笔记
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("notes")
    .select("*, reading_item:reading_items(id, title, url, cover_image)")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  }

  return NextResponse.json(data);
}

// PATCH /api/notes/[id] - 更新笔记
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const {
    title,
    content,
    reading_item_id,
    icon,
    cover_url,
    cover_position,
    parent_note_id,
  } = body;

  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title;
  if (content !== undefined) updateData.content = content;
  if (reading_item_id !== undefined) updateData.reading_item_id = reading_item_id;
  if (icon === null || typeof icon === "string") updateData.icon = icon;
  if (cover_url === null || typeof cover_url === "string") {
    updateData.cover_url = cover_url;
  }
  if (typeof cover_position === "number") {
    updateData.cover_position = Math.max(
      0,
      Math.min(100, Math.round(cover_position))
    );
  }
  if (parent_note_id === null || typeof parent_note_id === "string") {
    updateData.parent_note_id = parent_note_id;
  }

  const { data, error } = await supabase
    .from("notes")
    .update(updateData)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// DELETE /api/notes/[id] - 将笔记移入垃圾箱
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("mutate_trash", {
    p_action: "soft_delete",
    p_resource_type: "note",
    p_ids: [params.id],
  });

  if (error) {
    console.error("Note soft delete failed:", error.message);
    return NextResponse.json(
      { error: "删除笔记失败", code: "TRASH_MUTATION_FAILED" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    affected: typeof data === "number" ? data : 0,
  });
}
