import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import {
  buildRowPatchUpdate,
  classifyParentDatabase,
  parseJsonBody,
  resolveRowDelete,
  rowPatchRejection,
} from "@/lib/databases/api-mutation";
import type { DatabaseRow } from "@organize/shared";

/** 父库校验：不存在 → 404；查询故障 → serverError（不泄露 message）。 */
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

// PATCH /api/databases/[id]/rows/[rowId]  更新行的 values 或 sort
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id, rowId } = await params;

  const parentError = await checkParentDatabase(supabase, id, user.id);
  if (parentError) return parentError;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.rejection.error },
      { status: parsed.rejection.status }
    );
  }
  const built = buildRowPatchUpdate(parsed.body);
  if (!built.ok) {
    return NextResponse.json(
      { error: built.rejection.error },
      { status: built.rejection.status }
    );
  }
  const updates = built.updates;

  const { data, error } = await supabase
    .from("db_rows")
    .update(updates)
    .eq("id", rowId)
    .eq("database_id", id)
    .is("deleted_at", null)
    .select("id, database_id, sort, values, created_at, updated_at")
    .single();

  if (error) {
    // 0 行（不存在 / 已删 / 不属于本库）→ 404；真实数据库故障走 serverError，不泄露 message
    const rejection = rowPatchRejection(error);
    if (rejection) {
      return NextResponse.json(
        { error: rejection.error },
        { status: rejection.status }
      );
    }
    return serverError(error);
  }
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

  const parentError = await checkParentDatabase(supabase, id, user.id);
  if (parentError) return parentError;

  // 软删除走 mutate_trash RPC（database_row 分支，migration 050）：
  // 直写 deleted_at 会被 RLS 拒绝（UPDATE 时 SELECT 策略 USING 作为新行隐式检查）
  const { data, error } = await supabase.rpc("mutate_trash", {
    p_action: "soft_delete",
    p_resource_type: "database_row",
    p_ids: [rowId],
  });

  const result = resolveRowDelete(error, data);
  if (result.status === "server-error") return serverError(error);
  if (result.status === "rejected") {
    return NextResponse.json(
      { error: result.rejection.error },
      { status: result.rejection.status }
    );
  }
  return NextResponse.json({ ok: true });
}
