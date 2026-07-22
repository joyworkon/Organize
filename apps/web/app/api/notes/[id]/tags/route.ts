import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";

// GET /api/notes/[id]/tags - 列出某篇笔记的标签
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

  const { data, error } = await supabase
    .from("note_tags")
    .select("tag:tags(id, name)")
    .eq("note_id", id);

  if (error) {
    return serverError(error);
  }

  // 展平：[{ tag: {id, name} }] -> [{ id, name }]
  // supabase 无生成类型时会把 join 推断成数组，运行时多对一返回单对象，兼容处理
  const rows = (data || []) as Array<{
    tag?: { id: string; name: string } | { id: string; name: string }[];
  }>;
  const tags = rows
    .map((row) => {
      const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag;
      return tag ? { id: tag.id, name: tag.name } : null;
    })
    .filter((t): t is { id: string; name: string } => t !== null);

  return NextResponse.json(tags);
}

// POST /api/notes/[id]/tags - 给笔记打标签（body: { tag_id } 或 { name }）
// 传 name 时若该标签不存在会自动创建
export async function POST(
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
  const tagId: string | undefined = body?.tag_id;
  const tagName: string | undefined = body?.name?.toString().trim();

  let resolvedTagId = tagId;

  // 如果传的是 name，先 upsert 拿到 tag_id
  if (!resolvedTagId && tagName) {
    const { data: tag, error: tagErr } = await supabase
      .from("tags")
      .upsert({ user_id: user.id, name: tagName }, { onConflict: "user_id,name" })
      .select("id")
      .single();

    if (tagErr) {
      return NextResponse.json({ error: tagErr.message }, { status: 500 });
    }
    resolvedTagId = tag.id;
  }

  if (!resolvedTagId) {
    return NextResponse.json({ error: "需要提供 tag_id 或 name" }, { status: 400 });
  }

  const { error } = await supabase.from("note_tags").insert({
    note_id: id,
    tag_id: resolvedTagId,
  });

  if (error) {
    // 重复主键（已打过该标签）当作成功
    if (error.code === "23505") {
      return NextResponse.json({ success: true, tag_id: resolvedTagId });
    }
    return serverError(error);
  }

  return NextResponse.json({ success: true, tag_id: resolvedTagId }, { status: 201 });
}

// DELETE /api/notes/[id]/tags?tag_id=xxx - 移除笔记上的某个标签
export async function DELETE(
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
  const { searchParams } = new URL(request.url);
  const tagId = searchParams.get("tag_id");

  if (!tagId) {
    return NextResponse.json({ error: "缺少 tag_id 参数" }, { status: 400 });
  }

  const { error } = await supabase
    .from("note_tags")
    .delete()
    .eq("note_id", id)
    .eq("tag_id", tagId);

  if (error) {
    return serverError(error);
  }

  return NextResponse.json({ success: true });
}
