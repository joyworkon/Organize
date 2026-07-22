import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";

// GET /api/notes/[id]/versions/[versionId] - 拿某个历史版本的完整内容
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id, versionId } = await params;

  const { data, error } = await supabase
    .from("note_versions")
    .select("id, note_id, content, title, created_at")
    .eq("id", versionId)
    .eq("note_id", id)
    .maybeSingle();

  if (error) return serverError(error);
  if (!data) return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  return NextResponse.json(data);
}

// POST /api/notes/[id]/versions/[versionId]/restore
// 注意：这里用 /restore 子路径，因为 [versionId] 已经匹配了动态段
// 实际路径会是 /api/notes/[id]/versions/[versionId] + method POST 表示恢复
// 为简化前端调用，把恢复动作也放在这个路由的 POST 里
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id, versionId } = await params;

  // 拿历史版本内容（RLS 校验归属）
  const { data: version, error: versionErr } = await supabase
    .from("note_versions")
    .select("content, title")
    .eq("id", versionId)
    .eq("note_id", id)
    .maybeSingle();
  if (versionErr) return serverError(versionErr);
  if (!version) return NextResponse.json({ error: "版本不存在" }, { status: 404 });

  // 把笔记的 content 恢复成这个版本
  // 触发器会自动把当前内容存为新版本（所以恢复也是可逆的）
  const { error: updateErr } = await supabase
    .from("notes")
    .update({
      content: version.content,
      title: version.title,
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateErr) return serverError(updateErr);

  return NextResponse.json({ success: true });
}

// DELETE /api/notes/[id]/versions/[versionId] - 删除某个历史版本
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id, versionId } = await params;

  // 校验笔记归属
  const { data: note } = await supabase
    .from("notes")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  const { error } = await supabase
    .from("note_versions")
    .delete()
    .eq("id", versionId)
    .eq("note_id", id);

  if (error) return serverError(error);
  return NextResponse.json({ success: true });
}
