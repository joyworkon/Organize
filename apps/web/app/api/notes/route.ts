import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/notes - 获取笔记列表
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const sortBy = searchParams.get("sortBy") || "updated_at";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const readingItemId = searchParams.get("readingItemId");

  let query = supabase
    .from("notes")
    .select("*, reading_item:reading_items(id, title, url), tags:tags!note_tags(id, name)")
    .eq("user_id", user.id);

  if (search) {
    query = query.ilike("title", `%${search}%`);
  }

  if (readingItemId) {
    query = query.eq("reading_item_id", readingItemId);
  }

  const validSortFields = ["created_at", "updated_at", "title"];
  const sortField = validSortFields.includes(sortBy) ? sortBy : "updated_at";
  const ascending = sortOrder === "asc";

  query = query.order(sortField, { ascending });

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/notes - 创建笔记
export async function POST(request: NextRequest) {
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

  const { data, error } = await supabase
    .from("notes")
    .insert({
      user_id: user.id,
      title: title || "无标题笔记",
      content: content || { type: "doc", content: [{ type: "paragraph" }] },
      reading_item_id: reading_item_id || null,
      icon: typeof icon === "string" ? icon : null,
      cover_url: typeof cover_url === "string" ? cover_url : null,
      cover_position:
        typeof cover_position === "number"
          ? Math.max(0, Math.min(100, Math.round(cover_position)))
          : 50,
      parent_note_id:
        typeof parent_note_id === "string" ? parent_note_id : null,
      full_width: typeof full_width === "boolean" ? full_width : false,
      font_family:
        font_family === "serif" || font_family === "mono" ? font_family : "default",
      small_font: typeof small_font === "boolean" ? small_font : false,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
