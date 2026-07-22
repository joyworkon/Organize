import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";

// GET /api/notes/[id]/versions - 列出某篇笔记的历史版本
export async function GET(
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

  // 校验笔记归属（RLS 也会挡，但提前 404 更友好）
  const { data: note } = await supabase
    .from("notes")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!note) {
    return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("note_versions")
    .select("id, title, message, created_at")
    .eq("note_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return serverError(error);
  return NextResponse.json(data);
}
