import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DatabaseRow } from "@organize/shared";

// GET /api/databases/[id]/rows  列出某数据库下所有未删除行（按 sort 升序）
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  // 先校验父库属于当前用户且未删除
  const { data: db, error: dbErr } = await supabase
    .from("db_databases")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!db) return NextResponse.json({ error: "数据库不存在" }, { status: 404 });

  const { data, error } = await supabase
    .from("db_rows")
    .select("id, database_id, sort, values, created_at, updated_at, deleted_at")
    .eq("database_id", id)
    .is("deleted_at", null)
    .order("sort", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data as DatabaseRow[]);
}

// POST /api/databases/[id]/rows  新增一行
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
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
  const values = body.values && typeof body.values === "object" && !Array.isArray(body.values)
    ? body.values
    : {};

  // 计算新行的 sort 值 = 当前最大 sort + 1（0 起步）
  const { data: maxRow, error: maxErr } = await supabase
    .from("db_rows")
    .select("sort")
    .eq("database_id", id)
    .is("deleted_at", null)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) return NextResponse.json({ error: maxErr.message }, { status: 500 });
  const nextSort = (maxRow?.sort ?? -1) + 1;

  const { data, error } = await supabase
    .from("db_rows")
    .insert({
      user_id: user.id,
      database_id: id,
      sort: nextSort,
      values,
    })
    .select("id, database_id, sort, values, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data as DatabaseRow, { status: 201 });
}
