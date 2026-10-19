import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import {
  buildDatabasePatchUpdate,
  databasePatchRejection,
  parseJsonBody,
  resolveDatabaseDelete,
} from "@/lib/databases/api-mutation";
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

  if (error) return serverError(error);
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
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.rejection.error },
      { status: parsed.rejection.status }
    );
  }
  const built = buildDatabasePatchUpdate(parsed.body);
  if (!built.ok) {
    return NextResponse.json(
      { error: built.rejection.error },
      { status: built.rejection.status }
    );
  }
  const updates = built.updates;

  const { data, error } = await supabase
    .from("db_databases")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id, parent_note_id, title, icon, schema, views, created_at, updated_at")
    .single();

  if (error) {
    // 0 行（不存在 / 已删 / 不属于本人）→ 404；真实数据库故障走 serverError，不泄露 message
    const rejection = databasePatchRejection(error);
    if (rejection) {
      return NextResponse.json(
        { error: rejection.error },
        { status: rejection.status }
      );
    }
    return serverError(error);
  }
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
  const { data, error } = await supabase.rpc("mutate_trash", {
    p_action: "soft_delete",
    p_resource_type: "database",
    p_ids: [id],
  });

  const result = resolveDatabaseDelete(error, data);
  if (result.status === "server-error") return serverError(error);
  if (result.status === "rejected") {
    return NextResponse.json(
      { error: result.rejection.error },
      { status: result.rejection.status }
    );
  }
  return NextResponse.json({ ok: true });
}
