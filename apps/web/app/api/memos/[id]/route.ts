import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { parseMemoTags } from "@/lib/memos/tags";

// PATCH /api/memos/[id] - 编辑速记内容（标签随内容重新解析）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const content = String(body?.content || "").trim();
  if (!content || content.length > 5000) {
    return NextResponse.json({ error: "内容无效（1-5000 字）" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("memos")
    .update({ content, tags: parseMemoTags(content), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) return serverError(error);
  return NextResponse.json(data);
}

// DELETE /api/memos/[id] - 软删除速记
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const { error } = await supabase
    .from("memos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) return serverError(error);
  return NextResponse.json({ success: true });
}
