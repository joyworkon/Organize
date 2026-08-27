import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DatabaseRow } from "@organize/shared";

// PATCH /api/databases/[id]/rows/[rowId]  更新行的 values 或 sort
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id, rowId } = await params;

  const { data: db, error: dbErr } = await supabase
    .from("db_databases")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!db) return NextResponse.json({ error: "数据库不存在" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body.values && typeof body.values === "object" && !Array.isArray(body.values)) {
    updates.values = body.values;
  }
  if (typeof body.sort === "number") updates.sort = body.sort;
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("db_rows")
    .update(updates)
    .eq("id", rowId)
    .eq("database_id", id)
    .is("deleted_at", null)
    .select("id, database_id, sort, values, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data as DatabaseRow);
}

// DELETE /api/databases/[id]/rows/[rowId]  软删除行
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id, rowId } = await params;

  const { data: db, error: dbErr } = await supabase
    .from("db_databases")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!db) return NextResponse.json({ error: "数据库不存在" }, { status: 404 });

  // 软删除走 mutate_trash RPC（database_row 分支，migration 050）：
  // 直写 deleted_at 会被 RLS 拒绝（UPDATE 时 SELECT 策略 USING 作为新行隐式检查）
  const { error } = await supabase.rpc("mutate_trash", {
    p_action: "soft_delete",
    p_resource_type: "database_row",
    p_ids: [rowId],
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
