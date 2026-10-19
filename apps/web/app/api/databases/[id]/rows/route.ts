import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { classifyParentDatabase, parseJsonBody } from "@/lib/databases/api-mutation";
import type { DatabaseRow } from "@organize/shared";

/** rows 路由共用的父库校验：不存在 → 404；查询故障 → serverError（不泄露 message）。 */
async function checkParentDatabase(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  userId: string
): Promise<NextResponse | null> {
  const { data: db, error: dbErr } = await supabase
    .from("db_databases")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  const check = classifyParentDatabase(dbErr, db);
  if (check.status === "server-error") return serverError(dbErr);
  if (check.status === "rejected") {
    return NextResponse.json(
      { error: check.rejection.error },
      { status: check.rejection.status }
    );
  }
  return null;
}

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
  const parentError = await checkParentDatabase(supabase, id, user.id);
  if (parentError) return parentError;

  const { data, error } = await supabase
    .from("db_rows")
    .select("id, database_id, sort, values, created_at, updated_at, deleted_at")
    .eq("database_id", id)
    .is("deleted_at", null)
    .order("sort", { ascending: true });

  if (error) return serverError(error);
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
  const parentError = await checkParentDatabase(supabase, id, user.id);
  if (parentError) return parentError;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.rejection.error },
      { status: parsed.rejection.status }
    );
  }
  const values =
    parsed.body.values &&
    typeof parsed.body.values === "object" &&
    !Array.isArray(parsed.body.values)
      ? parsed.body.values
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
  if (maxErr) return serverError(maxErr);
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

  if (error) return serverError(error);
  return NextResponse.json(data as DatabaseRow, { status: 201 });
}
