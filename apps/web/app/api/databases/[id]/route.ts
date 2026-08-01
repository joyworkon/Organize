import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database as DatabaseRecord } from "@organize/shared";

// GET /api/databases/[id]  获取单个数据库（含 schema/views）
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await supabase
    .from("db_databases")
    .select("id, parent_note_id, title, icon, schema, views, created_at, updated_at, deleted_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "数据库不存在" }, { status: 404 });
  return NextResponse.json(data as DatabaseRecord);
}

// PATCH /api/databases/[id]  更新数据库元信息 / schema / views
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string") updates.title = body.title;
  if ("icon" in body) updates.icon = body.icon === null ? null : (typeof body.icon === "string" ? body.icon : undefined);
  if (Array.isArray(body.schema)) updates.schema = body.schema;
  if (Array.isArray(body.views)) updates.views = body.views;
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("db_databases")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id, parent_note_id, title, icon, schema, views, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data as DatabaseRecord);
}

// DELETE /api/databases/[id]  软删除数据库（进可撤销回收站）
// 走 mutate_trash RPC（'database' 分支会级联软删其 db_rows），保证回收站一致性
// 与级联可见性；不再直接 update（之前直接 update 不级联行、不进回收站流程）。
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const { error } = await supabase.rpc("mutate_trash", {
    p_action: "soft_delete",
    p_resource_type: "database",
    p_ids: [id],
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
