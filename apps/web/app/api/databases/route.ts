import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database as DatabaseRecord } from "@organize/shared";

const DEFAULT_SCHEMA = [
  { id: "prop_name", name: "名称", type: "text" },
  { id: "prop_tags", name: "标签", type: "multiSelect", options: [] },
  { id: "prop_date", name: "日期", type: "date" },
];

const DEFAULT_VIEWS = [{ id: "default_view", type: "table", config: {} }];

// GET /api/databases?note_id=xxx  列出当前用户的数据库（可按 parent_note_id 过滤）
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const noteId = searchParams.get("note_id");
  const includeDeleted = searchParams.get("include_deleted") === "1";

  let query = supabase
    .from("db_databases")
    .select("id, parent_note_id, title, icon, schema, views, created_at, updated_at, deleted_at")
    .eq("user_id", user.id);

  if (noteId) query = query.eq("parent_note_id", noteId);
  if (!includeDeleted) query = query.is("deleted_at", null);
  query = query.order("created_at", { ascending: true });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data as DatabaseRecord[]);
}

// POST /api/databases  创建数据库（默认为整页：parent_note_id 必填；inline 由编辑器块调用时不传也行，但目前统一要求 note_id）
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "未命名数据库";
  const icon = typeof body.icon === "string" ? body.icon : null;
  const parent_note_id = typeof body.parent_note_id === "string" && body.parent_note_id.length
    ? body.parent_note_id
    : null;
  const schema = Array.isArray(body.schema) && body.schema.length
    ? body.schema
    : DEFAULT_SCHEMA;
  const views = Array.isArray(body.views) && body.views.length
    ? body.views
    : DEFAULT_VIEWS;
  // 允许客户端指定 id（便于整页数据库流程：先生成 id 再同时写 note + database）
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : undefined;

  // 如果指定了 parent_note_id，验证该笔记属于当前用户
  if (parent_note_id) {
    const { data: noteCheck, error: noteErr } = await supabase
      .from("notes")
      .select("id")
      .eq("id", parent_note_id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (noteErr) return NextResponse.json({ error: noteErr.message }, { status: 500 });
    if (!noteCheck) return NextResponse.json({ error: "父笔记不存在" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("db_databases")
    .insert({
      ...(id ? { id } : {}),
      user_id: user.id,
      parent_note_id,
      title,
      icon,
      schema,
      views,
    })
    .select("id, parent_note_id, title, icon, schema, views, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data as DatabaseRecord, { status: 201 });
}
