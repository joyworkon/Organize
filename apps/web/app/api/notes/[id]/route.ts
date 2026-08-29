import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/notes/[id] - 获取单个笔记
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    .eq("id", id)
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    full_width,
    font_family,
    small_font,
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
    // 循环防护：不能把自己设为自己的父页面，也不能移动到自己的后代下
    if (typeof parent_note_id === "string") {
      if (parent_note_id === id) {
        return NextResponse.json(
          { error: "不能将笔记移动到自身下面" },
          { status: 400 }
        );
      }
      // 从候选 parent 向上遍历祖先链，若命中自己则构成循环
      const { data: ancestors } = await supabase
        .from("notes")
        .select("id, parent_note_id")
        .eq("user_id", user.id)
        .is("deleted_at", null);
      // 额外校验：候选父页面必须存在且未被删除
      const parentExists = (ancestors || []).some(
        (n: { id: string }) => n.id === parent_note_id
      );
      if (!parentExists) {
        return NextResponse.json(
          { error: "父页面不存在或已被删除" },
          { status: 400 }
        );
      }
      const byId = new Map(
        (ancestors || []).map((n: { id: string; parent_note_id: string | null }) => [
          n.id,
          n.parent_note_id,
        ])
      );
      const seen = new Set<string>();
      let cursor: string | null = parent_note_id;
      while (cursor) {
        if (cursor === id) {
          return NextResponse.json(
            { error: "不能将笔记移动到它自己的子孙页面下" },
            { status: 400 }
          );
        }
        if (seen.has(cursor)) break; // 已存在的循环（数据异常），跳出避免死循环
        seen.add(cursor);
        cursor = byId.get(cursor) ?? null;
      }
    }
    updateData.parent_note_id = parent_note_id;
  }
  if (typeof full_width === "boolean") updateData.full_width = full_width;
  if (font_family === "default" || font_family === "serif" || font_family === "mono") {
    updateData.font_family = font_family;
  }
  if (typeof small_font === "boolean") updateData.small_font = small_font;

  // PATCH 会改动编辑器保存快照里的字段（标题/图标/父页面/排版等）。
  // 不递增 content_revision 的话，另一个标签页里打开本笔记的编辑器仍持有
  // 旧 revision，其下一次自动保存会通过乐观锁检查、把这里的修改静默还原
  // （与 046/051 修的版本恢复、块移动问题同根因）。
  if (Object.keys(updateData).length > 0) {
    const { data: current } = await supabase
      .from("notes")
      .select("content_revision")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    updateData.content_revision = Number(current?.content_revision ?? 0) + 1;
  }

  const { data, error } = await supabase
    .from("notes")
    .update(updateData)
    .eq("id", id)
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    p_ids: [id],
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
