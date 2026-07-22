import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";

// GET /api/reading-items/[id]/tags - 列出某条阅读条目的标签
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
    .from("item_tags")
    .select("tag:tags(id, name)")
    .eq("item_id", id);

  if (error) {
    return serverError(error);
  }

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

// POST /api/reading-items/[id]/tags - 给阅读条目打标签（body: { tag_id } 或 { name }）
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

  const { error } = await supabase.from("item_tags").insert({
    item_id: id,
    tag_id: resolvedTagId,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ success: true, tag_id: resolvedTagId });
    }
    return serverError(error);
  }

  return NextResponse.json({ success: true, tag_id: resolvedTagId }, { status: 201 });
}

// DELETE /api/reading-items/[id]/tags?tag_id=xxx - 移除阅读条目上的某个标签
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
    .from("item_tags")
    .delete()
    .eq("item_id", id)
    .eq("tag_id", tagId);

  if (error) {
    return serverError(error);
  }

  return NextResponse.json({ success: true });
}
