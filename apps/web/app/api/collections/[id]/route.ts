import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { validateCollectionName } from "@/lib/collections/types";

// PATCH /api/collections/[id] — 重命名 { name }。
// DELETE /api/collections/[id] — 删除集合（cascade 只清引用行，绝不删来源）。
type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  let body: { name?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }

  const nameError = validateCollectionName(body.name);
  if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });

  const { error } = await supabase
    .from("collections")
    .update({ name: String(body.name).trim() })
    .eq("id", id).eq("user_id", user.id);
  if (error) return serverError(error);
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { error } = await supabase
    .from("collections")
    .delete()
    .eq("id", id).eq("user_id", user.id);
  if (error) return serverError(error);
  return NextResponse.json({ success: true });
}
