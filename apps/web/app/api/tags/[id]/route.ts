import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";

// PATCH /api/tags/[id] - 重命名标签
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const name: string = (body?.name ?? "").toString().trim();

  if (!name) {
    return NextResponse.json({ error: "标签名不能为空" }, { status: 400 });
  }
  if (name.length > 32) {
    return NextResponse.json({ error: "标签名最长 32 字符" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tags")
    .update({ name })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name")
    .single();

  if (error) {
    return serverError(error);
  }

  return NextResponse.json(data);
}

// DELETE /api/tags/[id] - 删除标签（关联表会级联清理）
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await params;

  const { error } = await supabase.from("tags").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    return serverError(error);
  }

  return NextResponse.json({ success: true });
}
